import Anthropic from '@anthropic-ai/sdk';
import logger from '../utils/logger.js';
import { supabase } from '../utils/supabase.js';
import { getEmail2Assets, buildAssetLibraryPrompt } from '../utils/assets.js';
import 'dotenv/config';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "missing-key" });

const EM_DASH = '\u2014';
const EN_DASH = '\u2013';

function sanitiseCopy(text) {
  return text
    .replace(new RegExp(EM_DASH, 'g'), ',')
    .replace(new RegExp(EN_DASH, 'g'), '-');
}

function hasEmDash(text) {
  return text.includes(EM_DASH) || text.includes(EN_DASH);
}

const SYSTEM_PROMPT = `You are the world's best cold email copywriter. You write outbound emails for AIRO, an AI voice agent built by Velto that calls inbound leads within 60 seconds of them enquiring, qualifies them on the call, and only passes serious buyers to the sales team.

THE $15M OUTBOUND FRAMEWORK:
1. PERSONALISATION FIRST: Open with something that makes the reader think you actually looked at their business. One sentence. Short and informal. Must feel real. Never AI-generated.
2. WHO YOU ARE: Defined by results and social proof, never job title. Never say "I work at X, we do Y."
3. OFFER: Specific, believable, connected to a pain point they already have.
4. CTA: One step from yes to booked. Reply-based. Soft ask.

NON-NEGOTIABLE COPY RULES:
- NO em dashes anywhere in any email (not a single one)
- NO "just following up", "I wanted to reach out", "I hope this finds you well", "quick question"
- NO bullet points in emails 1, 2, or 4
- Subject lines: lowercase, under 5 words, plausible deniability (do not give away what is inside)
- Paragraphs: 1 to 2 sentences maximum
- Tone: peer to peer, never vendor to prospect
- Never mention AI or artificial intelligence in subject line or first sentence
- CTA is always reply-based: "If yes, I will send over the specifics" or similar soft ask

AIRO SOCIAL PROOF ASSETS (use naturally, one at a time, never stack):
- AIRO has processed over 30,000 real inbound calls across clients
- One client did the equivalent of 2.5 years of manual follow-up work in 14 months with one agent
- Reaching out within 60 seconds of an enquiry boosts conversion by 391% vs following up after 5 minutes
- Clients include: a land development firm in the Cayman Islands, Idris Elba's creative operation, and Data Monsters (elite NVIDIA partner)
- Speed to lead is the single variable most sales teams are not optimising for
- Symptoms of a speed-to-lead problem: leads going cold in the database, low conversion despite high volume, sales team chasing no-shows, morale declining

ASSETS ORACLE CAN REFERENCE:
- VSL: https://airo.velto.ai/
- Calendly: https://calendly.com/veltoai/airo-discovery-call
- Voice recordings: use [VOICE RECORDING 1] and [VOICE RECORDING 2] as placeholders in Email 2 — they will be replaced with real URLs automatically

Return ONLY valid JSON, no preamble, no markdown, no explanation:
{
  "email_1": { "subject": "...", "body": "..." },
  "email_2": { "subject": "...", "body": "..." },
  "email_3": { "subject": "...", "body": "..." },
  "email_4": { "subject": "...", "body": "..." }
}`;

export async function generateCopy(lead, variantId = 'v1_baseline') {
  const { firstName, companyName, title, enrichment } = lead;
  const inbound_source = enrichment?.inbound_source || 'their inbound pipeline';
  const personalisation_hook = enrichment?.personalisation_hook || `Came across ${companyName} and had to reach out.`;

  const userPrompt = `Generate a personalised 4-email sequence for:
- First name: ${firstName}
- Company: ${companyName}
- Title: ${title}
- Inbound source: ${inbound_source}
- Personalisation hook: ${personalisation_hook}

Email 1 rules: subject = first name only. Body max 90 words. No link. Soft CTA: "If yes, I will send over the specifics."
Email 2 rules: subject = "had to send this over" or variant. Include [VOICE RECORDING 1] and [VOICE RECORDING 2] placeholders. Reference the inbound source naturally.
Email 3 rules: subject references the 30,000 calls stat or speed-to-lead. Education-led. Use the 391% stat. List pain point symptoms without bullet points.
Email 4 rules: subject = closing signal. Under 60 words. Dead simple CTA: "Just a yes or no is fine."

CRITICAL: No em dashes anywhere. No "just following up" anywhere.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        { role: 'user', content: userPrompt }
      ],
      system: SYSTEM_PROMPT
    });

    const content = message.content[0].text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Claude response');

    const parsed = JSON.parse(jsonMatch[0]);

    const emails = {
      email_1_subject: sanitiseCopy(parsed.email_1.subject),
      email_1_body: sanitiseCopy(parsed.email_1.body),
      email_2_subject: sanitiseCopy(parsed.email_2.subject),
      email_2_body: sanitiseCopy(parsed.email_2.body),
      email_3_subject: sanitiseCopy(parsed.email_3.subject),
      email_3_body: sanitiseCopy(parsed.email_3.body),
      email_4_subject: sanitiseCopy(parsed.email_4.subject),
      email_4_body: sanitiseCopy(parsed.email_4.body)
    };

    const allText = Object.values(emails).join(' ');
    if (hasEmDash(allText)) {
      logger.warn('Em dash detected after sanitisation', { email: lead.email });
    }

    await supabase.from('lead_copy').upsert({
      email: lead.email,
      ...emails,
      variant_id: variantId,
      generated_at: new Date().toISOString()
    }, { onConflict: 'email' });

    return emails;

  } catch (err) {
    logger.error('Copy generation failed', { email: lead.email, error: err.message });
    throw err;
  }
}

export async function generateCopyBatch(leads, variantId = 'v1_baseline') {
  const results = [];
  let count = 0;

  // Load voice recordings once for the whole batch
  const voiceRecordings = await getEmail2Assets();
  const rec1 = voiceRecordings[0]?.url || null;
  const rec2 = voiceRecordings[1]?.url || null;

  if (rec1 || rec2) {
    logger.info('Voice recordings loaded for Email 2', {
      rec1: rec1 || 'none',
      rec2: rec2 || 'none'
    });
  }

  for (const lead of leads) {
    try {
      const copy = await generateCopy(lead, variantId);

      // Replace placeholders in Email 2 with real URLs
      if (rec1) copy.email_2_body = copy.email_2_body.replace('[VOICE RECORDING 1]', rec1);
      if (rec2) copy.email_2_body = copy.email_2_body.replace('[VOICE RECORDING 2]', rec2);
      // Also update Supabase with resolved URLs
      if (rec1 || rec2) {
        await supabase.from('lead_copy')
          .update({ email_2_body: copy.email_2_body })
          .eq('email', lead.email);
      }

      results.push({ ...lead, copy });
      count++;
    } catch (err) {
      logger.error('Skipping lead due to copy error', { email: lead.email, error: err.message });
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  logger.info('Copy generation batch complete', { generated: count, total: leads.length });
  return results;
}
