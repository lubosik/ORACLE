import { supabase } from '../utils/supabase.js';
import { setSetting } from '../utils/settings.js';
import { logActivity } from '../utils/activity.js';
import Anthropic from '@anthropic-ai/sdk';
import logger from '../utils/logger.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "missing-key" });

// Fast rule-based pre-filter before spending Claude tokens
function quickClassify(text) {
  if (!text || text.trim().length < 5) return null;
  const lower = text.toLowerCase();
  const unsubPhrases = ['unsubscribe', 'remove me', 'take me off', 'stop emailing', 'opt out', 'do not contact'];
  if (unsubPhrases.some(p => lower.includes(p))) return { intent: 'not_interested', sentiment: 'negative' };
  const oofPhrases = ['out of office', 'i am away', "i'm away", 'on leave', 'on holiday', 'on vacation', 'away until', 'will return', 'auto-reply', 'automatic reply'];
  if (oofPhrases.some(p => lower.includes(p))) return { intent: 'auto_reply', sentiment: 'neutral' };
  return null;
}

export async function classifyReply(replyText) {
  const quick = quickClassify(replyText);
  if (quick) return quick;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      messages: [{
        role: 'user',
        content: `Classify this cold email reply for AIRO (AI voice assistant for sales teams).

Reply: "${replyText.slice(0, 300)}"

Return ONLY JSON: {"intent": "interested|question|objection|not_interested|auto_reply|other", "sentiment": "positive|neutral|negative"}`
      }]
    });
    const match = msg.content[0].text.match(/\{[\s\S]*?\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) {
    logger.error('Reply classification error', { error: e.message });
  }

  return { intent: 'other', sentiment: 'neutral' };
}

// Classify any unclassified reply_log entries, then run clustering analysis
export async function classifyAndAnalyzeReplies() {
  try {
    // Step 1: Classify unclassified replies (batch up to 50)
    const { data: unclassified } = await supabase
      .from('reply_log')
      .select('id, inbound_message')
      .is('reply_intent', null)
      .not('inbound_message', 'is', null)
      .limit(50);

    if (unclassified?.length) {
      for (const reply of unclassified) {
        try {
          const result = await classifyReply(reply.inbound_message);
          await supabase
            .from('reply_log')
            .update({ reply_intent: result.intent, reply_sentiment: result.sentiment })
            .eq('id', reply.id);
        } catch (e) {
          logger.error('Failed to classify reply', { id: reply.id, error: e.message });
        }
      }
      logger.info('Reply classification complete', { classified: unclassified.length });
    }

    // Step 2: Cluster analysis on all classified replies
    const { data: positiveReplies } = await supabase
      .from('reply_log')
      .select('inbound_message, reply_intent, campaign_id')
      .in('reply_intent', ['interested', 'question'])
      .order('created_at', { ascending: false })
      .limit(80);

    const { data: objectionReplies } = await supabase
      .from('reply_log')
      .select('inbound_message, reply_intent')
      .eq('reply_intent', 'objection')
      .order('created_at', { ascending: false })
      .limit(30);

    const totalCount = (positiveReplies?.length || 0) + (objectionReplies?.length || 0);
    if (totalCount < 5) {
      logger.info('Reply analysis: insufficient classified replies', { count: totalCount });
      return null;
    }

    const samples = [
      ...(positiveReplies || []).slice(0, 20).map(r => `[POSITIVE - ${r.reply_intent}]: ${r.inbound_message?.slice(0, 150)}`),
      ...(objectionReplies || []).slice(0, 10).map(r => `[OBJECTION]: ${r.inbound_message?.slice(0, 150)}`)
    ].join('\n\n');

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Analyse these cold email replies for AIRO (AI voice assistant for inbound sales calls). Identify what triggers genuine interest and what objections come up.

REPLIES:
${samples}

Return ONLY valid JSON:
{
  "top_positive_triggers": ["theme that generates interest"],
  "top_objections": ["objection pattern that blocks conversion"],
  "winning_angles": ["copy or framing angle that resonates"],
  "suggested_copy_focus": "one sentence on what to test next based on these replies",
  "intent_breakdown": {"interested": 0, "question": 0, "objection": 0, "not_interested": 0, "auto_reply": 0}
}`
      }]
    });

    const jsonMatch = message.content[0].text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const analysis = JSON.parse(jsonMatch[0]);

    await supabase.from('reply_insights').insert({
      analysis_date: new Date().toISOString().split('T')[0],
      total_replies_analyzed: totalCount,
      intent_breakdown: analysis.intent_breakdown,
      top_objections: analysis.top_objections,
      top_interests: analysis.top_positive_triggers,
      winning_angles: analysis.winning_angles,
      claude_summary: analysis.suggested_copy_focus,
      raw_clusters: analysis
    });

    await setSetting('reply_analysis', JSON.stringify({
      winning_angles: analysis.winning_angles,
      top_objections: analysis.top_objections,
      top_triggers: analysis.top_positive_triggers,
      suggested_copy_focus: analysis.suggested_copy_focus,
      computed_at: new Date().toISOString()
    }));

    await logActivity({
      category: 'research',
      level: 'info',
      message: `Reply analysis complete — ${totalCount} replies analysed`,
      detail: { winning_angles: analysis.winning_angles?.slice(0, 2), top_triggers: analysis.top_positive_triggers?.slice(0, 2) }
    });

    logger.info('Reply clustering analysis complete', { total: totalCount });
    return analysis;

  } catch (err) {
    logger.error('Reply analysis error', { error: err.message });
    return null;
  }
}
