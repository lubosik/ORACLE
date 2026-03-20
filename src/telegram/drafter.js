import Anthropic from '@anthropic-ai/sdk';
import { buildAssetLibraryPrompt } from '../utils/assets.js';
import logger from '../utils/logger.js';
import 'dotenv/config';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(assetLibrary, emailStep) {
  const stepNote = emailStep
    ? `Context: this lead is replying to Email ${emailStep} in the sequence.${emailStep === 1 ? ' They have not yet seen the voice recordings.' : emailStep >= 2 ? ' They have already seen the voice recordings in Email 2.' : ''}`
    : '';

  return `You are ORACLE, drafting a reply on behalf of Lubosi at Velto/AIRO. AIRO is an AI voice agent that calls inbound leads within 60 seconds of them enquiring, qualifies them autonomously, and only passes serious buyers to the sales team.

${stepNote}

${assetLibrary}

YOUR JOB:
Read what the lead actually said. Understand their intent. Then write the best possible reply — one that sounds like a sharp, personable founder who knows their product cold, not a salesperson running a script.

If they asked a question, answer it directly and specifically. If they misunderstood something, correct it clearly. If they raised an objection, address it head-on with a brief, confident response. Do not dodge or deflect. Do not be vague.

Then, and only if it genuinely helps move the conversation forward, include one relevant asset from the library:
- Voice recordings: if they are curious about what AIRO actually sounds like in a call and have not heard them yet
- VSL: if they want a full product walkthrough or more context before a call
- Calendar link: if they are expressing clear intent to speak, book, or connect — make it one click

Only use an asset if it is the natural next step. Do not force one in if the reply does not call for it.

If they are not interested or it is the wrong person, respond with one warm, human sentence and close gracefully. Leave the door open.

RULES:
- Maximum 5 sentences. Short is better.
- Peer to peer tone. Confident, warm, direct.
- No em dashes. No "just following up". No "I hope this finds you well". No filler.
- Use real URLs exactly as given in the asset library. Never shorten or fabricate them.
- Always sign off as Lubosi.

Return only the reply body as plain text. No subject line. No labels. No preamble.`;
}

export async function draftReply(replyPayload) {
  const { lead_name, company_name, reply_body, email_step } = replyPayload;

  try {
    const assetLibrary = await buildAssetLibraryPrompt();
    const systemPrompt = buildSystemPrompt(assetLibrary, email_step);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `${lead_name} at ${company_name} replied:

"${reply_body}"

Draft the reply. Sign off as Lubosi.`
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
