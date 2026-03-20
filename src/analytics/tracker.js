import { supabase } from '../utils/supabase.js';
import { setSetting } from '../utils/settings.js';
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

// Collects day-of-week performance data across all campaigns.
// Stores a weighted performance map in system_settings for Karpathy hypothesis generation.
export async function collectTimingInsights() {
  try {
    const { data: stats } = await supabase
      .from('campaign_daily_stats')
      .select('date, emails_sent, replies_unique, auto_replies_unique, open_rate')
      .gt('emails_sent', 0);

    if (!stats?.length) return null;

    // Group by day of week (0=Sun … 6=Sat)
    const byDay = { 0:[], 1:[], 2:[], 3:[], 4:[], 5:[], 6:[] };
    for (const row of stats) {
      const dow = new Date(row.date).getDay();
      const positiveRate = ((row.replies_unique || 0) - (row.auto_replies_unique || 0)) / row.emails_sent;
      byDay[dow].push({ positiveRate, openRate: row.open_rate || 0, sent: row.emails_sent });
    }

    const dayStats = {};
    for (const [dow, rows] of Object.entries(byDay)) {
      if (!rows.length) { dayStats[dow] = null; continue; }
      const totalSent = rows.reduce((s, r) => s + r.sent, 0);
      dayStats[dow] = {
        avg_reply_rate: rows.reduce((s, r) => s + r.positiveRate * r.sent, 0) / totalSent,
        avg_open_rate:  rows.reduce((s, r) => s + r.openRate  * r.sent, 0) / totalSent,
        total_sent: totalSent,
        sample_size: rows.length
      };
    }

    const insights = { by_day: dayStats, computed_at: new Date().toISOString() };
    await setSetting('timing_insights', JSON.stringify(insights));
    logger.info('Timing insights collected', { days_with_data: Object.values(dayStats).filter(Boolean).length });
    return insights;

  } catch (err) {
    logger.error('collectTimingInsights error', { error: err.message });
    return null;
  }
}
