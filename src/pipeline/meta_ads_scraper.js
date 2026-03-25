import { ApifyClient } from 'apify-client';
import { supabase } from '../utils/supabase.js';
import { logActivity } from '../utils/activity.js';
import { sendTelegram } from '../telegram/bot.js';

const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

/**
 * Select the next keyword to run based on least recently used.
 * Returns null if no active keywords are available.
 */
async function selectNextKeyword() {
  const { data, error } = await supabase
    .from('meta_ads_keywords')
    .select('*')
    .eq('is_active', true)
    .order('last_run_at', { ascending: true, nullsFirst: true })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Run the Meta Ads Lead Scraper Apify actor for a given keyword.
 * Returns the array of raw lead objects from the actor dataset.
 */
async function runMetaAdsActor({ keyword, country, maxResults, keywordRecord }) {
  await logActivity({
    category: 'scraping',
    level: 'info',
    message: `Meta Ads scraper starting — keyword: "${keyword}", country: ${country}, max: ${maxResults}`
  });

  let run;
  try {
    run = await client.actor(process.env.META_ADS_ACTOR_ID).call({
      keyword,
      max_results: maxResults,
      country
    });
  } catch (err) {
    await logActivity({
      category: 'error',
      level: 'error',
      message: `Meta Ads actor call failed: ${err.message}`,
      detail: { keyword, country, error: err.message }
    });
    throw err;
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  await logActivity({
    category: 'scraping',
    level: 'success',
    message: `Meta Ads scraper complete — ${items.length} leads returned for "${keyword}"`,
    detail: { run_id: run.id, keyword, country, count: items.length }
  });

  // Update keyword last_run_at and increment total_leads_returned
  const currentTotal = keywordRecord?.total_leads_returned || 0;
  await supabase
    .from('meta_ads_keywords')
    .update({
      last_run_at: new Date().toISOString(),
      total_leads_returned: currentTotal + items.length
    })
    .eq('keyword', keyword)
    .eq('country', country);

  return { items, runId: run.id };
}

/**
 * Deduplicate leads against existing seen_leads and meta_ads_leads tables.
 * Returns only leads with emails not seen in the last 30 days.
 */
async function deduplicateMetaLeads(items, keyword, country) {
  const results = { kept: [], skipped: [] };

  for (const item of items) {
    const email = item.primary_email?.trim()?.toLowerCase();

    // Skip if no verified email
    if (!email) {
      results.skipped.push({ item, reason: 'no_email' });
      continue;
    }

    // Check seen_leads 30-day cooldown
    const { data: seenLead } = await supabase
      .from('seen_leads')
      .select('last_campaigned_at')
      .eq('email', email)
      .single();

    if (seenLead?.last_campaigned_at) {
      const daysSince = (Date.now() - new Date(seenLead.last_campaigned_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 30) {
        results.skipped.push({ item, reason: '30_day_cooldown' });
        continue;
      }
    }

    // Check meta_ads_leads for recent duplicate
    const { data: existingMetaLead } = await supabase
      .from('meta_ads_leads')
      .select('id, status, created_at')
      .eq('primary_email', email)
      .not('status', 'eq', 'skipped')
      .single();

    if (existingMetaLead) {
      const daysSince = (Date.now() - new Date(existingMetaLead.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 30) {
        results.skipped.push({ item, reason: 'meta_ads_duplicate' });
        continue;
      }
    }

    results.kept.push(item);
  }

  await logActivity({
    category: 'pipeline',
    level: 'info',
    message: `Meta Ads deduplication — ${results.kept.length} kept, ${results.skipped.length} skipped`,
    detail: {
      keyword,
      kept: results.kept.length,
      skipped_no_email: results.skipped.filter(s => s.reason === 'no_email').length,
      skipped_cooldown: results.skipped.filter(s => s.reason === '30_day_cooldown').length,
      skipped_duplicate: results.skipped.filter(s => s.reason === 'meta_ads_duplicate').length
    }
  });

  return results.kept;
}

/**
 * Store deduplicated leads in meta_ads_leads table.
 */
async function storeMetaLeads(items, keyword, country, runId, pipelineRunId) {
  const rows = items.map(item => ({
    apify_run_id: runId,
    keyword,
    country,
    company_name: item.company_name || '',
    domain: item.domain || '',
    landing_page: item.landing_page || '',
    primary_email: item.primary_email?.trim()?.toLowerCase() || '',
    secondary_email: item.secondary_email?.trim()?.toLowerCase() || null,
    all_emails: item.all_emails || [],
    phone: item.phone || null,
    performance_score: item.performance_score || null,
    speed_category: item.speed_category || null,
    actor_hook: item.hook || null,
    status: 'deduplicated',
    pipeline_run_id: pipelineRunId
  }));

  const { error } = await supabase.from('meta_ads_leads').insert(rows);
  if (error) throw new Error(`Failed to store Meta Ads leads: ${error.message}`);

  return rows;
}

/**
 * Main entry point — run a full Meta Ads sourcing cycle.
 * Selects the next keyword, runs the actor, deduplicates, stores.
 * Returns the stored leads ready for enrichment and copy generation.
 */
export async function runMetaAdsScraper(pipelineRunId, overrideKeyword = null, overrideCountry = null) {
  if (process.env.META_ADS_ENABLED !== 'true') {
    await logActivity({ category: 'system', level: 'info', message: 'Meta Ads sourcing disabled — skipping' });
    return [];
  }

  // Select keyword
  let keywordRecord;
  if (overrideKeyword) {
    keywordRecord = { keyword: overrideKeyword, country: overrideCountry || process.env.META_ADS_DEFAULT_COUNTRY, total_leads_returned: 0 };
  } else {
    keywordRecord = await selectNextKeyword();
    if (!keywordRecord) {
      await logActivity({ category: 'scraping', level: 'warning', message: 'No active Meta Ads keywords found' });
      return [];
    }
  }

  const maxResults = parseInt(process.env.META_ADS_DEFAULT_MAX_RESULTS) || 50;

  try {
    // Run actor
    const { items, runId } = await runMetaAdsActor({
      keyword: keywordRecord.keyword,
      country: keywordRecord.country,
      maxResults,
      keywordRecord
    });

    if (!items || items.length === 0) {
      await logActivity({
        category: 'scraping',
        level: 'warning',
        message: `Meta Ads actor returned 0 leads for "${keywordRecord.keyword}"`
      });
      return [];
    }

    // Deduplicate
    const deduped = await deduplicateMetaLeads(items, keywordRecord.keyword, keywordRecord.country);

    if (deduped.length === 0) {
      await logActivity({
        category: 'scraping',
        level: 'info',
        message: `All Meta Ads leads for "${keywordRecord.keyword}" were duplicates — nothing new to process`
      });
      return [];
    }

    // Store
    const stored = await storeMetaLeads(deduped, keywordRecord.keyword, keywordRecord.country, runId, pipelineRunId);

    await logActivity({
      category: 'scraping',
      level: 'success',
      message: `Meta Ads pipeline ready — ${stored.length} new leads stored from "${keywordRecord.keyword}"`,
      pipeline_run_id: pipelineRunId,
      detail: { keyword: keywordRecord.keyword, country: keywordRecord.country, count: stored.length }
    });

    return stored;

  } catch (err) {
    await logActivity({
      category: 'error',
      level: 'error',
      message: `Meta Ads scraper failed: ${err.message}`,
      pipeline_run_id: pipelineRunId
    });
    await sendTelegram(`ORACLE ERROR\n\nModule: meta_ads_scraper\nError: ${err.message}\nKeyword: ${keywordRecord.keyword}`);
    return [];
  }
}
