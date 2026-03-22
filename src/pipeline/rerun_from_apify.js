import { mapApifyLead } from './scraper.js';
import { runPipelineFromLeads } from './index.js';
import { logActivity } from '../utils/activity.js';
import logger from '../utils/logger.js';
import 'dotenv/config';

/**
 * Fetch items from any Apify dataset by ID using the REST API directly.
 * Paginates in chunks of 1000 until all items are retrieved.
 */
async function fetchDatasetItems(datasetId) {
  const items = [];
  const limit = 1000;
  let offset = 0;

  while (true) {
    const url = `https://api.apify.com/v2/datasets/${datasetId}/items?format=json&clean=1&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}` }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Apify dataset fetch failed (${res.status}): ${text}`);
    }

    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;

    items.push(...batch);

    // If we got fewer than the limit, we've reached the end
    if (batch.length < limit) break;
    offset += limit;
  }

  return items;
}

/**
 * Re-run the pipeline from a specific Apify dataset ID (no new scrape triggered).
 * Pass a datasetId to use a specific dataset, or omit to use the most recent run.
 */
export async function rerunFromDataset(datasetId, variantId = 'v1_baseline') {
  logger.info('Fetching Apify dataset', { dataset_id: datasetId });

  const items = await fetchDatasetItems(datasetId);

  const mappedLeads = items
    .map(mapApifyLead)
    .filter(lead => lead !== null);

  const skipped = items.length - mappedLeads.length;

  await logActivity({
    category: 'scraping',
    level: 'info',
    message: `Re-run from Apify dataset ${datasetId} — ${mappedLeads.length} leads loaded (no new scrape triggered)`,
    detail: {
      dataset_id: datasetId,
      total_items: items.length,
      mapped: mappedLeads.length,
      skipped_no_email: skipped
    }
  });

  await runPipelineFromLeads(mappedLeads, variantId);
}

/**
 * Re-run from the most recent successful Apify run (auto-detects dataset ID).
 */
export async function rerunFromLastDataset(variantId = 'v1_baseline') {
  const res = await fetch(
    `https://api.apify.com/v2/acts/${process.env.APIFY_ACTOR_ID}/runs?limit=5&desc=1`,
    { headers: { 'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}` } }
  );

  if (!res.ok) throw new Error(`Failed to list Apify runs: ${res.status}`);
  const data = await res.json();
  const runs = data.data?.items || [];

  const lastRun = runs.find(r => r.status === 'SUCCEEDED') || runs[0];
  if (!lastRun) throw new Error('No previous Apify runs found');

  logger.info('Auto-detected last Apify dataset', { run_id: lastRun.id, dataset_id: lastRun.defaultDatasetId });

  await rerunFromDataset(lastRun.defaultDatasetId, variantId);
}
