import { callAI } from '../utils/ai_client.js';
import { supabase } from '../utils/supabase.js';
import { logActivity } from '../utils/activity.js';

const META_ADS_COPY_SYSTEM_PROMPT = `
You are an expert cold email copywriter writing outbound emails for AIRO, built by Velto.

WHAT AIRO DOES:
AIRO is a system that calls every inbound lead within 60 seconds of them enquiring.
It qualifies them on that call and only passes serious buyers to the sales team.
The team never speaks to a time-waster.
It can also run on cold leads first — the people in the pipeline who were never going
to be contacted anyway. No risk to the live pipeline while the prospect decides if it works.

CRITICAL CONTEXT ABOUT THIS LEAD:
Every lead you write for has been found through their ACTIVE Facebook or Instagram ads.
This means:
1. They are definitely generating inbound right now from those ads
2. They are spending money on lead acquisition, so every unconverted lead costs them
3. You know what their ad is about — use this in the personalisation

THE $15M OUTBOUND FRAMEWORK:
1. PERSONALISATION FIRST: Use the Facebook ad context you have been given.
   Reference their ads or landing page specifically. One sentence.
   Must feel like something a person noticed while actually looking at their business.
2. WHO YOU ARE: Results and case study. Never job title.
3. OFFER: Cold pipeline first, no risk. Specific to their inbound situation.
4. CTA: One step from yes. Reply-based.

NON-NEGOTIABLE COPY RULES:
- ZERO em dashes anywhere
- ZERO filler phrases (just following up, I wanted to reach out, etc.)
- Paragraphs: maximum 2 sentences
- Subject lines: lowercase, under 5 words, plausible deniability
- Never mention Facebook, Meta, or ads in the subject line
- Blank line between every paragraph — write with paragraph breaks not as a block
- Sign off: {{sendingAccountFirstName}}

SPINTAX FORMAT (add to key phrases):
{{RANDOM | option1 | option2 | option3}}
Add spintax on: transition phrases, system descriptions, CTAs
Never spin: case study numbers, URLs, the personalisation hook

THE CAYMAN CASE STUDY (core social proof):
30,000 leads in pipeline they had written off.
Over 3,000 picked up when AIRO called.
576 became qualified buyers.
Average deal size up to $2.5 million.

OTHER SOCIAL PROOF:
- Idris Elba's creative operation
- Data Monsters, elite NVIDIA partner
- Voice recordings: https://airo.velto.ai/audio/wire-transfer.mp3
  and https://airo.velto.ai/audio/not-ai.mp3
- VSL: https://airo.velto.ai/

Return ONLY valid JSON, no preamble, no markdown:
{
  "email_1": { "subject": "...", "body": "..." },
  "email_2": { "subject": "...", "body": "..." },
  "email_3": { "subject": "...", "body": "..." },
  "email_4": { "subject": "...", "body": "..." },
  "email_5": { "subject": "...", "body": "..." }
}
`;

export async function generateMetaAdsCopy(lead, pipelineRunId) {
  const userPrompt = `
Generate a 5-email sequence for this lead found via their active Facebook ads:

Company: ${lead.company_name}
Email: ${lead.primary_email}
Domain: ${lead.domain}
Landing page from ad: ${lead.landing_page}
Personalisation hook: ${lead.personalisation_hook}
Inbound source context: ${lead.inbound_source}
Website speed: ${lead.performance_score}/100 (${lead.speed_category})

Email 1: Subject = first name only OR a reference to their ads (no spoilers).
Body max 120 words. No link. Open with the personalisation hook.
Then the Cayman case study in plain language. CTA: reply to get specifics.

Email 2: Subject = "had to send these over".
Voice recordings + Idris Elba + Data Monsters social proof.
Reference that their ads are bringing in leads right now and this is exactly
the gap AIRO closes for active advertisers.

Email 3: Subject = "the 391% stat".
The 5-minute response window research. VSL link: https://airo.velto.ai/
Keep under 80 words.

Email 4: Subject = "one thing before I go".
Cold pipeline reframe — leads that went cold are still in the database.
Cayman numbers as final anchor. Under 70 words.

Email 5: Subject = "genuinely think this fits". Send day 44.
Acknowledge you keep coming back. Reference their ads are still running (good sign).
Voice recordings again. VSL link.

CRITICAL: Every email body must have a blank line between each paragraph.
No HTML. No br tags. Write as plain text with paragraph breaks.
No em dashes anywhere.
`;

  try {
    const result = await callAI({
      systemPrompt: META_ADS_COPY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 3000,
      temperature: 0.7,
      module: 'meta_ads_copywriter',
      expectJSON: true
    });

    // Post-process: strip em dashes, normalise whitespace
    for (const key of Object.keys(result)) {
      if (result[key].body) {
        result[key].body = result[key].body
          .replace(/\u2014/g, ',')
          .replace(/\r\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .replace(/([^\n])\n([^\n])/g, '$1\n\n$2')
          .trim();
      }
    }

    await supabase
      .from('meta_ads_leads')
      .update({ status: 'copy_generated' })
      .eq('id', lead.id);

    await logActivity({
      category: 'copy',
      level: 'success',
      message: `Meta Ads copy generated for ${lead.company_name} (${lead.primary_email})`,
      lead_email: lead.primary_email,
      pipeline_run_id: pipelineRunId
    });

    return result;

  } catch (err) {
    await logActivity({
      category: 'error',
      level: 'error',
      message: `Meta Ads copy generation failed for ${lead.primary_email}: ${err.message}`,
      lead_email: lead.primary_email,
      pipeline_run_id: pipelineRunId
    });
    throw err;
  }
}
