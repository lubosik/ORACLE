import { scrapeLeads, sendLeadCSVToTelegram } from './scraper.js';
import { filterNewLeads, upsertSeenLead } from './deduplicator.js';
import { enrichLeads } from './enricher.js';
import { verifyLeads } from './verifier.js';
import { selectInboxes } from './inbox_selector.js';
import { createCampaignDraft } from './draft_manager.js';
import { sendCampaignApprovalRequest } from '../telegram/approval.js';
import { getGeoGroup, nextGeoGroup, buildGeoLabel } from './geo_targeting.js';
import { supabase } from '../utils/supabase.js';
import { getSetting, setSetting } from '../utils/settings.js';
import { logActivity } from '../utils/activity.js';
import { sendTelegram, getBot } from '../telegram/bot.js';
import logger from '../utils/logger.js';
import 'dotenv/config';

export async function runPipeline(variantId = 'v1_baseline', copyInstructions = null) {
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

    // 1. Load geo targeting config
    const minLeads = parseInt(await getSetting('min_leads_per_campaign', '50'));
    const activeGeoGroupId = await getSetting('active_geo_group', 'uk');
    const geoGroup = getGeoGroup(activeGeoGroupId);
    const MAX_GEO_TARGETS = 5; // max cities/states to try per run

    await logActivity({
      category: 'scraping',
      level: 'info',
      message: `Geo targeting: ${geoGroup.label} (${geoGroup.timezone}) — will expand up to ${MAX_GEO_TARGETS} ${geoGroup.targets[0]?.city !== undefined ? 'cities' : 'states'} if needed`,
      pipeline_run_id: runId,
      detail: { geo_group: activeGeoGroupId, timezone: geoGroup.timezone }
    });

    // 2. Scrape geo targets one at a time, accumulating until min_leads reached
    let allRawLeads = [];
    let noEmailSkipped = 0;
    const geoTargetsUsed = [];

    for (let i = 0; i < Math.min(MAX_GEO_TARGETS, geoGroup.targets.length); i++) {
      const target = { ...geoGroup.targets[i], country: geoGroup.country };
      geoTargetsUsed.push(target);

      const { leads: batch, noEmailSkipped: batchSkipped } = await scrapeLeads('real_estate', target);
      allRawLeads.push(...batch);
      noEmailSkipped += batchSkipped;

      const geoName = target.city || target.state;
      await logActivity({
        category: 'scraping',
        level: 'info',
        message: `Scraped ${batch.length} leads from ${geoName} — running total: ${allRawLeads.length}`,
        pipeline_run_id: runId
      });

      // Check if we have enough leads (rough check before dedup — dedup will reduce further)
      if (allRawLeads.length >= minLeads * 1.5) break;
    }

    // Deduplicate across all batches by email
    const emailSeen = new Set();
    const rawLeads = allRawLeads.filter(l => {
      if (!l.email || emailSeen.has(l.email)) return false;
      emailSeen.add(l.email);
      return true;
    });

    stats.scraped_count = rawLeads.length;
    stats.no_email_skipped = noEmailSkipped;

    const geoLabel = buildGeoLabel(geoGroup, geoTargetsUsed);
    const geoContext = {
      group_id: activeGeoGroupId,
      label: geoGroup.label,
      geo_label: geoLabel,
      timezone: geoGroup.timezone,
      country: geoGroup.country,
      targets_used: geoTargetsUsed,
      send_hours: geoGroup.send_hours
    };

    await logActivity({
      category: 'scraping',
      level: 'info',
      message: `Geo scrape complete — ${rawLeads.length} unique leads from ${geoLabel} (${geoTargetsUsed.length} ${geoTargetsUsed[0]?.city ? 'cities' : 'states'})`,
      pipeline_run_id: runId
    });

    for (const lead of rawLeads) {
      await upsertSeenLead(lead);
    }

    await logActivity({
      category: 'pipeline',
      level: 'info',
      message: `Stage 1 complete: ${rawLeads.length} leads scraped`,
      pipeline_run_id: runId,
      detail: { no_email_skipped: noEmailSkipped }
    });

    // 3. Dedup against campaign history
    const { passed: newLeads, skipped } = await filterNewLeads(rawLeads);
    stats.dedupe_skipped = skipped;

    await logActivity({
      category: 'pipeline',
      level: 'info',
      message: `Stage 2 complete: ${newLeads.length} leads after deduplication (${skipped} skipped)`,
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

    await logActivity({
      category: 'pipeline',
      level: 'info',
      message: `Stage 3 complete: ${enrichedLeads.length} leads enriched`,
      pipeline_run_id: runId,
      detail: { dropped: newLeads.length - enrichedLeads.length }
    });

    // 5. Verify
    const { verified, failCount } = await verifyLeads(enrichedLeads);
    stats.verified_count = verified.length;
    stats.verification_failed = failCount;

    await logActivity({
      category: 'pipeline',
      level: 'info',
      message: `Stage 4 complete: ${verified.length} leads verified (${failCount} failed verification)`,
      pipeline_run_id: runId,
      detail: { passed: verified.length, failed: failCount }
    });

    // 6. Select warm inboxes (sequence template is generated inside createCampaignDraft)
    const selectedInboxes = await selectInboxes();

    await logActivity({
      category: 'pipeline',
      level: 'info',
      message: `Inbox selection: ${selectedInboxes.join(', ')} (all warm)`,
      pipeline_run_id: runId
    });

    // 8. Read max lead settings (min already loaded above for geo loop)
    const maxLeads = parseInt(await getSetting('max_leads_per_campaign', '200'));

    stats.copy_generated_count = verified.length;

    await logActivity({
      category: 'pipeline',
      level: 'info',
      message: `Stage 5 complete: ${verified.length} leads ready for campaign draft`,
      pipeline_run_id: runId
    });

    // 9. Create campaign draft with geo context (sequence template generated inside)
    const dateStr = new Date().toISOString().split('T')[0];
    const geoSlug = (geoContext.geo_label || geoContext.label).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
    const campaignName = `ORACLE_AIRO_${geoSlug}_${variantId}_${dateStr}`;

    const draft = await createCampaignDraft({
      pipelineRunId: runId,
      campaignName,
      variantId,
      leads: verified,
      sequence: null,
      selectedInboxes,
      minLeads,
      maxLeads,
      geoContext,
      copyInstructions
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
        message: `Pipeline complete — not enough leads for draft (${verified.length} < ${minLeads} min)`,
        pipeline_run_id: runId
      });

      await sendTelegram(`ORACLE PIPELINE COMPLETE — NO DRAFT\nLeads after processing: ${verified.length}\nMinimum required: ${minLeads}\n\nAdjust min_leads_per_campaign from the Controls panel or wait for more leads.`);
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

    // Rotate geo group so next pipeline run targets a different market
    const nextGeo = nextGeoGroup(activeGeoGroupId);
    await setSetting('active_geo_group', nextGeo);

    await logActivity({
      category: 'pipeline',
      level: 'success',
      message: `Pipeline complete — campaign pending approval (geo: ${geoContext.geo_label}, next run: ${nextGeo})`,
      pipeline_run_id: runId,
      detail: { draft_id: draft.id, geo_context: geoContext, next_geo: nextGeo }
    });

    logger.info('Pipeline complete — campaign draft pending approval', { ...stats, draft_id: draft.id, geo: geoContext.geo_label });

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

/**
 * Run the pipeline from already-scraped leads (skip scraping + dedup).
 * Used by rerun_from_apify.js to replay a previous Apify dataset.
 */
export async function runPipelineFromLeads(preScrapedLeads, variantId = 'v1_baseline', geoContextOverride = null) {
  const startTime = Date.now();

  const { data: runRow } = await supabase
    .from('pipeline_runs')
    .insert({ status: 'running', variant_id: variantId })
    .select()
    .single();

  const runId = runRow?.id;
  const stats = {
    scraped_count: preScrapedLeads.length,
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
      message: `Pipeline (re-run mode) started — ${preScrapedLeads.length} pre-scraped leads`,
      pipeline_run_id: runId,
      detail: { variant_id: variantId, mode: 'rerun' }
    });

    const minLeads = parseInt(await getSetting('min_leads_per_campaign', '50'));
    const maxLeads = parseInt(await getSetting('max_leads_per_campaign', '200'));
    const activeGeoGroupId = await getSetting('active_geo_group', 'uk');
    const geoGroup = getGeoGroup(activeGeoGroupId);

    // Build geo context from settings (or use override if provided)
    const geoContext = geoContextOverride || {
      group_id: activeGeoGroupId,
      label: geoGroup.label,
      geo_label: geoGroup.label,
      timezone: geoGroup.timezone,
      country: geoGroup.country,
      targets_used: [],
      send_hours: geoGroup.send_hours
    };

    // Upsert seen leads so they are tracked
    for (const lead of preScrapedLeads) {
      await upsertSeenLead(lead);
    }

    // Send CSV to Telegram for visibility
    const bot = getBot();
    if (bot && process.env.TELEGRAM_CHAT_ID) {
      await sendLeadCSVToTelegram(preScrapedLeads, bot, process.env.TELEGRAM_CHAT_ID, runId);
    }

    // Enrich
    const enrichedLeads = await enrichLeads(preScrapedLeads);
    stats.enriched_count = enrichedLeads.length;

    // Verify
    const { verified, failCount } = await verifyLeads(enrichedLeads);
    stats.verified_count = verified.length;
    stats.verification_failed = failCount;

    stats.copy_generated_count = verified.length;

    // Select warm inboxes
    const selectedInboxes = await selectInboxes();

    await logActivity({
      category: 'pipeline',
      level: 'info',
      message: `Inbox selection: ${selectedInboxes.join(', ')} (all warm)`,
      pipeline_run_id: runId
    });

    // Create campaign draft
    const dateStr = new Date().toISOString().split('T')[0];
    const geoSlug = (geoContext.geo_label || geoContext.label).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
    const campaignName = `ORACLE_AIRO_${geoSlug}_${variantId}_${dateStr}_rerun`;

    const draft = await createCampaignDraft({
      pipelineRunId: runId,
      campaignName,
      variantId,
      leads: verified,
      sequence: null,
      selectedInboxes,
      minLeads,
      maxLeads,
      geoContext
    });

    const durationMs = Date.now() - startTime;

    if (!draft) {
      await supabase
        .from('pipeline_runs')
        .update({ ...stats, status: 'complete', duration_ms: durationMs, completed_at: new Date().toISOString() })
        .eq('id', runId);

      await sendTelegram(`ORACLE PIPELINE COMPLETE — NO DRAFT\nLeads after processing: ${verified.length}\nMinimum required: ${minLeads}`);
      return;
    }

    // Send Telegram approval request
    if (bot && process.env.TELEGRAM_CHAT_ID) {
      await sendCampaignApprovalRequest(bot, process.env.TELEGRAM_CHAT_ID, draft);
    }

    await supabase
      .from('pipeline_runs')
      .update({ ...stats, status: 'complete', duration_ms: durationMs, completed_at: new Date().toISOString() })
      .eq('id', runId);

    await logActivity({
      category: 'pipeline',
      level: 'success',
      message: `Re-run pipeline complete — campaign pending approval (${verified.length} leads)`,
      pipeline_run_id: runId,
      detail: { draft_id: draft.id }
    });

    logger.info('Re-run pipeline complete — campaign draft pending approval', { ...stats, draft_id: draft.id });

  } catch (err) {
    logger.error('Re-run pipeline fatal error', { error: err.message, stack: err.stack });

    await logActivity({
      category: 'error',
      level: 'error',
      message: `Re-run pipeline fatal error: ${err.message}`,
      pipeline_run_id: runId,
      detail: { error: err.message }
    });

    await supabase
      .from('pipeline_runs')
      .update({ ...stats, status: 'error', error_message: err.message, duration_ms: Date.now() - startTime, completed_at: new Date().toISOString() })
      .eq('id', runId);

    await sendTelegram(`ORACLE ERROR (re-run)\nError: ${err.message}\nTime: ${new Date().toISOString()}\nCheck Railway logs.`);
  }
}
