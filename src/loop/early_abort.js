import { supabase } from '../utils/supabase.js';
import { sendTelegram } from '../telegram/bot.js';
import { logActivity } from '../utils/activity.js';
import logger from '../utils/logger.js';
import 'dotenv/config';

const BASE_URL = process.env.INSTANTLY_BASE_URL || 'https://api.instantly.ai/api/v2';

// Must have been running at least this long before abort checks apply
const MIN_HOURS_RUNNING = 20;

// Rules evaluated in order — first triggered wins. Inspired by Karpathy's fast-fail on divergence.
const ABORT_RULES = [
  {
    id: 'deliverability_failure',
    label: 'Deliverability failure',
    description: 'Open rate below 3% after 30+ sends — emails not reaching inbox',
    min_sends: 30,
    check: agg => agg.open_rate < 0.03,
    severity: 'error'
  },
  {
    id: 'high_bounce',
    label: 'High bounce rate',
    description: 'Bounce rate above 10% after 20+ sends — domain or list quality issue',
    min_sends: 20,
    check: agg => agg.emails_sent > 0 && (agg.bounced / agg.emails_sent) > 0.10,
    severity: 'error'
  },
  {
    id: 'dead_copy',
    label: 'Dead copy',
    description: 'Zero positive replies after 75+ sends and open rate is healthy — copy not resonating',
    min_sends: 75,
    check: agg => agg.open_rate >= 0.05 && agg.positive_reply_rate < 0.001,
    severity: 'warning'
  }
];

export async function checkForEarlyAbort() {
  try {
    const cutoff = new Date(Date.now() - MIN_HOURS_RUNNING * 60 * 60 * 1000).toISOString();

    // Only check pending experiments that have a linked campaign_id and have been running long enough
    const { data: experiments } = await supabase
      .from('experiment_ledger')
      .select('*')
      .eq('outcome', 'pending')
      .lt('launched_at', cutoff)
      .not('campaign_id', 'is', null);

    if (!experiments?.length) {
      logger.debug('Early abort check: no eligible experiments');
      return;
    }

    for (const exp of experiments) {
      try {
        const { data: statRows } = await supabase
          .from('campaign_daily_stats')
          .select('emails_sent, replies_unique, auto_replies_unique, opens_unique, bounced, open_rate')
          .eq('campaign_id', exp.campaign_id);

        if (!statRows?.length) continue;

        // Aggregate across all days
        const agg = statRows.reduce((acc, row) => {
          acc.emails_sent      += row.emails_sent || 0;
          acc.replies_unique   += row.replies_unique || 0;
          acc.auto_replies     += row.auto_replies_unique || 0;
          acc.opens_unique     += row.opens_unique || 0;
          acc.bounced          += row.bounced || 0;
          return acc;
        }, { emails_sent: 0, replies_unique: 0, auto_replies: 0, opens_unique: 0, bounced: 0 });

        agg.open_rate           = agg.emails_sent > 0 ? agg.opens_unique / agg.emails_sent : 0;
        agg.positive_reply_rate = agg.emails_sent > 0 ? (agg.replies_unique - agg.auto_replies) / agg.emails_sent : 0;

        for (const rule of ABORT_RULES) {
          if (agg.emails_sent < rule.min_sends) continue;
          if (!rule.check(agg)) continue;

          // Rule triggered — abort
          await supabase
            .from('experiment_ledger')
            .update({
              outcome: 'aborted',
              scored_at: new Date().toISOString(),
              sends: agg.emails_sent,
              positive_reply_rate: agg.positive_reply_rate,
              open_rate: agg.open_rate,
              notes: `Early abort [${rule.id}]: ${rule.description}`
            })
            .eq('id', exp.id);

          // Pause the Instantly campaign immediately
          try {
            await fetch(`${BASE_URL}/campaigns/${exp.campaign_id}/pause`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${process.env.INSTANTLY_API_KEY}` }
            });
          } catch (e) {
            logger.warn('Could not pause campaign on early abort', { campaign_id: exp.campaign_id, error: e.message });
          }

          const bounceStr = agg.emails_sent > 0
            ? `Bounce rate: ${((agg.bounced / agg.emails_sent) * 100).toFixed(1)}%\n`
            : '';

          await sendTelegram(
            `ORACLE EARLY ABORT\n\n` +
            `Variant: ${exp.variant_id}\n` +
            `Rule: ${rule.label}\n` +
            `Reason: ${rule.description}\n\n` +
            `Sends: ${agg.emails_sent}\n` +
            `Open rate: ${(agg.open_rate * 100).toFixed(1)}%\n` +
            `${bounceStr}` +
            `Positive reply rate: ${(agg.positive_reply_rate * 100).toFixed(2)}%\n\n` +
            `Campaign paused. Experiment discarded. Next hypothesis will launch on the next loop cycle.`
          );

          await logActivity({
            category: 'experiment',
            level: rule.severity === 'error' ? 'error' : 'warning',
            message: `Early abort: ${exp.variant_id} — ${rule.label} (${agg.emails_sent} sends, ${(agg.open_rate * 100).toFixed(1)}% open rate)`,
            detail: { rule: rule.id, sends: agg.emails_sent, open_rate: agg.open_rate, positive_reply_rate: agg.positive_reply_rate }
          });

          logger.info('Experiment early aborted', { variant_id: exp.variant_id, rule: rule.id, sends: agg.emails_sent });
          break; // Only apply the first matching rule per experiment
        }

      } catch (err) {
        logger.error('Early abort: error checking experiment', { id: exp.id, error: err.message });
      }
    }

  } catch (err) {
    logger.error('checkForEarlyAbort error', { error: err.message });
  }
}
