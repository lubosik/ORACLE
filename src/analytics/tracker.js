import { supabase } from '../utils/supabase.js';
import logger from '../utils/logger.js';
import 'dotenv/config';

const BASE_URL = process.env.INSTANTLY_BASE_URL || 'https://api.instantly.ai/api/v2';

async function instantlyGet(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Authorization': `Bearer ${process.env.INSTANTLY_API_KEY}` }
  });
  if (!res.ok) throw new Error(`Instantly GET error ${res.status}: ${path}`);
  return res.json();
}

export async function pollAnalytics() {
  try {
    logger.info('Analytics poll starting');

    const campaigns = await instantlyGet('/campaigns?limit=100');
    const campaignList = campaigns.items || campaigns || [];

    for (const campaign of campaignList) {
      try {
        const analytics = await instantlyGet(`/campaigns/analytics?id=${campaign.id}`);

        const emailsSent = analytics.emails_sent_count || 0;
        const repliesUnique = analytics.reply_count_unique || 0;
        const autoReplies = analytics.reply_count_automatic_unique || 0;
        const opensUnique = analytics.open_count_unique || 0;
        const bounced = analytics.bounced_count || 0;

        const positiveReplyRate = emailsSent > 0
          ? (repliesUnique - autoReplies) / emailsSent
          : 0;

        const openRate = emailsSent > 0
          ? opensUnique / emailsSent
          : 0;

        await supabase
          .from('campaign_daily_stats')
          .upsert({
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            date: new Date().toISOString().split('T')[0],
            emails_sent: emailsSent,
            replies_unique: repliesUnique,
            auto_replies_unique: autoReplies,
            opens_unique: opensUnique,
            bounced,
            positive_reply_rate: positiveReplyRate,
            open_rate: openRate,
            fetched_at: new Date().toISOString()
          }, { onConflict: 'campaign_id,date' });

      } catch (err) {
        logger.error('Failed to poll campaign analytics', { campaign_id: campaign.id, error: err.message });
      }
    }

    logger.info('Analytics poll complete', { campaigns_polled: campaignList.length });

  } catch (err) {
    logger.error('Analytics poll error', { error: err.message });
  }
}

export async function getCampaignAnalytics(campaignId) {
  return instantlyGet(`/campaigns/analytics?id=${campaignId}`);
}

export async function getCampaignStepAnalytics(campaignId) {
  return instantlyGet(`/campaigns/analytics/steps?campaign_id=${campaignId}&include_opportunities_count=true`);
}

export async function getOverviewAnalytics() {
  return instantlyGet('/campaigns/analytics/overview');
}
