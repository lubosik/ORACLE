import { ApifyClient } from 'apify-client';
import { CONFIG } from '../config.js';
import { logActivity } from '../utils/activity.js';
import logger from '../utils/logger.js';
import 'dotenv/config';

const ALLOWED_PERSON_STATES = [
  'California',
  'New York',
  'Texas',
  'Florida',
  'Ontario'
];

/**
 * Filter a list of states to only those the Apify actor accepts.
 * Logs a warning for any invalid states so they are visible in the activity feed.
 * Returns at least one valid state — defaults to California if nothing valid found.
 */
async function resolvePersonStates(requestedStates, pipelineRunId) {
  if (!requestedStates || requestedStates.length === 0) {
    return ['California'];
  }

  const valid = [];
  const invalid = [];

  for (const state of requestedStates) {
    if (ALLOWED_PERSON_STATES.includes(state)) {
      valid.push(state);
    } else {
      const corrected = ALLOWED_PERSON_STATES.find(
        s => s.toLowerCase() === state.toLowerCase()
      );
      if (corrected) {
        valid.push(corrected);
        await logActivity({
          category: 'scraping',
          level: 'warning',
          message: `personState "${state}" corrected to "${corrected}" for Apify actor`,
          pipeline_run_id: pipelineRunId
        });
      } else {
        invalid.push(state);
        await logActivity({
          category: 'scraping',
          level: 'warning',
          message: `personState "${state}" is not valid for this Apify actor and was removed. Allowed values: ${ALLOWED_PERSON_STATES.join(', ')}`,
          pipeline_run_id: pipelineRunId
        });
      }
    }
  }

  if (valid.length === 0) {
    await logActivity({
      category: 'scraping',
      level: 'warning',
      message: `No valid personState values found in [${requestedStates.join(', ')}]. Defaulting to California.`,
      pipeline_run_id: pipelineRunId
    });
    return ['California'];
  }

  return valid;
}

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

/**
 * Maps a raw Apify item (boneswill/leads-generator) to the canonical lead shape.
 * Exported so rerun_from_apify.js can reuse it without duplicating logic.
 */
export function mapApifyLead(item) {
  // Email priority: work email first, personal email fallback, skip if neither
  const workEmail = item.email?.trim();
  const personalEmail = item.personal_email?.trim();
  const email = (workEmail || personalEmail || '').toLowerCase();

  if (!email) return null;

  return {
    // Personal details
    email,
    emailType: workEmail ? 'work' : 'personal',
    firstName: item.firstName?.trim() || '',
    lastName: item.lastName?.trim() || '',
    title: item.title?.trim() || '',
    linkedinUrl: item.linkedinUrl?.trim() || '',
    city: item.city?.trim() || '',
    state: item.state?.trim() || '',
    country: item.country?.trim() || '',

    // Company details — Apify actor uses organization* prefix
    companyName: item.organizationName?.trim() || '',
    companyWebsite: item.organizationWebsite?.trim() || '',
    companyLinkedinUrl: item.organizationLinkedinUrl?.trim() || '',
    companyIndustry: item.organizationIndustry?.trim() || '',
    companySize: item.organizationSize?.trim() || '',
    companyFoundedYear: item.organizationFoundedYear || null,
    companyCity: item.organizationCity?.trim() || '',
    companyState: item.organizationState?.trim() || '',
    companyCountry: item.organizationCountry?.trim() || '',
    companyDescription: item.organizationDescription?.trim() || '',
    companySpecialities: item.organizationSpecialities?.trim() || '',

    // Size bucket for filtering/scoring
    companySizeBucket: getCompanySizeBucket(parseEmployeeCount(item.organizationSize)),

    // Meta
    apifyPersonId: item.personId || '',
    source: 'apify'
  };
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
    // resolvePersonStates filters to only values accepted by this Apify actor.
    // States like Georgia, Colorado, Illinois etc. will be dropped with a warning.
    if (geoTarget.state) {
      input.personState = await resolvePersonStates([geoTarget.state], null);
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

  // Retry up to 3 times on Apify timeout/transient failures
  let run, items;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      run = await client.actor(process.env.APIFY_ACTOR_ID).call(input, { timeout: 300 });
      ({ items } = await client.dataset(run.defaultDatasetId).listItems());
      break; // success
    } catch (err) {
      logger.warn(`Apify scrape attempt ${attempt}/3 failed`, { error: err.message });
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, attempt * 15000)); // 15s, 30s backoff
    }
  }

  const mappedLeads = items.map(mapApifyLead).filter(lead => lead !== null);
  const noEmailCount = items.length - mappedLeads.length;

  await logActivity({
    category: 'scraping',
    level: 'info',
    message: `Apify returned ${items.length} leads — ${mappedLeads.length} have emails, ${noEmailCount} skipped (no email)`,
    detail: { total: items.length, mapped: mappedLeads.length, skipped_no_email: noEmailCount }
  });

  logger.info('Apify scrape complete', {
    total_items: items.length,
    with_email: mappedLeads.length,
    no_email_skipped: noEmailCount
  });

  return { leads: mappedLeads, noEmailSkipped: noEmailCount };
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
