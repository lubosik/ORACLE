import { callAI } from '../utils/ai_client.js';
import { getRecentExperimentsWithCopy, formatCopyForPrompt } from './ledger.js';
import { getSetting } from '../utils/settings.js';
import logger from '../utils/logger.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';
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

export async function generateHypothesis(ledgerEntries, currentBaseline, timingInsights = null, currentSchedule = null, intelligence = null, sentimentSummary = null) {
  let programMd = '';
  try { programMd = await readFile(join(__dirname, '../program.md'), 'utf8'); } catch {}
  // Fall back to Supabase-persisted version if disk file is missing (Railway FS is ephemeral)
  if (!programMd.trim()) {
    programMd = await getSetting('current_program_md', 'Maximise positive reply rate for AIRO cold email campaigns.');
  }

  const ledgerSummary = ledgerEntries.length
    ? ledgerEntries.map(e => {
        const rate = e.positive_reply_rate != null ? (e.positive_reply_rate * 100).toFixed(2) + '%' : 'pending';
        const copy = formatCopyForPrompt(e.sequence_snapshot, { bodyChars: 180 });
        return `- ${e.variant_id} [${e.change_type || 'copy'}]: ${e.what_changed} | rate: ${rate} | outcome: ${e.outcome}\n${copy}`;
      }).join('\n\n')
    : 'No experiments yet. This is the first hypothesis.';

  const baselineRate = currentBaseline?.positive_reply_rate
    ? `${(currentBaseline.positive_reply_rate * 100).toFixed(2)}%`
    : 'Not yet established';

  const timingSection = buildTimingSection(timingInsights, currentSchedule);
  const intelligenceSection = buildIntelligenceSection(intelligence);

  let sentimentSection = '';
  if (sentimentSummary?.week_counts) {
    const counts = sentimentSummary.week_counts;
    const lines = ['REPLY SENTIMENT THIS WEEK:'];
    for (const [type, n] of Object.entries(counts)) {
      lines.push(`  ${type}: ${n}`);
    }
    sentimentSection = lines.join('\n');
  }

  const content = await callAI({
    systemPrompt: `You are an expert cold email strategist running weekly improvement experiments on an outbound sequence for AIRO, an AI voice agent for real estate businesses.

THE BASELINE SEQUENCE PHILOSOPHY:
The sequence leads with a real case study result (30,000 leads contacted, 3,000 picked up, 576 qualified buyers, Cayman Islands land development firm). It uses outcome-first language throughout. It does not explain AIRO as a technology. It explains it as a result. The cold pipeline offer (run on dead leads first, no risk to live pipeline) is the primary risk reversal. The voice recordings are the primary proof asset in Email 2. The VSL (https://airo.velto.ai/) is the primary conversion asset in Email 3.

THE EXPERIMENT LOOP OBJECTIVE:
Each week, propose ONE specific change to test against the current baseline. One change only. If you change multiple things at once, you cannot know what worked.

WHAT TO ANALYSE BEFORE PROPOSING:
Look at the analytics from the most recent campaign cycle: open rate per email step, reply rate per email step, positive reply rate (genuine interest, not unsubscribes), click rate on VSL link in Email 3, sentiment of replies (positive, neutral, negative, objection type), which step most replies come from.

WHAT GOOD HYPOTHESES LOOK LIKE:
- "Email 1 subject line is the first name only. Testing a subject with the Cayman stat (576 buyers) because specificity in subject lines has historically outperformed plausible deniability for outcome-led openers in property."
- "Email 2 is performing well on opens but the reply rate is lower than expected. Testing a shorter version that leads with the recordings link immediately and removes the context paragraph."
- "Email 4 is getting low open rates. Testing subject line 'still in your pipeline' instead of 'one thing before I go' because it speaks to the cold leads asset directly."

WHAT BAD HYPOTHESES LOOK LIKE (never propose these):
- Changing the tone to be more formal
- Adding bullet points to any email
- Making emails longer
- Adding a calendar link to Email 1 or Email 2
- Changing the Cayman case study numbers
- Using em dashes anywhere

CRITICAL INVARIANTS — NEVER CHANGE THESE:
- The Cayman numbers: 30,000 contacted, over 3,000 picked up, 576 qualified buyers, $2.5M average deal
- Voice recording URLs: https://airo.velto.ai/audio/wire-transfer.mp3 and https://airo.velto.ai/audio/not-ai.mp3
- VSL URL: https://airo.velto.ai/
- Cold pipeline risk reversal stays in Email 1
- Email 2 always contains both voice recording links
- Email 5 is the day-44 re-engagement and always stays in the sequence`,
    messages: [{
      role: 'user',
      content: `RESEARCH PROGRAM:
${programMd}

CURRENT BASELINE POSITIVE REPLY RATE: ${baselineRate}

RECENT EXPERIMENT LEDGER (last 10):
${ledgerSummary}

${timingSection ? timingSection + '\n' : ''}${intelligenceSection ? intelligenceSection + '\n' : ''}${sentimentSection ? sentimentSection + '\n\n' : ''}Propose ONE specific, testable change that you believe will improve positive reply rate. You may test either copy changes OR sending schedule changes based on the data above. Be concrete and data-driven.

If proposing a schedule change, set change_type to "send_schedule" and populate schedule_changes with the new values. Leave instructions_for_copywriter as null.
If proposing a copy change, set change_type to one of the copy types and leave schedule_changes as null.

Return ONLY valid JSON:
{
  "variant_id": "v_{{short_descriptor}}_{{unix_timestamp}}",
  "hypothesis": "one sentence: what you believe and why",
  "what_changed": "specific description of the change",
  "change_type": "subject_line | opening_line | offer_framing | social_proof | cta | email_3_education | email_4_close | email_5_reengagement | send_schedule",
  "instructions_for_copywriter": "precise copy instructions, or null if this is a schedule experiment",
  "expected_metric": "open_rate | reply_rate | positive_reply_rate | vsl_click_rate",
  "expected_direction": "increase | decrease",
  "reasoning": "two to three sentences on why this change should move the metric in that direction based on the analytics data provided",
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
    }],
    maxTokens: 2000,
    module: 'hypothesis'
  });

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
