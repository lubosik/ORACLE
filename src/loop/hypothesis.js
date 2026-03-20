import Anthropic from '@anthropic-ai/sdk';
import logger from '../utils/logger.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const __dirname = dirname(fileURLToPath(import.meta.url));

export async function generateHypothesis(ledgerEntries, currentBaseline) {
  let programMd = '';
  try {
    programMd = await readFile(join(__dirname, '../program.md'), 'utf8');
  } catch {
    programMd = 'Maximise positive reply rate for AIRO cold email campaigns.';
  }

  const ledgerSummary = ledgerEntries.length
    ? ledgerEntries.map(e =>
        `- ${e.variant_id}: ${e.what_changed} | rate: ${e.positive_reply_rate || 'pending'} | outcome: ${e.outcome}`
      ).join('\n')
    : 'No experiments yet. This is the first hypothesis.';

  const baselineRate = currentBaseline?.positive_reply_rate
    ? `${(currentBaseline.positive_reply_rate * 100).toFixed(2)}%`
    : 'Not yet established';

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `You are running Karpathy-style self-improvement experiments on cold email sequences for AIRO.

RESEARCH PROGRAM:
${programMd}

CURRENT BASELINE POSITIVE REPLY RATE: ${baselineRate}

RECENT EXPERIMENT LEDGER (last 10):
${ledgerSummary}

Propose ONE specific, testable change to the email sequence. Be concrete. Name exactly what changes and why you believe it will improve positive reply rate.

Return ONLY valid JSON:
{
  "variant_id": "v_{{short_descriptor}}_{{unix_timestamp}}",
  "hypothesis": "one sentence: what you believe and why",
  "what_changed": "specific description of the change",
  "change_type": "subject_line | opening_line | offer_framing | social_proof | cta | email_3_education | email_4_close",
  "instructions_for_copywriter": "precise instructions: what to do differently when generating copy for this variant"
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
