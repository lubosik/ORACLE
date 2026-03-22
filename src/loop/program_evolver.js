import { supabase } from '../utils/supabase.js';
import { logActivity } from '../utils/activity.js';
import { getCurrentBaseline, formatCopyForPrompt } from './ledger.js';
import { getSetting, setSetting } from '../utils/settings.js';
import { callAI } from '../utils/ai_client.js';
import logger from '../utils/logger.js';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const EVOLVE_AFTER_N_EXPERIMENTS = 10;

export async function evolveProgramIfReady() {
  try {
    const { data: lastEvolution } = await supabase
      .from('program_evolution')
      .select('evolved_at')
      .order('evolved_at', { ascending: false })
      .limit(1)
      .single();

    const since = lastEvolution?.evolved_at || new Date(0).toISOString();

    const { data: recentExps } = await supabase
      .from('experiment_ledger')
      .select('*')
      .gt('created_at', since)
      .not('outcome', 'eq', 'pending');

    if (!recentExps?.length || recentExps.length < EVOLVE_AFTER_N_EXPERIMENTS) {
      logger.info('Program evolution: waiting for more experiments', {
        completed_since_last: recentExps?.length || 0,
        threshold: EVOLVE_AFTER_N_EXPERIMENTS
      });
      return null;
    }

    const baseline = await getCurrentBaseline('real_estate');
    const programPath = join(__dirname, '../program.md');

    // Read from disk first; fall back to Supabase-persisted version (Railway FS is ephemeral)
    let currentProgram = '';
    try { currentProgram = await readFile(programPath, 'utf8'); } catch {}
    if (!currentProgram.trim()) {
      currentProgram = await getSetting('current_program_md', 'Maximise positive reply rate for AIRO cold email campaigns.');
    }

    const winners = recentExps.filter(e => e.outcome === 'winner');
    const losers = recentExps.filter(e => e.outcome === 'loser');
    const inconclusive = recentExps.filter(e => e.outcome === 'inconclusive');

    // Fetch copy snapshots for winners and top losers so the AI can see what the emails actually said
    const copyVariantIds = [...new Set([
      ...winners.slice(0, 5).map(e => e.variant_id),
      ...losers.slice(0, 3).map(e => e.variant_id)
    ].filter(Boolean))];
    const { data: copyDrafts } = await supabase
      .from('campaign_drafts')
      .select('variant_id, sequence_snapshot')
      .in('variant_id', copyVariantIds);
    const copyByVariant = {};
    for (const d of copyDrafts || []) {
      if (d.variant_id && d.sequence_snapshot) copyByVariant[d.variant_id] = d.sequence_snapshot;
    }

    const changeTypeCounts = {};
    for (const exp of recentExps) {
      const ct = exp.change_type || 'copy';
      changeTypeCounts[ct] = (changeTypeCounts[ct] || 0) + 1;
    }

    const evolveRaw = await callAI({
      messages: [{
        role: 'user',
        content: `You are evolving the research program for ORACLE, an autonomous cold email optimisation engine for AIRO.

CURRENT RESEARCH PROGRAM:
${currentProgram}

EXPERIMENT RESULTS SINCE LAST EVOLUTION (${recentExps.length} total):
- Winners: ${winners.length}
- Losers: ${losers.length}
- Inconclusive: ${inconclusive.length}

CHANGE TYPE DISTRIBUTION:
${Object.entries(changeTypeCounts).map(([k, v]) => `  ${k}: ${v} experiments`).join('\n')}

CURRENT BASELINE RATE: ${baseline?.positive_reply_rate ? (baseline.positive_reply_rate * 100).toFixed(2) + '%' : 'Not yet established'}

TOP WINNERS (with actual email copy):
${winners.slice(0, 5).map(w => `- [${w.change_type}] ${w.what_changed} → ${(w.positive_reply_rate * 100).toFixed(2)}%\n${formatCopyForPrompt(copyByVariant[w.variant_id] || null, { bodyChars: 200 })}`).join('\n\n') || 'None yet'}

LOSERS — avoid repeating these (with copy):
${losers.slice(0, 3).map(w => `- [${w.change_type}] ${w.what_changed}\n${formatCopyForPrompt(copyByVariant[w.variant_id] || null, { bodyChars: 120 })}`).join('\n\n') || 'None yet'}

Rewrite the research program based on what's actually been proven. Keep all hard constraints (no em dashes, reply-based CTA, etc). Make it more specific and data-driven. Add learnings. Remove approaches that failed. Focus experiments on the most productive territory.

Return ONLY valid JSON:
{
  "new_program_md": "the complete updated program.md content in markdown",
  "key_changes": ["what changed and why"],
  "rationale": "overall reason for this evolution"
}`
      }],
      maxTokens: 2000
    });

    const jsonMatch = evolveRaw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const evolution = JSON.parse(jsonMatch[0]);

    // Write to disk (fast access) AND Supabase setting (survives Railway redeploys)
    try { await writeFile(programPath, evolution.new_program_md, 'utf8'); } catch {}
    await setSetting('current_program_md', evolution.new_program_md);

    await supabase.from('program_evolution').insert({
      evolved_at: new Date().toISOString(),
      old_program: currentProgram,
      new_program: evolution.new_program_md,
      rationale: evolution.rationale,
      performance_context: {
        baseline_rate: baseline?.positive_reply_rate,
        experiments_run: recentExps.length,
        winners: winners.length,
        top_change_types: changeTypeCounts
      }
    });

    await logActivity({
      category: 'research',
      level: 'success',
      message: `Research program evolved — ${evolution.key_changes?.length} changes applied`,
      detail: { key_changes: evolution.key_changes, rationale: evolution.rationale }
    });

    logger.info('Program evolution complete', { experiments_used: recentExps.length });
    return evolution;

  } catch (err) {
    logger.error('Program evolution error', { error: err.message });
    return null;
  }
}
