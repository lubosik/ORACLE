import { getRecentExperiments, getCurrentBaseline, logExperiment, updateExperimentResult, promoteToBaseline } from './ledger.js';
import { generateHypothesis } from './hypothesis.js';
import { runPipeline } from '../pipeline/index.js';
import { sendTelegram } from '../telegram/bot.js';
import { collectTimingInsights } from '../analytics/tracker.js';
import { getSetting, setSetting, getSchedule } from '../utils/settings.js';
import { logActivity } from '../utils/activity.js';
import { BASE_SEQUENCE } from '../sequences/base_sequence.js';
import logger from '../utils/logger.js';
import { supabase } from '../utils/supabase.js';
import 'dotenv/config';

const CONFIG = {
  min_sends: parseInt(process.env.MIN_SENDS_TO_SCORE) || 150,
  winner_threshold: parseFloat(process.env.WINNER_THRESHOLD_PP) || 0.005
};

export async function runExperimentLoop() {
  try {
    logger.info('Experiment loop starting');

    // Refresh timing insights before generating hypothesis
    const timingInsights = await collectTimingInsights();
    const currentSchedule = await getSchedule();

    const ledger = await getRecentExperiments(10);
    const baseline = await getCurrentBaseline('real_estate');

    const hypothesis = await generateHypothesis(ledger, baseline, timingInsights, currentSchedule);

    // If this is a schedule experiment, temporarily apply the proposed schedule
    // and store the original so we can revert if it loses
    let scheduleSnapshot = null;
    if (hypothesis.change_type === 'send_schedule' && hypothesis.schedule_changes) {
      const original = {
        timeFrom:   currentSchedule.timeFrom,
        timeTo:     currentSchedule.timeTo,
        days:       currentSchedule.days,
        dailyLimit: currentSchedule.dailyLimit,
        timezone:   currentSchedule.timezone
      };
      const proposed = hypothesis.schedule_changes;

      // Apply proposed schedule for this campaign run
      if (proposed.timeFrom)   await setSetting('send_time_from',   proposed.timeFrom);
      if (proposed.timeTo)     await setSetting('send_time_to',     proposed.timeTo);
      if (proposed.days)       await setSetting('send_days',        proposed.days.join(','));
      if (proposed.dailyLimit) await setSetting('send_daily_limit', String(proposed.dailyLimit));

      scheduleSnapshot = { original, proposed, rationale: proposed.rationale || '' };

      await logActivity({
        category: 'experiment',
        level: 'info',
        message: `Schedule experiment applied: ${proposed.timeFrom || original.timeFrom}–${proposed.timeTo || original.timeTo}, days: ${(proposed.days || original.days).join(',')}`,
        detail: scheduleSnapshot
      });
    }

    const experimentRecord = await logExperiment({
      variant_id: hypothesis.variant_id,
      hypothesis: hypothesis.hypothesis,
      what_changed: hypothesis.what_changed,
      change_type: hypothesis.change_type,
      schedule_snapshot: scheduleSnapshot
    });

    if (!experimentRecord) {
      logger.error('Failed to log experiment, aborting loop');
      // Revert schedule if we changed it
      if (scheduleSnapshot) await revertSchedule(scheduleSnapshot.original);
      return;
    }

    await logActivity({
      category: 'experiment',
      level: 'info',
      message: `New hypothesis: ${hypothesis.hypothesis}`,
      detail: { variant_id: hypothesis.variant_id, change_type: hypothesis.change_type }
    });

    logger.info('Launching pipeline with new variant', { variant_id: hypothesis.variant_id });
    await runPipeline(hypothesis.variant_id);

    // If schedule was changed for this experiment, revert after pipeline run
    // (the campaign itself will keep its schedule; settings revert to original for future campaigns)
    if (scheduleSnapshot) {
      await revertSchedule(scheduleSnapshot.original);
      logger.info('Schedule reverted to original after experiment launch', scheduleSnapshot.original);
    }

    logger.info('Experiment loop cycle complete', {
      experiment_id: experimentRecord.id,
      variant_id: hypothesis.variant_id
    });

  } catch (err) {
    logger.error('Experiment loop error', { error: err.message });
    await sendTelegram(`ORACLE ERROR\nModule: experiment_loop\nError: ${err.message}\nTime: ${new Date().toISOString()}\nPipeline continues.`);
  }
}

async function revertSchedule(original) {
  if (!original) return;
  await setSetting('send_time_from',   original.timeFrom);
  await setSetting('send_time_to',     original.timeTo);
  await setSetting('send_days',        original.days.join(','));
  await setSetting('send_daily_limit', String(original.dailyLimit));
}

