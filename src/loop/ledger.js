import { supabase } from '../utils/supabase.js';
import logger from '../utils/logger.js';

export async function getRecentExperiments(limit = 10) {
  const { data, error } = await supabase
    .from('experiment_ledger')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('Failed to fetch experiment ledger', { error: error.message });
    return [];
  }

  return data || [];
}

/**
 * Returns recent experiments enriched with their actual email copy from campaign_drafts.
 * Uses variant_id as the join key.
 */
export async function getRecentExperimentsWithCopy(limit = 10) {
  const experiments = await getRecentExperiments(limit);
  if (!experiments.length) return experiments;

  const variantIds = [...new Set(experiments.map(e => e.variant_id).filter(Boolean))];

  const { data: drafts } = await supabase
    .from('campaign_drafts')
    .select('variant_id, sequence_snapshot')
    .in('variant_id', variantIds);

  const copyByVariant = {};
  for (const d of drafts || []) {
    if (d.variant_id && d.sequence_snapshot) {
      copyByVariant[d.variant_id] = d.sequence_snapshot;
    }
  }

  return experiments.map(e => ({
    ...e,
    sequence_snapshot: copyByVariant[e.variant_id] || null
  }));
}

/**
 * Formats a sequence_snapshot into a compact copy block for AI prompts.
 * Includes all 4 subject lines and truncated bodies.
 */
export function formatCopyForPrompt(seq, { bodyChars = 200 } = {}) {
  if (!seq) return '  [No copy snapshot available]';
  const lines = [];
  for (let i = 1; i <= 4; i++) {
    const email = seq[`email_${i}`];
    if (!email) continue;
    const body = (email.body || '').replace(/\s+/g, ' ').trim();
    lines.push(`  Email ${i} subject: "${email.subject}"`);
    lines.push(`  Email ${i} body: "${body.slice(0, bodyChars)}${body.length > bodyChars ? '...' : ''}"`);
  }
  return lines.join('\n');
}

export async function getCurrentBaseline(vertical = 'real_estate') {
  const { data, error } = await supabase
    .from('baselines')
    .select('*')
    .eq('vertical', vertical)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Failed to fetch baseline', { error: error.message });
  }

  return data || null;
}

export async function logExperiment(experiment) {
  const { data, error } = await supabase
    .from('experiment_ledger')
    .insert({
      variant_id: experiment.variant_id,
      campaign_id: experiment.campaign_id,
      hypothesis: experiment.hypothesis,
      what_changed: experiment.what_changed,
      change_type: experiment.change_type || null,
      schedule_snapshot: experiment.schedule_snapshot || null,
      launched_at: new Date().toISOString(),
      outcome: 'pending'
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to log experiment', { error: error.message });
    return null;
  }

  return data;
}

export async function updateExperimentResult(experimentId, stats) {
  const { error } = await supabase
    .from('experiment_ledger')
    .update({
      scored_at: new Date().toISOString(),
      sends: stats.sends,
      positive_replies: stats.positive_replies,
      positive_reply_rate: stats.positive_reply_rate,
      open_rate: stats.open_rate,
      baseline_rate: stats.baseline_rate,
      delta: stats.delta,
      outcome: stats.outcome,
      notes: stats.notes
    })
    .eq('id', experimentId);

  if (error) {
    logger.error('Failed to update experiment result', { error: error.message });
  }
}

export async function promoteToBaseline(variantId, positiveReplyRate, sequenceSnapshot, vertical = 'real_estate') {
  const { error } = await supabase
    .from('baselines')
    .upsert({
      vertical,
      variant_id: variantId,
      positive_reply_rate: positiveReplyRate,
      sequence_snapshot: sequenceSnapshot,
      promoted_at: new Date().toISOString()
    }, { onConflict: 'vertical' });

  if (error) {
    logger.error('Failed to promote to baseline', { error: error.message });
  }
}
