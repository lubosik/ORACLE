import logger from '../utils/logger.js';
import { supabase } from '../utils/supabase.js';
import { logActivity } from '../utils/activity.js';
import 'dotenv/config';

// Uses xAI Responses API with web_search tool (chat/completions Live Search is deprecated)
const GROK_RESPONSES_URL = 'https://api.x.ai/v1/responses';

function buildFallback(lead) {
  return {
    inbound_source: 'their inbound pipeline',
    funnel_summary: `${lead.companyName} generates leads and routes them to their sales team.`,
    personalisation_hook: `Came across ${lead.companyName} while looking at real estate teams with active inbound and had to reach out.`,
    research_used: 'fallback',
    signal_found: 'none'
  };
}

export async function enrichLead(lead) {
  try {
    const grokPrompt = `
You are a cold email research assistant writing a personalisation hook for an outreach email from AIRO — an AI voice agent that calls inbound sales leads within 60 seconds of enquiry.

The email opener is: "Bit of an unusual one."
Then comes the personalisation hook you write.
Then comes: "We have got a system that called back over 30,000 inbound enquiries within 60 seconds of someone raising their hand."

The hook must flow naturally between the opener and that next line. It should be one sentence — a specific, real observation about this company that signals the sender actually looked at them. It must not sound like an AI wrote it. It must not be generic. It must reference something current or forward-looking (we are in March 2026 — do not reference events more than 6 months old).

COMPANY DATA FROM DATABASE:
Name: ${lead.companyName}
Website: ${lead.companyWebsite}
Industry: ${lead.companyIndustry || 'not available'}
Size: ${lead.companySize || 'not available'}
Founded: ${lead.companyFoundedYear || 'unknown'}
Location: ${lead.companyCity || lead.city || ''}, ${lead.companyState || lead.state || ''}
Description: ${lead.companyDescription || 'not available'}
Specialities: ${lead.companySpecialities || 'not available'}
Contact: ${lead.firstName} ${lead.lastName}, ${lead.title}
LinkedIn: ${lead.linkedinUrl || 'not available'}

YOUR TASK:
1. Use the company data above as your primary source.
2. If the description or specialities give you enough to write a specific, genuine hook — do it without searching the web.
3. If the data is thin (description is blank or generic), use web search to find ONE recent, specific, relevant signal: a new hire, a funding round, a new market they are entering, a product launch, a job posting that reveals growth. Today is March 21, 2026 — only reference things from the last 6 months.
4. If you find nothing specific and the company data is too generic to personalise, return the fallback below. Do not fabricate specifics.

HOOK EXAMPLES (good — these flow into "We have got a system..."):
- "Came across ${lead.companyName} while looking at high-inbound real estate teams — you are clearly doing some interesting things on the development side."
- "Saw that ${lead.companyName} has been expanding into [specific market] — that kind of growth usually means a lot of inbound to manage."
- "Noticed ${lead.companyName} is hiring a Sales Manager right now — that usually means inbound volume is climbing."

HOOK EXAMPLES (bad — do not write these):
- "I was impressed by your innovative approach to real estate." (too generic, no signal)
- "I saw your LinkedIn post from 2023 about..." (too old)
- "As a leader in the real estate industry..." (pure flattery, no observation)

FALLBACK (use this if nothing specific is found):
- "Came across ${lead.companyName} while looking at real estate teams with active inbound and had to reach out."

Return ONLY a valid JSON object, no preamble, no markdown:
{
  "personalisation_hook": "...",
  "inbound_source": "brief phrase like 'their inbound pipeline' or 'Rightmove listings and ads' or 'their website lead forms'",
  "funnel_summary": "one sentence on how their sales funnel works",
  "research_used": "apify_data" or "web_search" or "fallback",
  "signal_found": "brief note on what specific signal was used, or 'none' if fallback"
}
`;

    const response = await fetch(GROK_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-3',
        input: [{ role: 'user', content: grokPrompt }],
        tools: [{ type: 'web_search' }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Grok API error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    // Responses API returns output array; find the message content
    const outputItem = data.output?.find(o => o.type === 'message');
    const content = outputItem?.content?.find(c => c.type === 'output_text')?.text || '';

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      logger.warn('Grok response JSON parse failed, using fallback', { email: lead.email, content: content.slice(0, 200) });
      parsed = buildFallback(lead);
    }

    // Validate hook quality — fall back if too short, generic, or missing company name
    const companyFirstWord = (lead.companyName || '').toLowerCase().split(' ')[0];
    if (
      !parsed.personalisation_hook ||
      parsed.personalisation_hook.length < 20 ||
      parsed.research_used === 'fallback' ||
      (companyFirstWord && !parsed.personalisation_hook.toLowerCase().includes(companyFirstWord))
    ) {
      parsed.personalisation_hook = `Came across ${lead.companyName} while looking at real estate teams with active inbound and had to reach out.`;
      parsed.research_used = 'fallback';
    }

    const enrichment = {
      inbound_source: parsed.inbound_source || buildFallback(lead).inbound_source,
      funnel_summary: parsed.funnel_summary || buildFallback(lead).funnel_summary,
      personalisation_hook: parsed.personalisation_hook,
      research_used: parsed.research_used || 'unknown',
      signal_found: parsed.signal_found || 'none'
    };

    await logActivity({
      category: 'enrichment',
      level: 'info',
      message: `Enriched ${lead.email} — ${enrichment.research_used} — signal: ${enrichment.signal_found}`,
      lead_email: lead.email,
      detail: { hook: enrichment.personalisation_hook, inbound_source: enrichment.inbound_source }
    });

    const { error } = await supabase
      .from('lead_enrichment')
      .upsert({
        email: lead.email,
        inbound_source: enrichment.inbound_source,
        funnel_summary: enrichment.funnel_summary,
        personalisation_hook: enrichment.personalisation_hook,
        enriched_at: new Date().toISOString()
      }, { onConflict: 'email' });

    if (error) logger.error('Failed to save enrichment', { email: lead.email, error: error.message });

    return enrichment;

  } catch (err) {
    logger.error('Enrichment failed, using fallback', { email: lead.email, error: err.message });
    return buildFallback(lead);
  }
}

export async function enrichLeads(leads) {
  const enriched = [];
  for (const lead of leads) {
    const enrichment = await enrichLead(lead);
    enriched.push({ ...lead, enrichment });
    await new Promise(r => setTimeout(r, 500));
  }
  logger.info('Enrichment complete', { count: enriched.length });
  return enriched;
}
