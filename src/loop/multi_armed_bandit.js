import { supabase } from '../utils/supabase.js';
import { logActivity } from '../utils/activity.js';
import logger from '../utils/logger.js';

// Thompson sampling: sample from Beta(alpha, beta) distribution
// Higher alpha → more observed successes (wins)
// Higher beta  → more observed failures (losses)

function randn() {
  // Box-Muller transform for standard normal
  return Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

function sampleGamma(shape) {
  if (shape < 1) return sampleGamma(1 + shape) * Math.random() ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < 1000; i++) {
    const x = randn();
    const v = Math.pow(1 + c * x, 3);
    if (v > 0 && Math.log(Math.random()) < 0.5 * x * x + d - d * v + d * Math.log(v)) {
      return d * v;
    }
  }
  return d; // fallback
}

function sampleBeta(alpha, beta) {
  const g1 = sampleGamma(alpha);
  const g2 = sampleGamma(beta);
  const sum = g1 + g2;
  return sum > 0 ? g1 / sum : 0.5;
}

// Given a list of variant objects, return the one Thompson sampling recommends running next
export async function selectVariantThompson(candidates) {
  if (!candidates?.length) return null;
  if (candidates.length === 1) return candidates[0];

  const scores = [];
  for (const candidate of candidates) {
    const { data: state } = await supabase
      .from('bandit_state')
      .select('alpha, beta')
      .eq('variant_id', candidate.variant_id)
      .single();

    const alpha = state?.alpha || 1;
    const beta = state?.beta || 1;
    const sample = sampleBeta(alpha, beta);
    scores.push({ candidate, sample, alpha, beta });
  }

  scores.sort((a, b) => b.sample - a.sample);
  const selected = scores[0];

  await logActivity({
    category: 'bandit',
    level: 'info',
    message: `Thompson sampling selected: ${selected.candidate.variant_id} (score ${selected.sample.toFixed(3)})`,
    detail: {
      scores: scores.map(s => ({
        variant_id: s.candidate.variant_id,
        sample: parseFloat(s.sample.toFixed(4)),
        alpha: s.alpha,
        beta: s.beta
      }))
    }
  });

  return selected.candidate;
}

// Update bandit state after an experiment is scored
export async function updateBanditOutcome(variantId, outcome) {
  const { data: current } = await supabase
    .from('bandit_state')
    .select('alpha, beta, total_trials')
    .eq('variant_id', variantId)
    .single();

  const prevAlpha = current?.alpha || 1;
  const prevBeta = current?.beta || 1;
  const prevTrials = current?.total_trials || 0;

  // winner → success (alpha++), loser → failure (beta++), inconclusive → soft update both
  const newAlpha = prevAlpha + (outcome === 'winner' ? 1 : outcome === 'inconclusive' ? 0.5 : 0);
  const newBeta  = prevBeta  + (outcome === 'loser'  ? 1 : outcome === 'inconclusive' ? 0.5 : 0);

  await supabase.from('bandit_state').upsert({
    variant_id: variantId,
    alpha: newAlpha,
    beta: newBeta,
    total_trials: prevTrials + 1,
    last_updated: new Date().toISOString()
  }, { onConflict: 'variant_id' });

  logger.info('Bandit state updated', { variant_id: variantId, outcome, alpha: newAlpha, beta: newBeta });
}

export async function getBanditState() {
  const { data } = await supabase
    .from('bandit_state')
    .select('*')
    .order('total_trials', { ascending: false });
  return data || [];
}
