import { callAI } from '../utils/ai_client.js';
import { supabase } from '../utils/supabase.js';
import { logActivity } from '../utils/activity.js';

/**
 * Enrich a Meta Ads lead with a personalisation hook based on their ad context.
 * The actor already provides company_name, domain, landing_page, and actor_hook.
 * This step generates a AIRO-specific personalisation from that data.
 */
export async function enrichMetaAdLead(lead, pipelineRunId) {
  try {
    const prompt = `
You are writing a personalisation hook for a cold email from AIRO.

AIRO calls every inbound lead within 60 seconds of them enquiring, qualifies them on the call,
and only passes serious buyers to the sales team. It is built for businesses that are actively
running ads and generating inbound but losing leads before anyone calls them back.

ABOUT THIS COMPANY:
Company name: ${lead.company_name}
Website domain: ${lead.domain}
Their Facebook ad landing page: ${lead.landing_page}
Actor-generated hook: ${lead.actor_hook || 'not available'}
Website speed score: ${lead.performance_score || 'unknown'}/100 (${lead.speed_category || 'unknown'})

YOUR TASK:
Write ONE personalisation hook sentence for the opening of a cold email.

This sentence must:
1. Reference something specific about this company that proves you looked at them
2. Naturally lead into the observation that they are generating inbound from their ads
3. Be informal and conversational — like something a real person would notice and type
4. Be one sentence only, maximum 20 words
5. Connect naturally to the next sentence which will say:
   "We just finished a project for a land development firm in the Cayman Islands..."

Good examples of what this should sound like:
- "Saw you are running ads for your new Manchester development — that kind of inbound volume moves fast."
- "Noticed you are actively pushing traffic to your show home page right now."
- "Your ads for the Riverside Quarter development are running across Facebook and Instagram."

Bad examples (do not write these):
- "I came across your website and was impressed by your innovative approach."
- "I noticed you work in real estate."
- "Your Facebook ad caught my eye."

Return ONLY valid JSON, no preamble:
{
  "personalisation_hook": "...",
  "inbound_source": "brief phrase like 'their Facebook ads' or 'their property listings ads'",
  "signal_used": "what specific thing from the input you referenced"
}
`;

    const result = await callAI({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 300,
      temperature: 0.7,
      module: 'meta_ads_enricher',
      expectJSON: true
    });

    // Update the lead record with enrichment
    await supabase
      .from('meta_ads_leads')
      .update({ status: 'enriched' })
      .eq('id', lead.id);

    await logActivity({
      category: 'enrichment',
      level: 'info',
      message: `Meta Ads lead enriched — ${lead.company_name} (${lead.primary_email})`,
      lead_email: lead.primary_email,
      pipeline_run_id: pipelineRunId,
      detail: { hook: result.personalisation_hook, signal: result.signal_used }
    });

    return {
      ...lead,
      personalisation_hook: result.personalisation_hook,
      inbound_source: result.inbound_source,
      enrichment_signal: result.signal_used
    };

  } catch (err) {
    // Fallback hook if AI fails
    await logActivity({
      category: 'enrichment',
      level: 'warning',
      message: `Meta Ads enrichment failed for ${lead.primary_email} — using fallback hook`,
      lead_email: lead.primary_email
    });

    return {
      ...lead,
      personalisation_hook: `Noticed ${lead.company_name} is actively running ads right now.`,
      inbound_source: 'their Facebook ads',
      enrichment_signal: 'fallback'
    };
  }
}
