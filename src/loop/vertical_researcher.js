import { supabase } from '../utils/supabase.js';
import { getCurrentBaseline } from './ledger.js';
import { logActivity } from '../utils/activity.js';
import Anthropic from '@anthropic-ai/sdk';
import logger from '../utils/logger.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "missing-key" });
const PROPOSE_AFTER_EXPERIMENTS = 15;
const MAX_PENDING_PROPOSALS = 3;

export async function proposeVerticalExpansion() {
  try {
    const { count: expCount } = await supabase
      .from('experiment_ledger')
      .select('*', { count: 'exact', head: true });

    if ((expCount || 0) < PROPOSE_AFTER_EXPERIMENTS) {
      logger.info('Vertical research: not enough experiments yet', { count: expCount, threshold: PROPOSE_AFTER_EXPERIMENTS });
      return null;
    }

    // Don't flood with proposals
    const { data: pending } = await supabase
      .from('verticals')
      .select('name')
      .eq('status', 'proposed');

    if ((pending?.length || 0) >= MAX_PENDING_PROPOSALS) {
      logger.info('Vertical research: max pending proposals reached');
      return null;
    }

    // Get all existing verticals to avoid duplicates
    const { data: existing } = await supabase.from('verticals').select('name');
    const existingNames = (existing || []).map(v => v.name).join(', ');

    const baseline = await getCurrentBaseline('real_estate');
    const { data: winners } = await supabase
      .from('experiment_ledger')
      .select('what_changed, positive_reply_rate, change_type')
      .eq('outcome', 'winner')
      .order('positive_reply_rate', { ascending: false })
      .limit(5);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `ORACLE is an autonomous cold email engine for AIRO — an AI voice assistant that handles inbound sales calls for businesses with high inbound call volume.

Current real estate performance: ${baseline?.positive_reply_rate ? (baseline.positive_reply_rate * 100).toFixed(2) + '% positive reply rate' : 'establishing baseline'}

What worked in real estate (winning experiments):
${(winners || []).map(w => `- ${w.what_changed}: ${(w.positive_reply_rate * 100).toFixed(2)}%`).join('\n') || 'Still gathering data'}

Existing verticals (do not propose these): ${existingNames}

Propose 2 new verticals where AIRO would be highly valuable. Think about industries with:
- High inbound call volume
- Sales teams handling repeated similar calls
- Decision makers reachable via cold email
- Budget for AI sales tools

Return ONLY valid JSON array:
[
  {
    "name": "snake_case_name",
    "description": "one line description",
    "icp_description": "who exactly to target in this vertical",
    "proposed_rationale": "why AIRO solves a real pain here and why reply rates should be good",
    "apify_titles": ["Decision Maker Title 1", "Title 2", "Title 3"],
    "apify_industries": ["Industry Name 1", "Industry Name 2"],
    "apify_countries": ["United Kingdom", "United States"]
  }
]`
      }]
    });

    const jsonMatch = message.content[0].text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;

    const proposals = JSON.parse(jsonMatch[0]);
    const inserted = [];

    for (const p of proposals) {
      const { data, error } = await supabase.from('verticals').upsert({
        name: p.name,
        description: p.description,
        icp_description: p.icp_description,
        apify_input: {
          personTitle: p.apify_titles,
          industry: p.apify_industries,
          personCountry: p.apify_countries,
          contactEmailStatus: 'verified',
          includeEmails: true
        },
        status: 'proposed',
        proposed_rationale: p.proposed_rationale,
        updated_at: new Date().toISOString()
      }, { onConflict: 'name' });

      if (!error) inserted.push(p.name);
    }

    await logActivity({
      category: 'research',
      level: 'info',
      message: `Vertical expansion proposed: ${inserted.join(', ')}`,
      detail: { proposals: proposals.map(p => ({ name: p.name, rationale: p.proposed_rationale })) }
    });

    logger.info('Vertical proposals added', { count: inserted.length });
    return proposals;

  } catch (err) {
    logger.error('Vertical research error', { error: err.message });
    return null;
  }
}

export async function getVerticals() {
  const { data } = await supabase
    .from('verticals')
    .select('*')
    .order('created_at', { ascending: false });
  return data || [];
}

export async function updateVerticalStatus(id, status) {
  const { error } = await supabase
    .from('verticals')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  return !error;
}
