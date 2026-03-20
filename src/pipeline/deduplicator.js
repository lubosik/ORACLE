import { supabase } from '../utils/supabase.js';
import { isSkippedDomain } from '../utils/skip-list.js';
import logger from '../utils/logger.js';

const COOLDOWN_DAYS = 30;

export async function isDuplicate(email) {
  const { data, error } = await supabase
    .from('seen_leads')
    .select('email, last_campaigned_at')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Deduplicator query error', { email, error: error.message });
    return false;
  }

  if (!data) return false;

  if (!data.last_campaigned_at) return false;

  const cooldownMs = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const campaignedAt = new Date(data.last_campaigned_at).getTime();
  const now = Date.now();

  return now - campaignedAt < cooldownMs;
}

export async function filterNewLeads(leads) {
  const results = { passed: [], skipped: 0, skip_listed: 0 };

  for (const lead of leads) {
    if (!lead.email) {
      results.skipped++;
      continue;
    }

    if (isSkippedDomain(lead.companyWebsite, lead.email)) {
      logger.debug('Dedup: skipping client/blocked domain', { email: lead.email, website: lead.companyWebsite });
      results.skip_listed++;
      results.skipped++;
      continue;
    }

    const dup = await isDuplicate(lead.email);
    if (dup) {
      logger.debug('Dedup: skipping lead in cooldown', { email: lead.email });
      results.skipped++;
    } else {
      results.passed.push(lead);
    }
  }

  logger.info('Deduplication complete', {
    passed: results.passed.length,
    skipped: results.skipped,
    skip_listed: results.skip_listed
  });
  return results;
}

export async function upsertSeenLead(lead) {
  const { error } = await supabase
    .from('seen_leads')
    .upsert({
      email: lead.email.toLowerCase().trim(),
      company_name: lead.companyName,
      first_name: lead.firstName,
      last_name: lead.lastName,
      title: lead.title,
      website: lead.companyWebsite,
      linkedin_url: lead.linkedinUrl,
      country: lead.country,
      employee_count: lead.employeeCount || null,
      company_size_bucket: lead.companySizeBucket || null,
      source: 'apify'
    }, { onConflict: 'email' });

  if (error) {
    logger.error('Failed to upsert seen lead', { email: lead.email, error: error.message });
  }
}

export async function markLeadCampaigned(email, campaignId) {
  const { error } = await supabase
    .from('seen_leads')
    .update({
      last_campaigned_at: new Date().toISOString(),
      campaign_id: campaignId
    })
    .eq('email', email.toLowerCase().trim());

  if (error) {
    logger.error('Failed to mark lead campaigned', { email, error: error.message });
  }
}
