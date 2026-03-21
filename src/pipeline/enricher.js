import logger from '../utils/logger.js';
import { supabase } from '../utils/supabase.js';
import 'dotenv/config';

// Uses xAI Responses API with web_search tool (chat/completions Live Search is deprecated)
const GROK_RESPONSES_URL = 'https://api.x.ai/v1/responses';

function buildFallback(lead) {
  return {
    inbound_source: 'their inbound pipeline',
    funnel_summary: `${lead.companyName} generates leads and routes them to their sales team.`,
    personalisation_hook: `Came across ${lead.companyName} and had to reach out.`
  };
}

export async function enrichLead(lead) {
  try {
    const response = await fetch(GROK_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-3',
        input: [{
          role: 'user',
          content: `Research this company and return ONLY valid JSON, no preamble, no markdown:

Company: ${lead.companyName}
Website: ${lead.companyWebsite}
Contact: ${lead.firstName} ${lead.lastName}, ${lead.title}

Return exactly:
{
  "inbound_source": "how they generate inbound sales enquiries in one phrase",
  "funnel_summary": "one sentence on how their sales funnel works",
  "personalisation_hook": "one sentence for the start of a cold email. Must feel like a real person noticed something specific. Never mention AI. Never sound like a pitch. Under 20 words. Always true."
}`
        }],
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

    const enrichment = {
      inbound_source: parsed.inbound_source || buildFallback(lead).inbound_source,
      funnel_summary: parsed.funnel_summary || buildFallback(lead).funnel_summary,
      personalisation_hook: parsed.personalisation_hook || buildFallback(lead).personalisation_hook
    };

    const { error } = await supabase
      .from('lead_enrichment')
      .upsert({
        email: lead.email,
        ...enrichment,
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
