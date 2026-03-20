import { supabase } from '../utils/supabase.js';
import { setSetting } from '../utils/settings.js';
import { logActivity } from '../utils/activity.js';
import logger from '../utils/logger.js';

export async function analyzeStepPerformance() {
  try {
    const { data: replies } = await supabase
      .from('reply_log')
      .select('campaign_id, email_step, reply_intent')
      .not('email_step', 'is', null);

    if (!replies?.length) {
      logger.info('Step analysis: no step-attributed replies yet');
      return null;
    }

    // Aggregate across all campaigns
    const global = { 1: { total: 0, positive: 0 }, 2: { total: 0, positive: 0 }, 3: { total: 0, positive: 0 }, 4: { total: 0, positive: 0 } };
    const byCampaign = {};

    for (const reply of replies) {
      const step = reply.email_step;
      if (step >= 1 && step <= 4) {
        global[step].total++;
        if (['interested', 'question'].includes(reply.reply_intent) || reply.reply_intent == null) {
          global[step].positive++;
        }
      }

      if (reply.campaign_id) {
        if (!byCampaign[reply.campaign_id]) byCampaign[reply.campaign_id] = { step1: 0, step2: 0, step3: 0, step4: 0 };
        if (step >= 1 && step <= 4) byCampaign[reply.campaign_id][`step${step}`]++;
      }
    }

    const stepSummary = {};
    let bestStep = null;
    let bestCount = -1;

    for (const [step, counts] of Object.entries(global)) {
      stepSummary[`step_${step}`] = {
        total_replies: counts.total,
        positive_replies: counts.positive,
        positive_rate: counts.total > 0 ? counts.positive / counts.total : 0
      };
      if (counts.positive > bestCount) {
        bestCount = counts.positive;
        bestStep = `step_${step}`;
      }
    }

    // Persist step attribution records per campaign (latest run per campaign)
    for (const [campaignId, counts] of Object.entries(byCampaign)) {
      const total = counts.step1 + counts.step2 + counts.step3 + counts.step4;
      await supabase.from('step_attribution').insert({
        campaign_id: campaignId,
        step_1_replies: counts.step1,
        step_2_replies: counts.step2,
        step_3_replies: counts.step3,
        step_4_replies: counts.step4,
        total_replies: total,
        computed_at: new Date().toISOString()
      });
    }

    const result = {
      ...stepSummary,
      best_step: bestStep,
      total_attributed_replies: replies.length,
      computed_at: new Date().toISOString()
    };

    await setSetting('step_attribution', JSON.stringify(result));

    await logActivity({
      category: 'research',
      level: 'info',
      message: `Step attribution computed — best step: ${bestStep} with ${bestCount} positive replies`,
      detail: stepSummary
    });

    logger.info('Step analysis complete', { best_step: bestStep, total_replies: replies.length });
    return result;

  } catch (err) {
    logger.error('Step analysis error', { error: err.message });
    return null;
  }
}
