import logger from '../utils/logger.js';
import { supabase } from '../utils/supabase.js';
import { markLeadCampaigned } from './deduplicator.js';
import { CONFIG } from '../config.js';
import 'dotenv/config';

const BASE_URL = process.env.INSTANTLY_BASE_URL || 'https://api.instantly.ai/api/v2';

async function instantlyRequest(path, method = 'GET', body = null) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${process.env.INSTANTLY_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Instantly API error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function createCampaign(variantId, leads) {
  const dateStr = new Date().toISOString().split('T')[0];
  const campaignName = `ORACLE_AIRO_RE_${variantId}_${dateStr}`;

  const firstLead = leads[0];
  const copy = firstLead.copy;

  const campaign = await instantlyRequest('/campaigns', 'POST', {
    name: campaignName,
    campaign_schedule: {
      schedules: [CONFIG.campaign_schedule]
    },
    sequences: [{
      steps: [
        { type: 'email', delay: 0, variants: [{ subject: copy.email_1_subject, body: copy.email_1_body }] },
        { type: 'email', delay: 3, variants: [{ subject: copy.email_2_subject, body: copy.email_2_body }] },
        { type: 'email', delay: 4, variants: [{ subject: copy.email_3_subject, body: copy.email_3_body }] },
        { type: 'email', delay: 6, variants: [{ subject: copy.email_4_subject, body: copy.email_4_body }] }
      ]
    }],
    ...CONFIG.campaign_settings,
    auto_variant_select: { trigger: 'reply_rate' }
  });

  logger.info('Campaign created', { campaign_id: campaign.id, name: campaignName });
  return campaign;
}

export async function bulkAddLeads(campaignId, leads) {
  const BATCH_SIZE = 1000;
  let totalAdded = 0;
  let totalDuped = 0;
  let totalSkipped = 0;
  let totalInvalid = 0;

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);
    const payload = batch.map(lead => ({
      email: lead.email,
      first_name: lead.firstName,
      last_name: lead.lastName,
      company_name: lead.companyName,
      website: lead.companyWebsite,
      personalization: lead.enrichment?.personalisation_hook || ''
    }));

    try {
      const result = await instantlyRequest('/leads/add', 'POST', {
        campaign_id: campaignId,
        skip_if_in_workspace: true,
        leads: payload
      });

      totalAdded += result.leads_uploaded || 0;
      totalDuped += result.duplicated_leads || 0;
      totalSkipped += result.skipped_count || 0;
      totalInvalid += result.invalid_email_count || 0;

      logger.info('Batch added to campaign', {
        batch: Math.floor(i / BATCH_SIZE) + 1,
        uploaded: result.leads_uploaded,
        duped: result.duplicated_leads
      });

    } catch (err) {
      logger.error('Batch add failed', { batch: Math.floor(i / BATCH_SIZE) + 1, error: err.message });
    }
  }

  return { totalAdded, totalDuped, totalSkipped, totalInvalid };
}

export async function activateCampaign(campaignId) {
  await instantlyRequest(`/campaigns/${campaignId}/activate`, 'POST');
  logger.info('Campaign activated', { campaign_id: campaignId });
}

function getPublicBaseUrl() {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  return `http://localhost:${process.env.PORT || 3000}`;
}

async function listWebhooks() {
  try {
    return await instantlyRequest('/webhook/listwebhook', 'GET');
  } catch {
    return [];
  }
}

async function ensureWebhook(name, eventType, path) {
  const base = getPublicBaseUrl();
  const targetUrl = `${base}${path}`;

  // Check if a webhook for this event already exists to avoid duplicates
  const existing = await listWebhooks();
  const alreadyExists = Array.isArray(existing)
    ? existing.find(w => w.event_type === eventType || w.target_hook_url === targetUrl)
    : null;

  if (alreadyExists) {
    logger.info(`Webhook already registered (${eventType})`, { id: alreadyExists.id, url: targetUrl });
    return alreadyExists;
  }

  try {
    const result = await instantlyRequest('/webhooks', 'POST', {
      name,
      target_hook_url: targetUrl,
      event_type: eventType
    });
    logger.info(`Webhook registered: ${eventType}`, { url: targetUrl, id: result.id });
    return result;
  } catch (err) {
    logger.warn(`Webhook registration failed for ${eventType}`, { error: err.message });
    return null;
  }
}

export async function registerWebhooks() {
  await ensureWebhook('ORACLE Reply Handler',  'reply_received',  '/webhook/reply');
  await ensureWebhook('ORACLE Bounce Handler', 'email_bounced',   '/webhook/bounce');
  await ensureWebhook('ORACLE Unsub Handler',  'lead_unsubscribed', '/webhook/unsubscribe');
}

export async function launchCampaign(leads, variantId = 'v1_baseline') {
  if (!leads.length) {
    logger.warn('No leads to launch campaign with');
    return null;
  }

  const campaign = await createCampaign(variantId, leads);
  const addResult = await bulkAddLeads(campaign.id, leads);
  await activateCampaign(campaign.id);

  for (const lead of leads) {
    await markLeadCampaigned(lead.email, campaign.id);
    await supabase
      .from('lead_copy')
      .update({ campaign_id: campaign.id })
      .eq('email', lead.email);
  }

  logger.info('Campaign launch complete', {
    campaign_id: campaign.id,
    leads_added: addResult.totalAdded,
    duped: addResult.totalDuped
  });

  return { campaign, addResult };
}
