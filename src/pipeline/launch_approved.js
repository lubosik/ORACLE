import { markInboxesUsed } from './inbox_selector.js';
import { markLeadCampaigned } from './deduplicator.js';
import { logActivity } from '../utils/activity.js';
import { getSchedule } from '../utils/settings.js';
import { supabase } from '../utils/supabase.js';
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
    const err = new Error(`Instantly API error ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

export async function launchApprovedCampaign(draft) {
  try {
    const seq = draft.sequence_snapshot;
    const inboxes = Array.isArray(draft.selected_inboxes)
      ? draft.selected_inboxes
      : JSON.parse(draft.selected_inboxes);

    await logActivity({
      category: 'campaign',
      level: 'info',
      message: 'Campaign approved — pushing to Instantly',
      detail: { draft_id: draft.id, campaign_name: draft.campaign_name }
    });

    // 1. Load schedule from settings (Supabase-backed, adjustable from dashboard)
    const schedule = await getSchedule();

    // Use geo-specific timezone if available — overrides the global setting
    const geoContext = draft.geo_context
      ? (typeof draft.geo_context === 'string' ? JSON.parse(draft.geo_context) : draft.geo_context)
      : null;

    const campaignTimezone = geoContext?.timezone || schedule.timezone;
    const campaignTimeFrom = geoContext?.send_hours?.from || schedule.timeFrom;
    const campaignTimeTo   = geoContext?.send_hours?.to   || schedule.timeTo;

    // 2. Create campaign in Instantly
    const campaign = await instantlyRequest('/campaigns', 'POST', {
      name: draft.campaign_name,
      email_list: inboxes,
      campaign_schedule: {
        schedules: [{
          name: `ORACLE — ${geoContext?.label || 'Campaign'}`,
          timing: { from: campaignTimeFrom, to: campaignTimeTo },
          days: schedule.daysObj,
          timezone: campaignTimezone
        }]
      },
      sequences: [{
        steps: [
          { type: 'email', delay: 0, variants: [{ subject: seq.email_1.subject, body: seq.email_1.body }] },
          { type: 'email', delay: 3, variants: [{ subject: seq.email_2.subject, body: seq.email_2.body }] },
          { type: 'email', delay: 4, variants: [{ subject: seq.email_3.subject, body: seq.email_3.body }] },
          { type: 'email', delay: 6, variants: [{ subject: seq.email_4.subject, body: seq.email_4.body }] }
        ]
      }],
      ...CONFIG.campaign_settings,
      daily_limit: schedule.dailyLimit,
      auto_variant_select: { trigger: 'reply_rate' }
    });

    if (!campaign.id) throw new Error(`Instantly campaign creation failed: ${JSON.stringify(campaign)}`);

    // Link the Instantly campaign_id back to the experiment_ledger row for this variant
    // so scoring and early-abort can find the campaign's stats
    await supabase
      .from('experiment_ledger')
      .update({ campaign_id: campaign.id })
      .eq('variant_id', draft.variant_id)
      .eq('outcome', 'pending');

    // 2. Bulk add leads in batches of 1000
    const leads = Array.isArray(draft.leads_snapshot)
      ? draft.leads_snapshot
      : JSON.parse(draft.leads_snapshot);

    let totalAdded = 0;
    for (let i = 0; i < leads.length; i += 1000) {
      const batch = leads.slice(i, i + 1000);
      const result = await instantlyRequest('/leads/add', 'POST', {
        campaign_id: campaign.id,
        skip_if_in_workspace: true,
        leads: batch.map(l => ({
          email: l.email,
          first_name: l.firstName,
          last_name: l.lastName,
          company_name: l.companyName,
          personalization: l.personalisation_hook || ''
        }))
      });
      totalAdded += result.leads_uploaded || 0;
    }

    // 3. Activate campaign
    await instantlyRequest(`/campaigns/${campaign.id}/activate`, 'POST');

    // 4. Mark inboxes used
    await markInboxesUsed(inboxes);

    // 5. Update seen_leads with campaign_id and last_campaigned_at
    for (const lead of leads) {
      await markLeadCampaigned(lead.email, campaign.id);
    }

    await logActivity({
      category: 'campaign',
      level: 'success',
      message: `Campaign live in Instantly — ID: ${campaign.id}`,
      campaign_id: campaign.id,
      detail: { campaign_name: draft.campaign_name, inboxes, leads_added: totalAdded }
    });

    // 6. Send confirmation to Telegram
    try {
      const { sendTelegram } = await import('../telegram/bot.js');
      const geoLine = geoContext ? `\nGeo: ${geoContext.geo_label} (${geoContext.timezone})` : '';
      await sendTelegram(`ORACLE — CAMPAIGN LIVE\n\nName: ${draft.campaign_name}\nLeads: ${totalAdded}\nInboxes: ${inboxes.join(', ')}${geoLine}\nSchedule: ${campaignTimeFrom}–${campaignTimeTo} ${campaignTimezone}\nInstantly ID: ${campaign.id}\n\nYou can pause or manage this campaign from the ORACLE dashboard.`);
    } catch (_) {}

    return { campaign, totalAdded };

  } catch (err) {
    await logActivity({
      category: 'campaign',
      level: 'error',
      message: `Campaign launch failed: ${err.message}`,
      detail: { draft_id: draft.id, error: err.message }
    });
    throw err;
  }
}
