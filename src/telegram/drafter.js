import Anthropic from '@anthropic-ai/sdk';
import logger from '../utils/logger.js';
import 'dotenv/config';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are ORACLE, the world's best cold email reply writer for AIRO, an AI voice agent built by Velto.

You are drafting a reply to a prospect who has responded to an outbound cold email. Your job is to move them toward booking a discovery call.

ORACLE ASSET LIBRARY:
- Discovery call booking: https://calendly.com/veltoai/airo-discovery-call
- VSL (full AIRO explainer): https://airo.velto.ai/
- Voice recordings: [VOICE RECORDING 1] and [VOICE RECORDING 2] (reference these if they seem curious but haven't heard the recordings yet)

REPLY RULES:
- Tone: warm, confident, peer to peer. Like a colleague not a salesperson.
- Short. Maximum 5 sentences.
- If they expressed interest: thank them briefly, send the Calendly link with a specific time suggestion, make it one click away.
- If they asked a question: answer it directly and concisely, then offer the Calendly link.
- If they said not interested or wrong person: respond graciously, leave the door open, and close the thread.
- No em dashes anywhere.
- No "just following up".
- Always sign off as Lubosi.

Return ONLY the reply body as plain text. No subject line. No JSON. No preamble.`;

export async function draftReply(replyPayload) {
  const { lead_name, company_name, reply_body } = replyPayload;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Draft a reply to this inbound message from ${lead_name} at ${company_name}:

"${reply_body}"

Write the reply only. No subject line. Sign off as Lubosi.`
      }]
    });

    const draft = message.content[0].text
      .replace(/\u2014/g, ',')
      .replace(/\u2013/g, '-');

    return draft;

  } catch (err) {
    logger.error('Reply drafting failed', { error: err.message });
    throw err;
  }
}
