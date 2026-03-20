import { ApifyClient } from 'apify-client';
import { CONFIG } from '../config.js';
import logger from '../utils/logger.js';
import 'dotenv/config';

const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

export async function scrapeLeads(vertical = 'real_estate') {
  const verticalConfig = CONFIG.verticals[vertical];
  if (!verticalConfig) throw new Error(`Unknown vertical: ${vertical}`);

  const input = {
    ...verticalConfig.apify_input,
    totalResults: CONFIG.daily_lead_limit
  };

  logger.info('Apify scrape starting', {
    actor: process.env.APIFY_ACTOR_ID,
    vertical,
    limit: CONFIG.daily_lead_limit
  });

  const run = await client.actor(process.env.APIFY_ACTOR_ID).call(input);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  const allLeads = items.map(item => ({
    firstName: item.firstName || item.first_name || '',
    lastName: item.lastName || item.last_name || '',
    email: (item.email || '').toLowerCase().trim(),
    companyName: item.companyName || item.company_name || item.organization || '',
    companyWebsite: item.companyWebsite || item.company_website || item.website || '',
    linkedinUrl: item.linkedinUrl || item.linkedin_url || item.linkedin || '',
    title: item.title || item.jobTitle || item.job_title || '',
    city: item.city || '',
    country: item.country || ''
  }));

  const noEmailCount = allLeads.filter(l => !l.email).length;
  const withEmail = allLeads.filter(l => l.email && l.email.trim() !== '');

  logger.info('Apify scrape complete', {
    total_items: items.length,
    with_email: withEmail.length,
    no_email_skipped: noEmailCount
  });

  return { leads: withEmail, noEmailSkipped: noEmailCount };
}
