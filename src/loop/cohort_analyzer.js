import { supabase } from '../utils/supabase.js';
import { setSetting } from '../utils/settings.js';
import { logActivity } from '../utils/activity.js';
import Anthropic from '@anthropic-ai/sdk';
import logger from '../utils/logger.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "missing-key" });

export async function analyzeCohorts() {
  try {
    const { data: insights } = await supabase
      .from('cohort_insights')
      .select('*')
      .gte('emails_sent', 5)
      .order('reply_rate', { ascending: false });

    if (!insights?.length) {
      logger.info('Cohort analysis: no meaningful cohort data yet');
      return null;
    }

    const top = insights.slice(0, 10);
    const bottom = insights.filter(c => c.emails_sent >= 10).slice(-5);

    if (top.length < 3) {
      logger.info('Cohort analysis: not enough cohorts for meaningful analysis');
      return null;
    }

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Cold email cohort performance data for AIRO (AI inbound sales call handler).

TOP PERFORMING COHORTS (highest reply rate):
${top.map(c => `- ${c.title} | ${c.country} | ${c.company_size_bucket}: ${(c.reply_rate * 100).toFixed(2)}% (n=${c.emails_sent})`).join('\n')}

WEAKEST COHORTS:
${bottom.map(c => `- ${c.title} | ${c.country} | ${c.company_size_bucket}: ${(c.reply_rate * 100).toFixed(2)}% (n=${c.emails_sent})`).join('\n')}

Based on this data, describe the ideal prospect profile.

Return ONLY JSON:
{
  "ideal_prospect": "one sentence describing the single best prospect type",
  "best_title": "single best performing job title",
  "best_country": "best performing country",
  "best_size": "best performing company size bucket",
  "avoid": "what profile consistently underperforms",
  "confidence": "low|medium|high based on sample sizes"
}`
      }]
    });

    const jsonMatch = message.content[0].text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return null;

    const analysis = JSON.parse(jsonMatch[0]);

    await setSetting('cohort_analysis', JSON.stringify({
      ...analysis,
      computed_at: new Date().toISOString(),
      cohorts_analysed: insights.length
    }));

    await logActivity({
      category: 'research',
      level: 'info',
      message: `Cohort analysis updated — ideal prospect: ${analysis.ideal_prospect}`,
      detail: analysis
    });

    return analysis;

  } catch (err) {
    logger.error('Cohort analysis error', { error: err.message });
    return null;
  }
}
