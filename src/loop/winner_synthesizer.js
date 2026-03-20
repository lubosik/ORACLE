import { supabase } from '../utils/supabase.js';
import { logActivity } from '../utils/activity.js';
import Anthropic from '@anthropic-ai/sdk';
import logger from '../utils/logger.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SYNTHESIS_THRESHOLD = 3;

export async function synthesizeWinners() {
  try {
    // Check when last synthesis ran
    const { data: lastSynthesis } = await supabase
      .from('winner_synthesis')
      .select('synthesized_at')
      .order('synthesized_at', { ascending: false })
      .limit(1)
      .single();

    const since = lastSynthesis?.synthesized_at || new Date(0).toISOString();

    const { data: newWinners } = await supabase
      .from('experiment_ledger')
      .select('*')
      .eq('outcome', 'winner')
      .gt('scored_at', since)
      .order('positive_reply_rate', { ascending: false });

    if (!newWinners?.length || newWinners.length < SYNTHESIS_THRESHOLD) {
      logger.info('Winner synthesis: waiting for more winners', {
        new_since_last: newWinners?.length || 0,
        threshold: SYNTHESIS_THRESHOLD
      });
      return null;
    }

    // Get all-time top winners for full context
    const { data: allWinners } = await supabase
      .from('experiment_ledger')
      .select('variant_id, what_changed, change_type, positive_reply_rate, hypothesis, delta')
      .eq('outcome', 'winner')
      .order('positive_reply_rate', { ascending: false })
      .limit(15);

    const winnerLines = (allWinners || [])
      .map(w => `- [${w.change_type}] ${w.what_changed}: ${(w.positive_reply_rate * 100).toFixed(2)}% rate (${w.delta >= 0 ? '+' : ''}${(w.delta * 100).toFixed(2)}pp vs baseline)`)
      .join('\n');

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `You are synthesising the learnings from multiple winning cold email experiments for AIRO (AI voice assistant for sales teams). Your job is to extract the universal principles that made these work.

ALL-TIME WINNING EXPERIMENTS (${allWinners?.length || 0} total, sorted by performance):
${winnerLines}

NEW WINNERS SINCE LAST SYNTHESIS (${newWinners.length}):
${newWinners.map(w => `- [${w.change_type}] ${w.what_changed}: ${w.hypothesis}`).join('\n')}

Synthesise what these winners have in common. What universal truths have we discovered about what makes cold emails work for AIRO?

Return ONLY valid JSON:
{
  "synthesis": "2-3 paragraph synthesis of what these experiments proved collectively",
  "key_principles": ["the single most impactful principle", "second principle", "third principle"],
  "highest_impact_elements": ["element with the biggest lift"],
  "recommended_sequence_changes": "specific changes to bake permanently into the default sequence",
  "meta_insight": "the single most important thing we now know that we didn't before"
}`
      }]
    });

    const jsonMatch = message.content[0].text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const synthesis = JSON.parse(jsonMatch[0]);

    await supabase.from('winner_synthesis').insert({
      synthesized_at: new Date().toISOString(),
      winners_used: newWinners.map(w => ({
        variant_id: w.variant_id,
        positive_reply_rate: w.positive_reply_rate,
        what_changed: w.what_changed,
        change_type: w.change_type,
        delta: w.delta
      })),
      synthesis: synthesis.synthesis,
      new_baseline_elements: {
        key_principles: synthesis.key_principles,
        highest_impact_elements: synthesis.highest_impact_elements,
        meta_insight: synthesis.meta_insight,
        recommended_sequence_changes: synthesis.recommended_sequence_changes
      },
      applied_to_sequence: false
    });

    await logActivity({
      category: 'research',
      level: 'success',
      message: `Winner synthesis complete — ${newWinners.length} winners synthesised`,
      detail: { meta_insight: synthesis.meta_insight, key_principles: synthesis.key_principles }
    });

    logger.info('Winner synthesis complete', { count: newWinners.length });
    return synthesis;

  } catch (err) {
    logger.error('Winner synthesis error', { error: err.message });
    return null;
  }
}

export async function getLatestSynthesis() {
  const { data } = await supabase
    .from('winner_synthesis')
    .select('*')
    .order('synthesized_at', { ascending: false })
    .limit(1)
    .single();
  return data || null;
}
