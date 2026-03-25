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

/**
 * Normalise email body formatting for Instantly plain text delivery.
 * Ensures paragraph breaks are \n\n throughout.
 * Strips em dashes. Trims trailing whitespace per line.
 */
function normaliseEmailBody(body) {
  if (!body) return '';

  return body
    .replace(/\u2014/g, ',')
    .replace(/\u2013/g, '-')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/([^\n])\n([^\n])/g, '$1\n\n$2')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim();
}

/**
 * Validate that all spintax blocks in the email body are correctly formatted.
 * Returns an array of error messages. Empty array means valid.
 */
function validateSpintax(body) {
  const errors = [];
  const blocks = body.match(/\{\{[^}]+\}\}/g) || [];

  for (const block of blocks) {
    if (!block.includes('|')) continue;

    if (!block.startsWith('{{RANDOM |') && !block.startsWith('{{RANDOM|')) {
      errors.push(`Spintax block missing RANDOM keyword: ${block.slice(0, 60)}`);
      continue;
    }

    const parts = block.slice(2, -2).split('|').map(p => p.trim());
    if (parts.length < 3) {
      errors.push(`Spintax block has fewer than 2 options: ${block.slice(0, 60)}`);
    }

    for (const part of parts.slice(1)) {
      if (!part || part.length === 0) {
        errors.push(`Spintax block has an empty option: ${block.slice(0, 60)}`);
      }
    }
  }

  return errors;
}

