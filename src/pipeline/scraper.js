import { ApifyClient } from 'apify-client';
import { CONFIG } from '../config.js';
import { logActivity } from '../utils/activity.js';
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

  await logActivity({
    category: 'scraping',
    level: 'info',
    message: `Apify scrape started — target: ${CONFIG.daily_lead_limit} leads`,
    detail: { actor: process.env.APIFY_ACTOR_ID, vertical }
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

export async function sendLeadCSVToTelegram(leads, bot, chatId, pipelineRunId) {
  if (!leads || leads.length === 0) return;

  const headers = ['firstName', 'lastName', 'email', 'companyName', 'title', 'country'];
  const rows = leads.map(l =>
    headers.map(h => `"${(l[h] || '').replace(/"/g, '""')}"`).join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');

  const tmpPath = `/tmp/oracle_leads_${Date.now()}.csv`;
  const fs = await import('fs/promises');
  await fs.writeFile(tmpPath, csv, 'utf8');

  try {
    await bot.sendDocument(chatId, tmpPath, {
      caption: `ORACLE — ${leads.length} leads scraped and deduplicated.\n\nReview the list above. Enrichment and copy generation will begin automatically. The pipeline will send an approval request before anything goes to Instantly.`,
      parse_mode: 'HTML'
    });
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }

  await logActivity({
    category: 'scraping',
    level: 'success',
    message: `Lead CSV sent to Telegram — ${leads.length} leads`,
    pipeline_run_id: pipelineRunId
  });
}
