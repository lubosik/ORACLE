import Anthropic from '@anthropic-ai/sdk';
import logger from '../utils/logger.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const __dirname = dirname(fileURLToPath(import.meta.url));

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function buildTimingSection(timingInsights, currentSchedule) {
  const lines = [];

  if (timingInsights?.by_day) {
    lines.push('DAY-OF-WEEK PERFORMANCE (weighted by emails sent):');
    for (const [dow, v] of Object.entries(timingInsights.by_day)) {
      if (!v) continue;
      lines.push(`  ${DAY_NAMES[dow]}: ${(v.avg_reply_rate * 100).toFixed(2)}% reply rate, ${(v.avg_open_rate * 100).toFixed(1)}% open rate (n=${v.total_sent} emails)`);
    }
  }

  if (currentSchedule) {
    const activeDays = currentSchedule.days.map(d => DAY_NAMES[d] || d).join(', ');
    lines.push(`\nCURRENT SEND SCHEDULE: ${currentSchedule.timeFrom}–${currentSchedule.timeTo} ${currentSchedule.timezone}, Days: ${activeDays}, Daily limit: ${currentSchedule.dailyLimit}`);
  }

  return lines.length ? lines.join('\n') : '';
}

function buildIntelligenceSection(intelligence) {
  if (!intelligence) return '';
  const lines = [];

  if (intelligence.replyAnalysis) {
    const ra = typeof intelligence.replyAnalysis === 'string' ? JSON.parse(intelligence.replyAnalysis) : intelligence.replyAnalysis;
    if (ra.winning_angles?.length) {
      lines.push('REPLY ANALYSIS — WINNING COPY ANGLES (from real replies):');
      ra.winning_angles.forEach(a => lines.push(`  - ${a}`));
    }
    if (ra.top_objections?.length) {
      lines.push('TOP OBJECTIONS TO ADDRESS:');
      ra.top_objections.forEach(o => lines.push(`  - ${o}`));
    }
    if (ra.suggested_copy_focus) {
      lines.push(`SUGGESTED COPY FOCUS: ${ra.suggested_copy_focus}`);
    }
  }

  if (intelligence.stepAttribution) {
    const sa = typeof intelligence.stepAttribution === 'string' ? JSON.parse(intelligence.stepAttribution) : intelligence.stepAttribution;
    if (sa.best_step) {
      lines.push(`\nSTEP ATTRIBUTION — Most replies come from ${sa.best_step.replace('_', ' ')}:`);
      for (const k of ['step_1', 'step_2', 'step_3', 'step_4']) {
        if (sa[k]) lines.push(`  ${k}: ${sa[k].positive_replies} positive replies (${(sa[k].positive_rate * 100).toFixed(1)}%)`);
      }
    }
  }

  if (intelligence.cohortAnalysis) {
    const ca = typeof intelligence.cohortAnalysis === 'string' ? JSON.parse(intelligence.cohortAnalysis) : intelligence.cohortAnalysis;
    if (ca.ideal_prospect) {
      lines.push(`\nCOHORT ANALYSIS — Ideal prospect: ${ca.ideal_prospect}`);
      if (ca.avoid) lines.push(`  Avoid: ${ca.avoid}`);
    }
  }

  if (intelligence.winnerSynthesis) {
    const ws = intelligence.winnerSynthesis;
    if (ws.new_baseline_elements?.meta_insight) {
      lines.push(`\nWINNER META-INSIGHT: ${ws.new_baseline_elements.meta_insight}`);
    }
    if (ws.new_baseline_elements?.key_principles?.length) {
      lines.push('KEY PROVEN PRINCIPLES:');
      ws.new_baseline_elements.key_principles.forEach(p => lines.push(`  - ${p}`));
    }
  }

  return lines.length ? lines.join('\n') : '';
}

export async function generateHypothesis(ledgerEntries, currentBaseline, timingInsights = null, currentSchedule = null, intelligence = null) {
  let programMd = '';
  try {
    programMd = await readFile(join(__dirname, '../program.md'), 'utf8');
  } catch {
    programMd = 'Maximise positive reply rate for AIRO cold email campaigns.';
  }

  const ledgerSummary = ledgerEntries.length
    ? ledgerEntries.map(e =>
        `- ${e.variant_id} [${e.change_type || 'copy'}]: ${e.what_changed} | rate: ${e.positive_reply_rate != null ? (e.positive_reply_rate * 100).toFixed(2) + '%' : 'pending'} | outcome: ${e.outcome}`
      ).join('\n')
    : 'No experiments yet. This is the first hypothesis.';

  const baselineRate = currentBaseline?.positive_reply_rate
    ? `${(currentBaseline.positive_reply_rate * 100).toFixed(2)}%`
    : 'Not yet established';

  const timingSection = buildTimingSection(timingInsights, currentSchedule);
  const intelligenceSection = buildIntelligenceSection(intelligence);

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 900,
    messages: [{
      role: 'user',
      content: `You are running Karpathy-style self-improvement experiments on cold email campaigns for AIRO.

RESEARCH PROGRAM:
${programMd}

CURRENT BASELINE POSITIVE REPLY RATE: ${baselineRate}

RECENT EXPERIMENT LEDGER (last 10):
${ledgerSummary}

${timingSection ? timingSection + '\n' : ''}${intelligenceSection ? intelligenceSection + '\n' : ''}
Propose ONE specific, testable change that you believe will improve positive reply rate. You may test either copy changes OR sending schedule changes based on the data above. Be concrete and data-driven.

If proposing a schedule change, set change_type to "send_schedule" and populate schedule_changes with the new values. Leave instructions_for_copywriter as null.
If proposing a copy change, set change_type to one of the copy types and leave schedule_changes as null.

Return ONLY valid JSON:
{
  "variant_id": "v_{{short_descriptor}}_{{unix_timestamp}}",
  "hypothesis": "one sentence: what you believe and why",
  "what_changed": "specific description of the change",
  "change_type": "subject_line | opening_line | offer_framing | social_proof | cta | email_3_education | email_4_close | send_schedule",
  "instructions_for_copywriter": "precise copy instructions, or null if this is a schedule experiment",
  "schedule_changes": null
}

For schedule_changes (only when change_type is send_schedule), use:
{
  "timeFrom": "HH:MM",
  "timeTo": "HH:MM",
  "days": ["1","2","3","4","5"],
  "dailyLimit": 50,
  "rationale": "why this schedule should outperform"
}`
    }]
  });

  const content = message.content[0].text;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in hypothesis response');

  const hypothesis = JSON.parse(jsonMatch[0]);
  const ts = Math.floor(Date.now() / 1000);
  hypothesis.variant_id = hypothesis.variant_id.replace('{{unix_timestamp}}', ts);

  logger.info('Hypothesis generated', {
    variant_id: hypothesis.variant_id,
    change_type: hypothesis.change_type
  });

  return hypothesis;
}
