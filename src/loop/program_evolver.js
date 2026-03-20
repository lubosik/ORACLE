import { supabase } from '../utils/supabase.js';
import { logActivity } from '../utils/activity.js';
import { getCurrentBaseline } from './ledger.js';
import Anthropic from '@anthropic-ai/sdk';
import logger from '../utils/logger.js';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
    const currentProgram = await readFile(programPath, 'utf8');

    const winners = recentExps.filter(e => e.outcome === 'winner');
    const losers = recentExps.filter(e => e.outcome === 'loser');
    const inconclusive = recentExps.filter(e => e.outcome === 'inconclusive');

    const changeTypeCounts = {};
    for (const exp of recentExps) {
      const ct = exp.change_type || 'copy';
      changeTypeCounts[ct] = (changeTypeCounts[ct] || 0) + 1;
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
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

TOP WINNERS:
${winners.slice(0, 5).map(w => `- [${w.change_type}] ${w.what_changed} → ${(w.positive_reply_rate * 100).toFixed(2)}%`).join('\n') || 'None yet'}

LOSERS (avoid repeating):
${losers.slice(0, 3).map(w => `- [${w.change_type}] ${w.what_changed}`).join('\n') || 'None yet'}

Rewrite the research program based on what's actually been proven. Keep all hard constraints (no em dashes, reply-based CTA, etc). Make it more specific and data-driven. Add learnings. Remove approaches that failed. Focus experiments on the most productive territory.

Return ONLY valid JSON:
{
  "new_program_md": "the complete updated program.md content in markdown",
  "key_changes": ["what changed and why"],
  "rationale": "overall reason for this evolution"
}`
      }]
    });

    const jsonMatch = message.content[0].text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const evolution = JSON.parse(jsonMatch[0]);

    // Write updated program.md
    await writeFile(programPath, evolution.new_program_md, 'utf8');

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
