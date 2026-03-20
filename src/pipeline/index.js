import { scrapeLeads } from './scraper.js';
import { filterNewLeads, upsertSeenLead } from './deduplicator.js';
import { enrichLeads } from './enricher.js';
import { verifyLeads } from './verifier.js';
import { generateCopyBatch } from './copywriter.js';
import { launchCampaign } from './launcher.js';
import { supabase } from '../utils/supabase.js';
import { sendTelegram } from '../telegram/bot.js';
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
    logger.info('ORACLE pipeline starting', { variant_id: variantId });

    const { leads: rawLeads, noEmailSkipped } = await scrapeLeads();
    stats.scraped_count = rawLeads.length;
    stats.no_email_skipped = noEmailSkipped;

    for (const lead of rawLeads) {
      await upsertSeenLead(lead);
    }

    const { passed: newLeads, skipped } = await filterNewLeads(rawLeads);
    stats.dedupe_skipped = skipped;

    const enrichedLeads = await enrichLeads(newLeads);
    stats.enriched_count = enrichedLeads.length;

    const { verified, failCount } = await verifyLeads(enrichedLeads);
    stats.verified_count = verified.length;
    stats.verification_failed = failCount;

    const leadsWithCopy = await generateCopyBatch(verified, variantId);
    stats.copy_generated_count = leadsWithCopy.length;

    const launchResult = await launchCampaign(leadsWithCopy, variantId);
    if (launchResult) {
      stats.campaign_id = launchResult.campaign.id;
      stats.added_to_campaign = launchResult.addResult.totalAdded;
    }

    const durationMs = Date.now() - startTime;

    await supabase
      .from('pipeline_runs')
      .update({
        ...stats,
        status: 'complete',
        duration_ms: durationMs,
        completed_at: new Date().toISOString()
      })
      .eq('id', runId);

    const msg = `ORACLE PIPELINE COMPLETE
Date: ${new Date().toISOString().split('T')[0]}
Scraped: ${stats.scraped_count}
Dedupe skipped: ${stats.dedupe_skipped}
No email: ${stats.no_email_skipped}
Enriched: ${stats.enriched_count}
Verified: ${stats.verified_count}
Copy generated: ${stats.copy_generated_count}
Added to campaign: ${stats.added_to_campaign}
Campaign: ${stats.campaign_id || 'none'}
Duration: ${Math.round(durationMs / 1000)}s`;

    await sendTelegram(msg);
    logger.info('Pipeline complete', stats);

  } catch (err) {
    logger.error('Pipeline fatal error', { error: err.message, stack: err.stack });

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

    await sendTelegram(`ORACLE ERROR
Module: pipeline
Error: ${err.message}
Time: ${new Date().toISOString()}
Check Railway logs.`);
  }
}