const SYSTEM_PROMPT = `You are an expert cold email copywriter writing outbound emails for AIRO, built by Velto.

WHAT AIRO DOES (explain this simply, as if the reader has never heard of it):
AIRO is a system that calls every inbound lead within 60 seconds of them enquiring.
It has a conversation with them, figures out if they are serious, and only passes
the ones worth talking to across to the sales team. The team never speaks to a time-waster.
It can run on cold leads first — people in the pipeline that were never going to be
contacted anyway. No risk to the live pipeline while the prospect decides if it works.

THE VOICE AND PERSONA:
Write as Lubosi, founder. Not as a salesperson. Not as a vendor.
Write the way a founder who genuinely believes in his product talks to a peer.
Conversational. Direct. Confident without being pushy. Never desperate.
The tone is: I have built something real, I think it could work for you, here is the proof.

THE $15M OUTBOUND FRAMEWORK — APPLY TO EVERY EMAIL:
1. PERSONALISATION FIRST: One sentence based on real data about this company.
   Short and informal. Must make the reader think you actually looked at them.
   Must flow directly into the pitch without a gear shift.
   Never: "I came across your profile", "I hope this finds you well", "I wanted to reach out."
2. WHO YOU ARE: Defined by results, never job title.
   Never say "I work at X" or "we are a company that does Y."
3. OFFER: Specific. Connected to a pain they already know they have.
   Lead with the outcome, not the mechanism.
4. CTA: One step from yes. Reply-based. Soft ask. Never a calendar link in first message.

THE CAYMAN CASE STUDY (use naturally, do not recite robotically):
- Client: land development firm in the Cayman Islands
- 30,000 leads in their pipeline they were never going to contact
- Over 3,000 people picked up when AIRO called
- 576 became qualified buyers
- Average deal size up to $2.5 million

OTHER SOCIAL PROOF (use one at a time, never stack):
- Idris Elba's creative operation
- Data Monsters, an elite NVIDIA partner
- 391% boost in conversion when following up within 60 seconds vs 5 minutes
- 30,000 real inbound calls processed across clients
- Voice recordings: https://airo.velto.ai/audio/wire-transfer.mp3 and https://airo.velto.ai/audio/not-ai.mp3
- VSL and booking page: https://airo.velto.ai/

NON-NEGOTIABLE COPY RULES:
- ZERO em dashes anywhere. Not one. Replace with comma or full stop.
- ZERO filler phrases: no "just following up", "I wanted to reach out", "I hope this finds you well", "touching base", "circling back"
- ZERO bullet points in emails 1, 2, 4, or 5
- Subject lines: lowercase, under 5 words, plausible deniability
- Never say AI, artificial intelligence, automation, or robot in any subject line
- Paragraphs: 1 to 2 sentences maximum
- Sign off: {{sendingAccountFirstName}} on its own line

WHAT PERSONALISATION SHOULD LOOK LIKE:
Good: "Noticed you are placing a lot of inbound volume through your portal listings. The teams generating that kind of enquiry rate are usually the ones who feel it most when leads go cold."
Bad: "I noticed you work in real estate and are passionate about connecting buyers with properties."
Good: "Saw you just opened a new office in Manchester. That kind of expansion usually means inbound volume is climbing."
Bad: "I came across your company and thought you might be interested."

The personalisation must flow into the Cayman result or the system description without
the reader noticing a gear change. It is an observation that makes the next sentence inevitable.

PARAGRAPH FORMATTING:
Write every email body as plain text. Maximum two sentences per paragraph.
Each paragraph ends with a full stop and is followed by a blank line before the next paragraph.
No HTML. No br tags. No backslash-n characters in the output.
Just write the paragraphs out with a visible blank line between them.

SPINTAX INSTRUCTIONS:

You must add spintax to the email bodies you generate. Spintax improves deliverability
by making every email slightly different even when the same template is sent at scale.

THE CORRECT INSTANTLY SPINTAX FORMAT IS:
{{RANDOM | option1 | option2 | option3}}

Rules you must follow:
- RANDOM is always the first word, followed by a space then a pipe then a space
- Every option is separated by a space, pipe character, and a space: " | "
- The whole block is wrapped in double curly braces: {{ and }}
- Every combination of options must be grammatically correct and read naturally
- Never spin the Cayman case study numbers (30,000 / 3,000 / 576 / $2.5 million)
- Never spin the voice recording URLs or the VSL URL
- Never spin the {{firstName}} or {{companyName}} variables themselves
- Never nest spintax inside spintax
- Use 2 to 4 options per spintax block
- Add spintax to transition phrases, observation openers, system descriptions, and CTAs
- Do NOT add spintax to the personalisation hook — that is unique per lead

WHAT GOOD SPINTAX LOOKS LIKE IN CONTEXT:

Good transition:
{{RANDOM | Sent you a quick note a few days ago | Reached out recently}} about the Cayman project.

Good observation opener:
I had a look at {{companyName}} and {{RANDOM | it looks like you are actively running inbound | from what I can see you are generating solid inbound volume | it looks like you have an active inbound pipeline}}.

Good CTA:
{{RANDOM | If any of this could be of use to {{companyName}}, I will send over the specifics. | Worth exploring for {{companyName}}? Just reply and I will walk you through it. | If this sounds relevant, just reply and I will send everything over.}}

Bad spintax (do not do this — spins the case study numbers):
{{RANDOM | 576 | 580 | around 600}} qualified buyers

Bad spintax (do not do this — nested):
{{RANDOM | {{RANDOM | Hi | Hello}} {{firstName}} | Hey {{firstName}}}}

Return ONLY valid JSON, no preamble, no markdown, no explanation:
{
  "email_1": { "subject": "...", "body": "..." },
  "email_2": { "subject": "...", "body": "..." },
  "email_3": { "subject": "...", "body": "..." },
  "email_4": { "subject": "...", "body": "..." },
  "email_5": { "subject": "...", "body": "..." }
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
- NO bullet points in emails 1, 2, 4, or 5
- Subject lines: lowercase, under 5 words, plausible deniability
- Paragraphs: 1 to 2 sentences maximum, blank line between each paragraph
- Tone: peer to peer, never vendor to prospect
- CTA is always reply-based: "If yes, I will send over the specifics" or similar soft ask
- Sign off as {{sendingAccountFirstName}} on every email
- Email 2 must include [VOICE RECORDING 1] and [VOICE RECORDING 2] as placeholders — they will be swapped for real URLs
- Email 5 is the day-44 re-engagement. Honest and direct. Not desperate.

SPINTAX: Add {{RANDOM | option1 | option2}} blocks to transition phrases, observation openers,
system descriptions, and CTAs. Never spin Cayman numbers, URLs, or merge tag variables.
Never nest spintax. Every option must be grammatically correct. 2 to 4 options per block.

Return ONLY valid JSON, no preamble, no markdown:
{
  "email_1": { "subject": "...", "body": "..." },
  "email_2": { "subject": "...", "body": "..." },
  "email_3": { "subject": "...", "body": "..." },
  "email_4": { "subject": "...", "body": "..." },
  "email_5": { "subject": "...", "body": "..." }
}`;

