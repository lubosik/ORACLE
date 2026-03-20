import { ApifyClient } from 'apify-client';
import { CONFIG } from '../config.js';
import { logActivity } from '../utils/activity.js';
import logger from '../utils/logger.js';
import 'dotenv/config';

function getCompanySizeBucket(count) {
  if (!count || count <= 0) return 'unknown';
  if (count <= 10)   return 'micro';
  if (count <= 50)   return 'small';
  if (count <= 100)  return 'mid';
  if (count <= 500)  return 'growth';
  if (count <= 1000) return 'large';
  return 'enterprise';
}

// Some Apollo outputs use string ranges like "11 - 50"
function parseEmployeeCount(raw) {
  if (!raw) return null;
  if (typeof raw === 'number') return raw;
  const str = String(raw).replace(/,/g, '');
  // Range like "11 - 50" → take midpoint
  const rangeMatch = str.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (rangeMatch) return Math.round((parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2);
  const num = parseInt(str);
  return isNaN(num) ? null : num;
}

const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

// geoTarget: { city?: string, state?: string, country: string } | null
export async function scrapeLeads(vertical = 'real_estate', geoTarget = null) {
  const verticalConfig = CONFIG.verticals[vertical];
  if (!verticalConfig) throw new Error(`Unknown vertical: ${vertical}`);

  // Start with the vertical's base input, then override geo fields
  const input = { ...verticalConfig.apify_input, totalResults: CONFIG.daily_lead_limit };

  if (geoTarget) {
    // Override country to match the targeted market
    input.personCountry = [geoTarget.country];
    // City-level targeting (UK)
    if (geoTarget.city) {
      input.personCity = [geoTarget.city];
      delete input.personState;
    }
    // State-level targeting (US)
    if (geoTarget.state) {
      input.personState = [geoTarget.state];
      delete input.personCity;
    }
  }

  const geoLabel = geoTarget
    ? (geoTarget.city || geoTarget.state || geoTarget.country)
    : 'all markets';

  await logActivity({
    category: 'scraping',
    level: 'info',
    message: `Apify scrape started — target: ${CONFIG.daily_lead_limit} leads (${geoLabel})`,
    detail: { actor: process.env.APIFY_ACTOR_ID, vertical, geo: geoLabel }
  });

  const run = await client.actor(process.env.APIFY_ACTOR_ID).call(input);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  const allLeads = items.map(item => {
    const rawCount = item.numEmployees || item.employee_count || item.employeeCount ||
                     item.companySize || item.company_size || item.employees || null;
    const employeeCount = parseEmployeeCount(rawCount);
    return {
      firstName: item.firstName || item.first_name || '',
      lastName: item.lastName || item.last_name || '',
      email: (item.email || '').toLowerCase().trim(),
      companyName: item.companyName || item.company_name || item.organization || '',
      companyWebsite: item.companyWebsite || item.company_website || item.website || '',
      linkedinUrl: item.linkedinUrl || item.linkedin_url || item.linkedin || '',
      title: item.title || item.jobTitle || item.job_title || '',
      city: item.city || '',
      country: item.country || '',
      employeeCount,
      companySizeBucket: getCompanySizeBucket(employeeCount)
    };
  });

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
