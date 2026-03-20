import { scrapeLeads, sendLeadCSVToTelegram } from './scraper.js';
import { filterNewLeads, upsertSeenLead } from './deduplicator.js';
import { enrichLeads } from './enricher.js';
import { verifyLeads } from './verifier.js';
import { generateCopyBatch } from './copywriter.js';
import { selectInboxes } from './inbox_selector.js';
import { createCampaignDraft } from './draft_manager.js';
import { sendCampaignApprovalRequest } from '../telegram/approval.js';
import { supabase } from '../utils/supabase.js';
import { getSetting } from '../utils/settings.js';
import { logActivity } from '../utils/activity.js';
import { sendTelegram, getBot } from '../telegram/bot.js';
import logger from '../utils/logger.js';
import 'dotenv/config';

export async function runPipeline(variantId = 'v1_baseline') {
  const startTime = Date.now();

  // Clear stale locks
  await supabase
    .from('pipeline_runs')
    .update({ status: 'interrupted', error_message: 'Service restarted mid-run' })
    .eq('status', 'running')
    .lt('started_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

  const { data: activeRun } = await supabase
    .from('pipeline_runs')
    .select('id, started_at')
    .eq('status', 'running')
    .single();

  if (activeRun) {
    logger.warn('Pipeline already running, skipping', { active_run_id: activeRun.id });
    return;
  }

  const { data: runRow } = await supabase
    .from('pipeline_runs')
    .insert({ status: 'running', variant_id: variantId })
    .select()
    .single();

  const runId = runRow?.id;
  const stats = {
    scraped_count: 0,
    dedupe_skipped: 0,
    no_email_skipped: 0,
    enriched_count: 0,
    verified_count: 0,
    verification_failed: 0,
    copy_generated_count: 0,
    added_to_campaign: 0,
    campaign_id: null
  };

  try {
    await logActivity({
      category: 'pipeline',
      level: 'info',
      message: 'Pipeline started',
      pipeline_run_id: runId,
      detail: { variant_id: variantId }
    });

    // 1. Scrape
    const { leads: rawLeads, noEmailSkipped } = await scrapeLeads();
    stats.scraped_count = rawLeads.length;
    stats.no_email_skipped = noEmailSkipped;

    await logActivity({
      category: 'scraping',
      level: 'info',
      message: `Apify scrape complete — ${rawLeads.length} leads returned, ${noEmailSkipped} had no email, skipped`,
      pipeline_run_id: runId
    });

    for (const lead of rawLeads) {
      await upsertSeenLead(lead);
    }

    // 2. Dedup
    const { passed: newLeads, skipped } = await filterNewLeads(rawLeads);
    stats.dedupe_skipped = skipped;

    await logActivity({
      category: 'pipeline',
      level: 'info',
      message: `Deduplication check — ${rawLeads.length} leads checked, ${skipped} already in 30-day window`,
      pipeline_run_id: runId
    });

    // 3. Send lead CSV to Telegram for visibility
    const bot = getBot();
    if (bot && process.env.TELEGRAM_CHAT_ID) {
      await sendLeadCSVToTelegram(newLeads, bot, process.env.TELEGRAM_CHAT_ID, runId);
    }

    await logActivity({
      category: 'scraping',
      level: 'success',
      message: `CSV prepared — ${newLeads.length} leads ready for review`,
      pipeline_run_id: runId
    });

    // 4. Enrich
    const enrichedLeads = await enrichLeads(newLeads);
    stats.enriched_count = enrichedLeads.length;

    // 5. Verify
    const { verified, failCount } = await verifyLeads(enrichedLeads);
    stats.verified_count = verified.length;
    stats.verification_failed = failCount;

    // 6. Generate copy
    const leadsWithCopy = await generateCopyBatch(verified, variantId);
    stats.copy_generated_count = leadsWithCopy.length;

    await logActivity({
      category: 'copy',
      level: 'success',
      message: `Copy generated for all ${leadsWithCopy.length} leads`,
      pipeline_run_id: runId
    });

    // 7. Select warm inboxes
    const selectedInboxes = await selectInboxes();

    await logActivity({
      category: 'pipeline',
      level: 'info',
      message: `Inbox selection: ${selectedInboxes.join(', ')} (all warm)`,
      pipeline_run_id: runId
    });

    // 8. Read min/max lead settings
    const minLeads = parseInt(await getSetting('min_leads_per_campaign', '50'));
    const maxLeads = parseInt(await getSetting('max_leads_per_campaign', '200'));

    // 9. Create campaign draft (draft-first, no immediate launch)
    const dateStr = new Date().toISOString().split('T')[0];
    const campaignName = `ORACLE_AIRO_RE_${variantId}_${dateStr}`;

    const draft = await createCampaignDraft({
      pipelineRunId: runId,
      campaignName,
      variantId,
      leads: leadsWithCopy,
      sequence: null, // copy is on each lead object
      selectedInboxes,
      minLeads,
      maxLeads
    });

    const durationMs = Date.now() - startTime;

    if (!draft) {
      // Below min leads threshold — pipeline ends here
      await supabase
        .from('pipeline_runs')
        .update({
          ...stats,
          status: 'complete',
          duration_ms: durationMs,
          completed_at: new Date().toISOString()
        })
        .eq('id', runId);

      await logActivity({
        category: 'pipeline',
        level: 'warning',
        message: `Pipeline complete — not enough leads for draft (${leadsWithCopy.length} < ${minLeads} min)`,
        pipeline_run_id: runId
      });

      await sendTelegram(`ORACLE PIPELINE COMPLETE — NO DRAFT\nLeads after processing: ${leadsWithCopy.length}\nMinimum required: ${minLeads}\n\nAdjust min_leads_per_campaign from the Controls panel or wait for more leads.`);
      return;
    }

    // 10. Send Telegram approval request
    if (bot && process.env.TELEGRAM_CHAT_ID) {
      await sendCampaignApprovalRequest(bot, process.env.TELEGRAM_CHAT_ID, draft);
    }

    await supabase
      .from('pipeline_runs')
      .update({
        ...stats,
        status: 'complete',
        duration_ms: durationMs,
        completed_at: new Date().toISOString()
      })
      .eq('id', runId);

    await logActivity({
      category: 'pipeline',
      level: 'success',
      message: `Pipeline complete — campaign pending approval`,
      pipeline_run_id: runId,
      detail: { draft_id: draft.id }
    });

    logger.info('Pipeline complete — campaign draft pending approval', { ...stats, draft_id: draft.id });

  } catch (err) {
    logger.error('Pipeline fatal error', { error: err.message, stack: err.stack });

    await logActivity({
      category: 'error',
      level: 'error',
      message: `Pipeline fatal error: ${err.message}`,
      pipeline_run_id: runId,
      detail: { error: err.message }
    });

    await supabase
      .from('pipeline_runs')
      .update({
        ...stats,
        status: 'error',
        error_message: err.message,
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString()
      })
      .eq('id', runId);

    await sendTelegram(`ORACLE ERROR\nModule: pipeline\nError: ${err.message}\nTime: ${new Date().toISOString()}\nCheck Railway logs.`);
  }
}