/**
 * Generate ONE sequence template per campaign.
 * For baseline runs: returns BASE_SEQUENCE formatted as a snapshot.
 * For experiment variants: applies hypothesis instructions on top of the baseline.
 * Uses Instantly merge tags throughout — no literal lead data.
 */
export async function generateSequenceTemplate(variantId = 'v5_cayman_outcome', hypothesisInstructions = null) {
  // Load voice recordings to embed real URLs in template
  const voiceRecordings = await getEmail2Assets();
  const rec1 = voiceRecordings[0]?.url || 'https://airo.velto.ai/audio/wire-transfer.mp3';
  const rec2 = voiceRecordings[1]?.url || 'https://airo.velto.ai/audio/not-ai.mp3';

  // Baseline: return BASE_SEQUENCE directly (no AI call needed)
  if (!hypothesisInstructions) {
    const seq = BASE_SEQUENCE.emails;
    return {
      email_1: { subject: seq[0].subject, body: normaliseEmailBody(seq[0].body) },
      email_2: { subject: seq[1].subject, body: normaliseEmailBody(seq[1].body) },
      email_3: { subject: seq[2].subject, body: normaliseEmailBody(seq[2].body) },
      email_4: { subject: seq[3].subject, body: normaliseEmailBody(seq[3].body) },
      email_5: { subject: seq[4].subject, body: normaliseEmailBody(seq[4].body) }
    };
  }

  // Experiment variant: ask AI to modify the baseline per hypothesis instructions
  const seq = BASE_SEQUENCE.emails;
  const baselineBlock = seq.map((e, i) => `EMAIL ${i + 1}\nSubject: ${e.subject}\nBody:\n${e.body}`).join('\n\n---\n\n');

  try {
    const content = await callAI({
      systemPrompt: TEMPLATE_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `CURRENT BASELINE SEQUENCE:\n\n${baselineBlock}\n\n---\n\nEXPERIMENT INSTRUCTIONS:\n${hypothesisInstructions}\n\nApply ONLY the changes described above. Keep everything else identical to the baseline. Maintain all merge tags ({{firstName}}, {{companyName}}, {{personalization}}). Email 2 must include [VOICE RECORDING 1] and [VOICE RECORDING 2] placeholders.\n\nReturn the complete 5-email sequence as JSON.`
      }],
      maxTokens: 8000,
      module: 'copywriter_template'
    });

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in template response');

    const parsed = JSON.parse(jsonMatch[0]);

    const template = {
      email_1: { subject: sanitiseCopy(parsed.email_1.subject), body: normaliseEmailBody(parsed.email_1.body) },
      email_2: {
        subject: sanitiseCopy(parsed.email_2.subject),
        body: normaliseEmailBody(parsed.email_2.body)
          .replace('[VOICE RECORDING 1]', rec1)
          .replace('[VOICE RECORDING 2]', rec2)
      },
      email_3: { subject: sanitiseCopy(parsed.email_3.subject), body: normaliseEmailBody(parsed.email_3.body) },
      email_4: { subject: sanitiseCopy(parsed.email_4.subject), body: normaliseEmailBody(parsed.email_4.body) },
      email_5: { subject: sanitiseCopy(parsed.email_5.subject), body: normaliseEmailBody(parsed.email_5.body) }
    };

    logger.info('Sequence template generated for variant', { variantId, hypothesisInstructions: hypothesisInstructions.slice(0, 80) });
    return template;

  } catch (err) {
    logger.error('Template generation failed, falling back to BASE_SEQUENCE', { variantId, error: err.message });
    return {
      email_1: { subject: seq[0].subject, body: normaliseEmailBody(seq[0].body) },
      email_2: { subject: seq[1].subject, body: normaliseEmailBody(seq[1].body) },
      email_3: { subject: seq[2].subject, body: normaliseEmailBody(seq[2].body) },
      email_4: { subject: seq[3].subject, body: normaliseEmailBody(seq[3].body) },
      email_5: { subject: seq[4].subject, body: normaliseEmailBody(seq[4].body) }
    };
  }
}