export async function scoreActiveExperiments() {
  try {
    const windowDays = parseInt(process.env.EXPERIMENT_WINDOW_DAYS) || 7;
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: experiments } = await supabase
      .from('experiment_ledger')
      .select('*')
      .eq('outcome', 'pending')
      .lt('launched_at', cutoff);

    if (!experiments?.length) {
      logger.info('No experiments ready to score');
      return;
    }

    const baseline = await getCurrentBaseline('real_estate');
    const baselineRate = baseline?.positive_reply_rate || 0;

    for (const exp of experiments) {
      try {
        const { data: stats } = await supabase
          .from('campaign_daily_stats')
          .select('*')
          .eq('campaign_id', exp.campaign_id)
          .order('date', { ascending: false });

        if (!stats?.length) continue;

        const totalSent      = stats.reduce((s, r) => s + (r.emails_sent || 0), 0);
        const totalReplies   = stats.reduce((s, r) => s + (r.replies_unique || 0), 0);
        const totalAutoReplies = stats.reduce((s, r) => s + (r.auto_replies_unique || 0), 0);
        const totalOpens     = stats.reduce((s, r) => s + (r.opens_unique || 0), 0);

        if (totalSent < CONFIG.min_sends) {
          await updateExperimentResult(exp.id, {
            sends: totalSent,
            positive_replies: totalReplies - totalAutoReplies,
            positive_reply_rate: totalSent > 0 ? (totalReplies - totalAutoReplies) / totalSent : 0,
            open_rate: totalSent > 0 ? totalOpens / totalSent : 0,
            baseline_rate: baselineRate,
            delta: 0,
            outcome: 'inconclusive',
            notes: `Insufficient sends: ${totalSent} < ${CONFIG.min_sends}`
          });
          continue;
        }

        const positiveReplies   = totalReplies - totalAutoReplies;
        const positiveReplyRate = totalSent > 0 ? positiveReplies / totalSent : 0;
        const openRate          = totalSent > 0 ? totalOpens / totalSent : 0;
        const delta             = positiveReplyRate - baselineRate;

        const outcome = delta >= CONFIG.winner_threshold  ? 'winner'
                      : delta < -CONFIG.winner_threshold  ? 'loser'
                      : 'inconclusive';

        await updateExperimentResult(exp.id, {
          sends: totalSent,
          positive_replies: positiveReplies,
          positive_reply_rate: positiveReplyRate,
          open_rate: openRate,
          baseline_rate: baselineRate,
          delta,
          outcome,
          notes: null
        });

        if (outcome === 'winner') {
          await promoteToBaseline(exp.variant_id, positiveReplyRate, null, 'real_estate');

          // If this was a schedule experiment, permanently apply the winning schedule
          if (exp.change_type === 'send_schedule' && exp.schedule_snapshot?.proposed) {
            const proposed = exp.schedule_snapshot.proposed;
            if (proposed.timeFrom)   await setSetting('send_time_from',   proposed.timeFrom);
            if (proposed.timeTo)     await setSetting('send_time_to',     proposed.timeTo);
            if (proposed.days)       await setSetting('send_days',        proposed.days.join(','));
            if (proposed.dailyLimit) await setSetting('send_daily_limit', String(proposed.dailyLimit));

            await logActivity({
              category: 'experiment',
              level: 'success',
              message: `Winning schedule permanently applied: ${proposed.timeFrom}–${proposed.timeTo}, days: ${proposed.days?.join(',')}`,
              detail: { variant_id: exp.variant_id, proposed }
            });

            logger.info('Winning schedule applied to system_settings', proposed);
          }
        }

        const deltaStr = delta >= 0 ? `+${(delta * 100).toFixed(2)}` : (delta * 100).toFixed(2);
        const scheduleNote = exp.change_type === 'send_schedule'
          ? `\nSchedule tested: ${exp.schedule_snapshot?.proposed?.timeFrom || '?'}–${exp.schedule_snapshot?.proposed?.timeTo || '?'}`
          : '';

        await logActivity({
          category: 'experiment',
          level: outcome === 'winner' ? 'success' : outcome === 'loser' ? 'warning' : 'info',
          message: `Experiment scored: ${exp.variant_id} — ${outcome.toUpperCase()} (${deltaStr}pp vs baseline)`,
          detail: { variant_id: exp.variant_id, outcome, delta, positiveReplyRate, sends: totalSent }
        });

        await sendTelegram(`ORACLE EXPERIMENT SCORED
Variant: ${exp.variant_id}
What changed: ${exp.what_changed}${scheduleNote}
Sends: ${totalSent}
Positive reply rate: ${(positiveReplyRate * 100).toFixed(2)}%
vs Baseline: ${deltaStr}pp
Result: ${outcome.toUpperCase()}
${outcome === 'winner' ? 'NEW BASELINE PROMOTED' + (exp.change_type === 'send_schedule' ? ' + SCHEDULE UPDATED' : '') : 'Discarded. Next hypothesis incoming.'}`);

      } catch (err) {
        logger.error('Error scoring experiment', { experiment_id: exp.id, error: err.message });
      }
    }

  } catch (err) {
    logger.error('scoreActiveExperiments error', { error: err.message });
  }
}
