import { supabase } from '../utils/supabase.js';
import { logActivity } from '../utils/activity.js';

export async function createCampaignDraft({
  pipelineRunId,
  campaignName,
  variantId,
  leads,
  sequence,
  selectedInboxes,
  minLeads,
  maxLeads,
  geoContext = null
}) {
  if (leads.length < minLeads) {
    await logActivity({
      category: 'draft',
      level: 'warning',
      message: `Lead count ${leads.length} is below minimum ${minLeads} — draft not created. Adjust min_leads_per_campaign or scrape more leads.`,
      pipeline_run_id: pipelineRunId
    });
    return null;
  }

  const cappedLeads = leads.slice(0, maxLeads);

  const leadsSnapshot = cappedLeads.map(l => ({
    email: l.email,
    firstName: l.firstName,
    lastName: l.lastName,
    companyName: l.companyName,
    title: l.title,
    personalisation_hook: l.enrichment?.personalisation_hook,
    inbound_source: l.enrichment?.inbound_source
  }));

  // Build sequence snapshot from leads' copy (each lead has personalised copy)
  // Use the first lead's copy as the sequence template for the draft preview
  const firstCopy = cappedLeads[0]?.copy;
  const sequenceSnapshot = {
    email_1: { subject: firstCopy?.email_1_subject || sequence?.emails?.[0]?.subject || '', body: firstCopy?.email_1_body || sequence?.emails?.[0]?.body || '' },
    email_2: { subject: firstCopy?.email_2_subject || sequence?.emails?.[1]?.subject || '', body: firstCopy?.email_2_body || sequence?.emails?.[1]?.body || '' },
    email_3: { subject: firstCopy?.email_3_subject || sequence?.emails?.[2]?.subject || '', body: firstCopy?.email_3_body || sequence?.emails?.[2]?.body || '' },
    email_4: { subject: firstCopy?.email_4_subject || sequence?.emails?.[3]?.subject || '', body: firstCopy?.email_4_body || sequence?.emails?.[3]?.body || '' }
  };

  const { data: draft, error } = await supabase
    .from('campaign_drafts')
    .insert({
      pipeline_run_id: pipelineRunId,
      campaign_name: campaignName,
      variant_id: variantId,
      lead_count: cappedLeads.length,
      leads_snapshot: leadsSnapshot,
      sequence_snapshot: sequenceSnapshot,
      selected_inboxes: selectedInboxes,
      min_leads: minLeads,
      max_leads: maxLeads,
      geo_context: geoContext || null,
      status: 'pending'
    })
    .select()
    .single();

  if (error) throw error;

  await logActivity({
    category: 'draft',
    level: 'info',
    message: `Campaign draft created — ${cappedLeads.length} leads, awaiting Telegram approval`,
    pipeline_run_id: pipelineRunId,
    detail: { draft_id: draft.id, campaign_name: campaignName }
  });

  return draft;
}