export async function generateCopy(lead, variantId = 'v5_cayman_outcome') {
  const { firstName, companyName, title, enrichment } = lead;
  const inbound_source = enrichment?.inbound_source || 'their inbound pipeline';
  const personalisation_hook = enrichment?.personalisation_hook || `Came across ${companyName} and had to reach out.`;

  const userPrompt = `Generate a personalised 5-email sequence for:
- First name: ${firstName}
- Company: ${companyName}
- Title: ${title}
- Inbound source: ${inbound_source}
- Personalisation hook: ${personalisation_hook}

Email 1 rules: subject = first name only. Body max 120 words. No link. Cold pipeline risk reversal must appear. Soft CTA: "If any of this could be of use, I will send over the specifics."
Email 2 rules: subject = "had to send these over" or variant. Include [VOICE RECORDING 1] and [VOICE RECORDING 2] placeholders on their own lines. Both recordings must appear.
Email 3 rules: subject references the 391% stat or speed-to-lead. Include VSL link https://airo.velto.ai/ — this is the primary conversion asset.
Email 4 rules: subject = closing signal. Under 70 words. Dead simple CTA. Reference the cold pipeline pool.
Email 5 rules: delay 30 days from email 4. Honest re-engagement. Not desperate. Reference the recordings again. Include VSL link.

CRITICAL: No em dashes anywhere. No "just following up" anywhere. No bullet points in emails 1, 2, 4, or 5.`;

  try {
    const content = await callAI({
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 8000,
      module: 'copywriter_lead'
    });
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in AI response');

    const parsed = JSON.parse(jsonMatch[0]);

    const emails = {
      email_1_subject: sanitiseCopy(parsed.email_1.subject),
      email_1_body: normaliseEmailBody(parsed.email_1.body),
      email_2_subject: sanitiseCopy(parsed.email_2.subject),
      email_2_body: normaliseEmailBody(parsed.email_2.body),
      email_3_subject: sanitiseCopy(parsed.email_3.subject),
      email_3_body: normaliseEmailBody(parsed.email_3.body),
      email_4_subject: sanitiseCopy(parsed.email_4.subject),
      email_4_body: normaliseEmailBody(parsed.email_4.body),
      email_5_subject: sanitiseCopy(parsed.email_5.subject),
      email_5_body: normaliseEmailBody(parsed.email_5.body)
    };

    const allText = Object.values(emails).join(' ');
    if (hasEmDash(allText)) {
      logger.warn('Em dash detected after sanitisation', { email: lead.email });
    }

    // Validate spintax on all bodies — warn but do not block
    for (const [key, val] of Object.entries(emails)) {
      if (!key.endsWith('_body')) continue;
      const spintaxErrors = validateSpintax(val);
      if (spintaxErrors.length > 0) {
        logger.warn('Spintax validation warnings', { email: lead.email, field: key, errors: spintaxErrors });
      }
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

export async function generateCopyBatch(leads, variantId = 'v5_cayman_outcome') {
  const CONCURRENCY = 5;

  // Load voice recordings once for the whole batch
  const voiceRecordings = await getEmail2Assets();
  const rec1 = voiceRecordings[0]?.url || 'https://airo.velto.ai/audio/wire-transfer.mp3';
  const rec2 = voiceRecordings[1]?.url || 'https://airo.velto.ai/audio/not-ai.mp3';

  if (rec1 || rec2) {
    logger.info('Voice recordings loaded for Email 2', { rec1, rec2 });
  }

  const results = [];
  let count = 0;

  for (let i = 0; i < leads.length; i += CONCURRENCY) {
    const chunk = leads.slice(i, i + CONCURRENCY);

    const chunkResults = await Promise.all(chunk.map(async lead => {
      try {
        const copy = await generateCopy(lead, variantId);

        // Replace placeholders in Email 2 with real URLs
        copy.email_2_body = copy.email_2_body
          .replace('[VOICE RECORDING 1]', rec1)
          .replace('[VOICE RECORDING 2]', rec2);

        await supabase.from('lead_copy')
          .update({ email_2_body: copy.email_2_body })
          .eq('email', lead.email);

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

    if (i + CONCURRENCY < leads.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  logger.info('Copy generation batch complete', { generated: count, total: leads.length });
  return results;
}
