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
