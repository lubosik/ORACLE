import { runMetaAdsScraper } from './meta_ads_scraper.js';
import { enrichMetaAdLead } from './meta_ads_enricher.js';
import { generateMetaAdsCopy } from './meta_ads_copywriter.js';
import { createCampaignDraft } from './draft_manager.js';
import { sendCampaignApprovalRequest } from '../telegram/approval.js';
import { selectInboxes } from './inbox_selector.js';
import { getSetting } from '../utils/settings.js';
import { logActivity } from '../utils/activity.js';
import { supabase } from '../utils/supabase.js';

export async function runMetaAdsPipeline(pipelineRunId, options = {}) {
  await logActivity({
    category: 'pipeline',
    level: 'info',
    message: 'Meta Ads pipeline starting',
    pipeline_run_id: pipelineRunId
  });

  // Step 1: Scrape
  const rawLeads = await runMetaAdsScraper(
    pipelineRunId,
    options.keyword || null,
    options.country || null
  );

  if (rawLeads.length === 0) {
    await logActivity({
      category: 'pipeline',
      level: 'info',
      message: 'Meta Ads pipeline complete — no new leads to process',
      pipeline_run_id: pipelineRunId
    });
    return;
  }

  await logActivity({
    category: 'pipeline',
    level: 'info',
    message: `Stage 1 complete: ${rawLeads.length} Meta Ads leads scraped`,
    pipeline_run_id: pipelineRunId
  });

  // Step 2: Enrich each lead with AIRO-specific personalisation hook
  const enrichedLeads = [];
  for (const lead of rawLeads) {
    const enriched = await enrichMetaAdLead(lead, pipelineRunId);
    enrichedLeads.push(enriched);
  }

  await logActivity({
    category: 'pipeline',
    level: 'info',
    message: `Stage 2 complete: ${enrichedLeads.length} leads enriched`,
    pipeline_run_id: pipelineRunId
  });

  // Step 3: Generate copy for each lead
  const leadsWithCopy = [];
  for (const lead of enrichedLeads) {
    try {
      const copy = await generateMetaAdsCopy(lead, pipelineRunId);
      leadsWithCopy.push({ ...lead, copy });
    } catch (err) {
      // Skip this lead, continue
    }
  }

  await logActivity({
    category: 'pipeline',
    level: 'info',
    message: `Stage 3 complete: ${leadsWithCopy.length} leads with copy generated`,
    pipeline_run_id: pipelineRunId
  });

  if (leadsWithCopy.length === 0) {
    await logActivity({
      category: 'pipeline',
      level: 'warning',
      message: 'Meta Ads pipeline: no leads made it through copy generation',
      pipeline_run_id: pipelineRunId
    });
    return;
  }

  // Step 4: Select inboxes
  const selectedInboxes = await selectInboxes();

  // Step 5: Read min/max settings
  const minLeads = parseInt(await getSetting('min_leads_per_campaign', '10'));
  const maxLeads = parseInt(await getSetting('max_leads_per_campaign', '200'));

  // Step 6: Build leads snapshot for draft
  // Use email_1 from the first lead as the sequence template
  const sequence = leadsWithCopy[0].copy;

  const leads = leadsWithCopy.map(l => ({
    email: l.primary_email,
    emailType: 'work',
    firstName: l.company_name.split(' ')[0],
    lastName: '',
    companyName: l.company_name,
    companyWebsite: `https://${l.domain}`,
    linkedinUrl: '',
    city: '',
    state: '',
    country: l.country,
    personalisation_hook: l.personalisation_hook,
    inbound_source: l.inbound_source,
    landing_page: l.landing_page,
    performance_score: l.performance_score,
    copy: l.copy
  }));

  // Step 7: Create draft
  const keyword = rawLeads[0]?.keyword || 'meta_ads';
  const campaignName = `ORACLE_AIRO_META_${keyword.replace(/\s+/g, '_').toUpperCase()}_${new Date().toISOString().slice(0, 10)}`;

  const draft = await createCampaignDraft({
    pipelineRunId,
    campaignName,
    variantId: 'meta_ads_v1',
    leads,
    sequence: {
      emails: [
        { subject: sequence.email_1.subject, body: sequence.email_1.body },
        { subject: sequence.email_2.subject, body: sequence.email_2.body },
        { subject: sequence.email_3.subject, body: sequence.email_3.body },
        { subject: sequence.email_4.subject, body: sequence.email_4.body },
        { subject: sequence.email_5.subject, body: sequence.email_5.body }
      ]
    },
    selectedInboxes,
    minLeads,
    maxLeads
  });

  if (!draft) return;

  // Mark leads as in_draft
  await supabase
    .from('meta_ads_leads')
    .update({ status: 'in_draft' })
    .in('primary_email', leads.map(l => l.email));

  // Step 8: Send Telegram approval request
  await sendCampaignApprovalRequest(null, process.env.TELEGRAM_CHAT_ID, {
    ...draft,
    source_channel: 'META_ADS',
    keyword
  });

  await logActivity({
    category: 'draft',
    level: 'success',
    message: `Meta Ads campaign draft created — ${leads.length} leads, keyword: "${keyword}"`,
    pipeline_run_id: pipelineRunId,
    detail: { campaign_name: campaignName, keyword, leads: leads.length }
  });
}
