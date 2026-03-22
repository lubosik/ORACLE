import { supabase } from '../utils/supabase.js';
import { logActivity } from '../utils/activity.js';
import { BASE_SEQUENCE } from '../sequences/base_sequence.js';
import { generateSequenceTemplate } from './copywriter.js';

export async function createCampaignDraft({
  pipelineRunId,
  campaignName,
  variantId,
  leads,
  sequence,
  selectedInboxes,
  minLeads,
  maxLeads,
  geoContext = null,
  copyInstructions = null
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
    emailType: l.emailType,
    firstName: l.firstName,
    lastName: l.lastName,
    title: l.title,
    companyName: l.companyName,
    companyWebsite: l.companyWebsite,
    linkedinUrl: l.linkedinUrl,
    city: l.city,
    state: l.state,
    country: l.country,
    personalisation_hook: l.enrichment?.personalisation_hook || '',
    inbound_source: l.enrichment?.inbound_source || ''
  }));

  // Generate the sequence template for this campaign.
  // - Experiment variants: AI applies hypothesis instructions on top of BASE_SEQUENCE (one AI call)
  // - Baseline runs: BASE_SEQUENCE returned directly (no AI call)
  // All templates use Instantly merge tags so every lead gets personalised copy.
  let sequenceSnapshot;
  if (sequence) {
    // Explicit sequence passed in (e.g. from a future custom flow)
    sequenceSnapshot = {
      email_1: { subject: sequence.emails[0].subject, body: sequence.emails[0].body },
      email_2: { subject: sequence.emails[1].subject, body: sequence.emails[1].body },
      email_3: { subject: sequence.emails[2].subject, body: sequence.emails[2].body },
      email_4: { subject: sequence.emails[3].subject, body: sequence.emails[3].body }
    };
  } else {
    sequenceSnapshot = await generateSequenceTemplate(variantId, copyInstructions || null);
  }

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
