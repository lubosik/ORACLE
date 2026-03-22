import { markInboxesUsed } from './inbox_selector.js';
import { logActivity } from '../utils/activity.js';
import { getSchedule } from '../utils/settings.js';
import { supabase } from '../utils/supabase.js';
import { CONFIG } from '../config.js';
import { resolveTimezone } from '../utils/timezones.js';
import 'dotenv/config';

const BASE_URL = process.env.INSTANTLY_BASE_URL || 'https://api.instantly.ai/api/v2';

async function instantlyRequest(path, method = 'GET', body = null) {
  const headers = { 'Authorization': `Bearer ${process.env.INSTANTLY_API_KEY}` };
  if (body !== null) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined
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
      message: 'Campaign approved — creating in Instantly (not yet activated)',
      detail: { draft_id: draft.id, campaign_name: draft.campaign_name }
    });

    // 1. Load schedule from settings
    const schedule = await getSchedule();

    const geoContext = draft.geo_context
      ? (typeof draft.geo_context === 'string' ? JSON.parse(draft.geo_context) : draft.geo_context)
      : null;

    const rawTimezone = geoContext?.timezone || schedule.timezone;
    const campaignTimeFrom = geoContext?.send_hours?.from || schedule.timeFrom;
    const campaignTimeTo   = geoContext?.send_hours?.to   || schedule.timeTo;

    // Resolve timezone to an Instantly-allowed value
    const tzResult = resolveTimezone(rawTimezone);
    if (!tzResult.valid) {
      await logActivity({
        category: 'campaign',
        level: 'warning',
        message: tzResult.message,
        detail: { input: rawTimezone, resolved: tzResult.suggested }
      });
      try {
        const { sendTelegram } = await import('../telegram/bot.js');
        await sendTelegram(`ORACLE TIMEZONE WARNING\n\n${tzResult.message}`);
      } catch (_) {}
    }
    const resolvedTimezone = tzResult.valid ? tzResult.timezone : tzResult.suggested;

    // 2. Create campaign in Instantly (status will be Draft = 0)
    const campaign = await instantlyRequest('/campaigns', 'POST', {
      name: draft.campaign_name,
      email_list: inboxes,
      campaign_schedule: {
        schedules: [{
          name: `ORACLE — ${geoContext?.label || 'Campaign'}`,
          timing: { from: campaignTimeFrom, to: campaignTimeTo },
          days: schedule.daysObj,
          timezone: resolvedTimezone
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

    // 3a. Register merge-tag variables so Instantly knows what {{x}} to substitute per lead
    await instantlyRequest(`/campaigns/${campaign.id}/variables`, 'POST', {
      variables: ['firstName', 'companyName', 'personalization', 'inbound_source']
    });

    // 3. Link campaign_id to experiment_ledger
    await supabase
      .from('experiment_ledger')
      .update({ campaign_id: campaign.id })
      .eq('variant_id', draft.variant_id)
      .eq('outcome', 'pending');

    // 4. Bulk add leads in batches of 1000
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
          website: l.companyWebsite,
          personalization: l.personalisation_hook || '',
          custom_variables: {
            title: l.title || '',
            city: l.city || '',
            state: l.state || '',
            linkedin_url: l.linkedinUrl || '',
            company_linkedin: l.companyLinkedinUrl || '',
            inbound_source: l.inbound_source || ''
          }
        }))
      });
      totalAdded += result.leads_uploaded || 0;
    }

    // 5. Mark inboxes used
    await markInboxesUsed(inboxes);

    // 6. Store Instantly campaign_id on the draft so the Launch handler can activate it
    await supabase
      .from('campaign_drafts')
      .update({
        instantly_campaign_id: campaign.id,
        status: 'staged'
      })
      .eq('id', draft.id);

    await logActivity({
      category: 'campaign',
      level: 'success',
      message: `Campaign staged in Instantly — ${totalAdded} leads loaded, awaiting Launch`,
      campaign_id: campaign.id,
      detail: { campaign_name: draft.campaign_name, inboxes, leads_added: totalAdded, instantly_campaign_id: campaign.id }
    });

    // 7. Send Telegram "review & launch" message with Launch/Cancel buttons
    try {
      const { sendTelegramWithButtons } = await import('../telegram/bot.js');
      const instantlyUrl = `https://app.instantly.ai/app/campaigns/${campaign.id}`;
      const geoLine = geoContext ? `\nGeo: ${geoContext.geo_label} (${resolvedTimezone})` : '';

      await sendTelegramWithButtons(
        `ORACLE — CAMPAIGN STAGED\n\nName: ${draft.campaign_name}\nLeads: ${totalAdded}\nInboxes: ${inboxes.join(', ')}${geoLine}\nSchedule: ${campaignTimeFrom}–${campaignTimeTo} ${resolvedTimezone}\n\nCampaign is created in Instantly but NOT yet sending.\nReview it here: ${instantlyUrl}\n\nWhen you are ready, tap Launch to activate it.`,
        [[
          { text: 'Launch Campaign', callback_data: `launchcampaign_${draft.id}` },
          { text: 'Cancel',         callback_data: `cancelcampaign_${draft.id}` }
        ]]
      );
    } catch (err) {
      // Non-fatal — campaign is staged regardless
      logger.warn('Failed to send staged Telegram message', { error: err.message });
    }

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

/**
 * Activate a staged campaign. Called when user taps "Launch" on Telegram.
 */
export async function activateStagedCampaign(instantlyCampaignId, draft) {
  const BASE = process.env.INSTANTLY_BASE_URL || 'https://api.instantly.ai/api/v2';

  const res = await fetch(`${BASE}/campaigns/${instantlyCampaignId}/activate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.INSTANTLY_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Instantly activate error ${res.status}: ${text}`);
  }

  // Mark leads as campaigned now that the campaign is actually live
  const { markLeadCampaigned } = await import('./deduplicator.js');
  const leads = Array.isArray(draft.leads_snapshot)
    ? draft.leads_snapshot
    : JSON.parse(draft.leads_snapshot);

  for (const lead of leads) {
    await markLeadCampaigned(lead.email, instantlyCampaignId);
  }

  await supabase
    .from('campaign_drafts')
    .update({ status: 'launched' })
    .eq('id', draft.id);

  await logActivity({
    category: 'campaign',
    level: 'success',
    message: `Campaign activated and live — ID: ${instantlyCampaignId}`,
    campaign_id: instantlyCampaignId,
    detail: { campaign_name: draft.campaign_name, leads_marked: leads.length }
  });
}
