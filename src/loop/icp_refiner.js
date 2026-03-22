import { supabase } from '../utils/supabase.js';
import { getSetting, setSetting } from '../utils/settings.js';
import { logActivity } from '../utils/activity.js';
import { callAI } from '../utils/ai_client.js';
import logger from '../utils/logger.js';

export async function analyzeICPPerformance() {
  try {
    // Get all leads who were campaigned with their profile data
    const { data: allLeads } = await supabase
      .from('seen_leads')
      .select('email, title, country, company_size_bucket, last_campaigned_at')
      .not('last_campaigned_at', 'is', null);

    if (!allLeads?.length) {
      logger.info('ICP analysis: no campaigned leads yet');
      return null;
    }

    // Get positive reply emails
    const { data: positiveReplies } = await supabase
      .from('reply_log')
      .select('lead_email')
      .in('reply_intent', ['interested', 'question']);

    const positiveEmailSet = new Set((positiveReplies || []).map(r => r.lead_email));

    // Build cohort map: (title, country, size) → stats
    const cohortMap = {};
    for (const lead of allLeads) {
      const key = `${lead.title || 'Unknown'}|${lead.country || 'Unknown'}|${lead.company_size_bucket || 'unknown'}`;
      if (!cohortMap[key]) {
        cohortMap[key] = {
          title: lead.title || 'Unknown',
          country: lead.country || 'Unknown',
          company_size_bucket: lead.company_size_bucket || 'unknown',
          emails_sent: 0,
          positive_replies: 0
        };
      }
      cohortMap[key].emails_sent++;
      if (positiveEmailSet.has(lead.email)) {
        cohortMap[key].positive_replies++;
      }
    }

    // Upsert cohort_insights and icp_performance
    for (const [key, cohort] of Object.entries(cohortMap)) {
      const rate = cohort.emails_sent > 0 ? cohort.positive_replies / cohort.emails_sent : 0;

      await supabase.from('cohort_insights').upsert({
        cohort_key: key,
        title: cohort.title,
        country: cohort.country,
        company_size_bucket: cohort.company_size_bucket,
        emails_sent: cohort.emails_sent,
        positive_replies: cohort.positive_replies,
        reply_rate: rate,
        sample_size: cohort.emails_sent,
        last_updated: new Date().toISOString()
      }, { onConflict: 'cohort_key' });

      await supabase.from('icp_performance').upsert({
        title: cohort.title,
        country: cohort.country,
        company_size_bucket: cohort.company_size_bucket,
        emails_sent: cohort.emails_sent,
        positive_replies: cohort.positive_replies,
        reply_rate: rate,
        last_computed_at: new Date().toISOString()
      }, { onConflict: 'title,country,company_size_bucket' });
    }

    // Only run Claude synthesis if we have enough statistically meaningful cohorts
    const meaningful = Object.values(cohortMap).filter(c => c.emails_sent >= 10);
    if (meaningful.length < 3) {
      logger.info('ICP analysis: cohort data stored, not enough volume for synthesis yet');
      return null;
    }

    const sorted = meaningful.sort((a, b) => (b.positive_replies / b.emails_sent) - (a.positive_replies / a.emails_sent));
    const top = sorted.slice(0, 5);
    const bottom = sorted.slice(-3);

    const currentICP = await getSetting('refined_icp', 'Default: Real estate directors/CEOs in UK and US, 2-500 employees');

    const icpRaw = await callAI({
      messages: [{
        role: 'user',
        content: `Refine the cold email ICP (Ideal Customer Profile) for AIRO based on real performance data.

TOP PERFORMING COHORTS (highest reply rate, min 10 sent):
${top.map(c => `- ${c.title} | ${c.country} | ${c.company_size_bucket}: ${(c.positive_replies / c.emails_sent * 100).toFixed(2)}% reply rate (n=${c.emails_sent})`).join('\n')}

WEAKEST COHORTS:
${bottom.map(c => `- ${c.title} | ${c.country} | ${c.company_size_bucket}: ${(c.positive_replies / c.emails_sent * 100).toFixed(2)}% reply rate (n=${c.emails_sent})`).join('\n')}

Current ICP: ${currentICP}

Return ONLY valid JSON:
{
  "refined_icp_description": "one paragraph on who to target and why",
  "priority_titles": ["best performing title 1", "title 2"],
  "priority_countries": ["best country"],
  "priority_sizes": ["micro", "small"],
  "deprioritize": "what profile to reduce targeting on",
  "rationale": "data-driven reason for this refinement"
}`
      }],
      maxTokens: 600
    });

    const jsonMatch = icpRaw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const refinement = JSON.parse(jsonMatch[0]);
    await setSetting('refined_icp', JSON.stringify(refinement));

    await logActivity({
      category: 'research',
      level: 'info',
      message: `ICP refined — priority: ${refinement.priority_titles?.join(', ')} in ${refinement.priority_countries?.join(', ')}`,
      detail: refinement
    });

    logger.info('ICP analysis complete', { cohorts_analysed: meaningful.length });
    return refinement;

  } catch (err) {
    logger.error('ICP analysis error', { error: err.message });
    return null;
  }
}

export async function getTopICPCohorts(limit = 10) {
  const { data } = await supabase
    .from('cohort_insights')
    .select('*')
    .gte('emails_sent', 5)
    .order('reply_rate', { ascending: false })
    .limit(limit);
  return data || [];
}
