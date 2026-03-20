import Anthropic from '@anthropic-ai/sdk';
import { buildAssetLibraryPrompt } from '../utils/assets.js';
import logger from '../utils/logger.js';
import 'dotenv/config';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(assetLibrary, emailStep) {
  const stepContext = emailStep
    ? `The lead is replying to Email ${emailStep} in the sequence.`
    : 'Unknown which email in the sequence they are replying to.';

  return `You are ORACLE, the world's best cold email reply writer for AIRO, an AI voice agent built by Velto.

You are drafting a reply to a prospect who has responded to an outbound cold email. Your job is to move them toward booking a discovery call.

${assetLibrary}

CONTEXTUAL ASSET ROUTING — follow this strictly:
- ${emailStep === 1 || !emailStep ? 'They replied to the first email (or step unknown): if they seem curious or want more info, include the voice recording links so they can hear AIRO in action before the call.' : ''}
- ${emailStep >= 2 ? 'They have already seen the voice recordings email: if curious or wanting more detail, point them to the VSL for a full walkthrough.' : ''}
- If they are expressing intent to book, schedule, speak, or connect: give them the calendar link directly. Make it one click. No friction.
- If they asked a specific product question: answer it briefly, then offer the most relevant next step (VSL or calendar).
- If they are not interested or wrong person: respond graciously with one sentence, leave the door open, close the thread.
- Only include an asset if it is genuinely relevant to their reply. Do not dump all assets into every reply.

REPLY RULES:
- Tone: warm, confident, peer to peer. Like a colleague not a salesperson.
- Short. Maximum 5 sentences.
- No em dashes anywhere.
- No "just following up", "I wanted to reach out", "I hope this finds you well".
- Always sign off as Lubosi.
- Use real URLs from the asset library above — never fabricate or shorten them.

Return ONLY the reply body as plain text. No subject line. No JSON. No preamble.`;
}

export async function draftReply(replyPayload) {
  const { lead_name, company_name, reply_body, email_step } = replyPayload;

  try {
    const assetLibrary = await buildAssetLibraryPrompt();
    const systemPrompt = buildSystemPrompt(assetLibrary, email_step);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: systemPrompt,
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
