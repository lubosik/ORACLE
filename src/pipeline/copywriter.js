import { callAI } from '../utils/ai_client.js';
import logger from '../utils/logger.js';
import { supabase } from '../utils/supabase.js';
import { getEmail2Assets } from '../utils/assets.js';
import { BASE_SEQUENCE } from '../sequences/base_sequence.js';
import 'dotenv/config';

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

const TEMPLATE_SYSTEM_PROMPT = `You are writing cold email sequence TEMPLATES for AIRO — an AI voice agent that calls inbound leads within 60 seconds of them enquiring, qualifies them autonomously, and only passes serious buyers to the sales team.

CRITICAL — you are writing a TEMPLATE, not a personalised email. Use these exact Instantly merge tags wherever appropriate:
- {{firstName}} — recipient's first name (use in greeting and subject)
- {{companyName}} — recipient's company name (use when referencing their business)
- {{personalization}} — a specific, researched observation about their business (use in email 1 opener)
- {{sendingAccountFirstName}} — sender's first name (use as the sign-off on every email)

NON-NEGOTIABLE RULES:
- NO em dashes anywhere in any email
- NO "just following up", "I wanted to reach out", "I hope this finds you well", "quick question"
- NO bullet points in emails 1, 2, or 4
- Subject lines: lowercase, under 5 words, plausible deniability
- Paragraphs: 1 to 2 sentences maximum
- Tone: peer to peer, never vendor to prospect
- CTA is always reply-based: "If yes, I will send over the specifics" or similar soft ask
- Sign off as {{sendingAccountFirstName}} on every email
- Email 2 must include [VOICE RECORDING 1] and [VOICE RECORDING 2] as placeholders — they will be swapped for real URLs

Return ONLY valid JSON, no preamble, no markdown:
{
  "email_1": { "subject": "...", "body": "..." },
  "email_2": { "subject": "...", "body": "..." },
  "email_3": { "subject": "...", "body": "..." },
  "email_4": { "subject": "...", "body": "..." }
}`;

/**
 * Generate ONE sequence template per campaign.
 * For baseline runs: returns BASE_SEQUENCE formatted as a snapshot.
 * For experiment variants: applies hypothesis instructions on top of the baseline.
 * Uses Instantly merge tags throughout — no literal lead data.
 */
export async function generateSequenceTemplate(variantId = 'v1_baseline', hypothesisInstructions = null) {
  // Load voice recordings to embed real URLs in template
  const voiceRecordings = await getEmail2Assets();
  const rec1 = voiceRecordings[0]?.url || 'https://airo.velto.ai/audio/wire-transfer.mp3';
  const rec2 = voiceRecordings[1]?.url || 'https://airo.velto.ai/audio/not-ai.mp3';

  // Baseline: return BASE_SEQUENCE directly (no AI call needed)
  if (!hypothesisInstructions) {
    const seq = BASE_SEQUENCE.emails;
    return {
      email_1: { subject: seq[0].subject, body: seq[0].body },
      email_2: { subject: seq[1].subject, body: seq[1].body.replace('[VOICE RECORDING 1]', rec1).replace('[VOICE RECORDING 2]', rec2) },
      email_3: { subject: seq[2].subject, body: seq[2].body },
      email_4: { subject: seq[3].subject, body: seq[3].body }
    };
  }

  // Experiment variant: ask AI to modify the baseline per hypothesis instructions
  const seq = BASE_SEQUENCE.emails;
  const baselineBlock = seq.map((e, i) => `EMAIL ${i + 1}\nSubject: ${e.subject}\nBody:\n${e.body}`).join('\n\n---\n\n');

  try {
    const content = await callAI({
      system: TEMPLATE_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `CURRENT BASELINE SEQUENCE:\n\n${baselineBlock}\n\n---\n\nEXPERIMENT INSTRUCTIONS:\n${hypothesisInstructions}\n\nApply ONLY the changes described above. Keep everything else identical to the baseline. Maintain all merge tags ({{firstName}}, {{companyName}}, {{personalization}}, {{inbound_source}}). Email 2 must include [VOICE RECORDING 1] and [VOICE RECORDING 2] placeholders.\n\nReturn the complete 4-email sequence as JSON.`
      }],
      maxTokens: 2000
    });

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in template response');

    const parsed = JSON.parse(jsonMatch[0]);

    const template = {
      email_1: { subject: sanitiseCopy(parsed.email_1.subject), body: sanitiseCopy(parsed.email_1.body) },
      email_2: {
        subject: sanitiseCopy(parsed.email_2.subject),
        body: sanitiseCopy(parsed.email_2.body)
          .replace('[VOICE RECORDING 1]', rec1)
          .replace('[VOICE RECORDING 2]', rec2)
      },
      email_3: { subject: sanitiseCopy(parsed.email_3.subject), body: sanitiseCopy(parsed.email_3.body) },
      email_4: { subject: sanitiseCopy(parsed.email_4.subject), body: sanitiseCopy(parsed.email_4.body) }
    };

    logger.info('Sequence template generated for variant', { variantId, hypothesisInstructions: hypothesisInstructions.slice(0, 80) });
    return template;

  } catch (err) {
    logger.error('Template generation failed, falling back to BASE_SEQUENCE', { variantId, error: err.message });
    // Fall back to baseline so the campaign still launches
    return {
      email_1: { subject: seq[0].subject, body: seq[0].body },
      email_2: { subject: seq[1].subject, body: seq[1].body.replace('[VOICE RECORDING 1]', rec1).replace('[VOICE RECORDING 2]', rec2) },
      email_3: { subject: seq[2].subject, body: seq[2].body },
      email_4: { subject: seq[3].subject, body: seq[3].body }
    };
  }
}

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
    const content = await callAI({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 2000
    });
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
  const CONCURRENCY = 5;

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

  const results = [];
  let count = 0;

  // Process in parallel chunks of CONCURRENCY
  for (let i = 0; i < leads.length; i += CONCURRENCY) {
    const chunk = leads.slice(i, i + CONCURRENCY);

    const chunkResults = await Promise.all(chunk.map(async lead => {
      try {
        const copy = await generateCopy(lead, variantId);

        // Replace placeholders in Email 2 with real URLs
        if (rec1) copy.email_2_body = copy.email_2_body.replace('[VOICE RECORDING 1]', rec1);
        if (rec2) copy.email_2_body = copy.email_2_body.replace('[VOICE RECORDING 2]', rec2);
        if (rec1 || rec2) {
          await supabase.from('lead_copy')
            .update({ email_2_body: copy.email_2_body })
            .eq('email', lead.email);
        }

        return { ...lead, copy };
      } catch (err) {
        logger.error('Skipping lead due to copy error', { email: lead.email, error: err.message });
        return null;
      }
    }));

    const passed = chunkResults.filter(r => r !== null);
    results.push(...passed);
    count += passed.length;

    logger.info(`Copy generation progress: ${count}/${leads.length}`, { chunk_start: i, chunk_size: chunk.length });

    // Brief pause between chunks to avoid rate limits
    if (i + CONCURRENCY < leads.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  logger.info('Copy generation batch complete', { generated: count, total: leads.length });
  return results;
}
