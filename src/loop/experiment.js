import { getRecentExperiments, getCurrentBaseline, logExperiment, updateExperimentResult, promoteToBaseline } from './ledger.js';
import { generateHypothesis } from './hypothesis.js';
import { runPipeline } from '../pipeline/index.js';
import { sendTelegram } from '../telegram/bot.js';
import { BASE_SEQUENCE } from '../sequences/base_sequence.js';
import logger from '../utils/logger.js';
import { supabase } from '../utils/supabase.js';
import { writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = {
  min_sends: parseInt(process.env.MIN_SENDS_TO_SCORE) || 150,
  winner_threshold: parseFloat(process.env.WINNER_THRESHOLD_PP) || 0.005
};

export async function runExperimentLoop() {
  try {
    logger.info('Experiment loop starting');

    const ledger = await getRecentExperiments(10);
    const baseline = await getCurrentBaseline('real_estate');

    const hypothesis = await generateHypothesis(ledger, baseline);

    const experimentRecord = await logExperiment({
      variant_id: hypothesis.variant_id,
      hypothesis: hypothesis.hypothesis,
      what_changed: hypothesis.what_changed
    });

    if (!experimentRecord) {
      logger.error('Failed to log experiment, aborting loop');
      return;
    }

    logger.info('Launching pipeline with new variant', { variant_id: hypothesis.variant_id });
    await runPipeline(hypothesis.variant_id);

    logger.info('Experiment loop cycle complete', {
      experiment_id: experimentRecord.id,
      variant_id: hypothesis.variant_id
    });

  } catch (err) {
    logger.error('Experiment loop error', { error: err.message });
    await sendTelegram(`ORACLE ERROR
Module: experiment_loop
Error: ${err.message}
Time: ${new Date().toISOString()}
Pipeline continues.`);
  }
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

        const totalSent = stats.reduce((s, r) => s + (r.emails_sent || 0), 0);
        const totalReplies = stats.reduce((s, r) => s + (r.replies_unique || 0), 0);
        const totalAutoReplies = stats.reduce((s, r) => s + (r.auto_replies_unique || 0), 0);
        const totalOpens = stats.reduce((s, r) => s + (r.opens_unique || 0), 0);

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

        const positiveReplies = totalReplies - totalAutoReplies;
        const positiveReplyRate = totalSent > 0 ? positiveReplies / totalSent : 0;
        const openRate = totalSent > 0 ? totalOpens / totalSent : 0;
        const delta = positiveReplyRate - baselineRate;

        let outcome;
        if (delta >= CONFIG.winner_threshold) {
          outcome = 'winner';
        } else if (delta < -CONFIG.winner_threshold) {
          outcome = 'loser';
        } else {
          outcome = 'inconclusive';
        }

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
          logger.info('New winner promoted to baseline', { variant_id: exp.variant_id, rate: positiveReplyRate });
        }

        const deltaStr = delta >= 0 ? `+${(delta * 100).toFixed(2)}` : (delta * 100).toFixed(2);
        await sendTelegram(`ORACLE EXPERIMENT SCORED
Variant: ${exp.variant_id}
What changed: ${exp.what_changed}
Sends: ${totalSent}
Positive reply rate: ${(positiveReplyRate * 100).toFixed(2)}%
vs Baseline: ${deltaStr}pp
Result: ${outcome.toUpperCase()}
${outcome === 'winner' ? 'NEW BASELINE PROMOTED' : 'Discarded. Next hypothesis incoming.'}`);

      } catch (err) {
        logger.error('Error scoring experiment', { experiment_id: exp.id, error: err.message });
      }
    }

  } catch (err) {
    logger.error('scoreActiveExperiments error', { error: err.message });
  }
}
