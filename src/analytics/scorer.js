import { supabase } from '../utils/supabase.js';
import logger from '../utils/logger.js';

export async function getTopPerformers(limit = 5) {
  const { data, error } = await supabase
    .from('campaign_daily_stats')
    .select('campaign_id, campaign_name, positive_reply_rate, open_rate, emails_sent')
    .order('positive_reply_rate', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('Failed to fetch top performers', { error: error.message });
    return [];
  }

  return data || [];
}

export async function getOverallStats() {
  const { data, error } = await supabase
    .from('campaign_daily_stats')
    .select('emails_sent, replies_unique, auto_replies_unique, opens_unique');

  if (error) {
    logger.error('Failed to fetch overall stats', { error: error.message });
    return {};
  }

  const totals = (data || []).reduce((acc, row) => {
    acc.emails_sent += row.emails_sent || 0;
    acc.replies += row.replies_unique || 0;
    acc.auto_replies += row.auto_replies_unique || 0;
    acc.opens += row.opens_unique || 0;
    return acc;
  }, { emails_sent: 0, replies: 0, auto_replies: 0, opens: 0 });

  return {
    emails_sent: totals.emails_sent,
    positive_reply_rate: totals.emails_sent > 0
      ? ((totals.replies - totals.auto_replies) / totals.emails_sent * 100).toFixed(2)
      : '0.00',
    open_rate: totals.emails_sent > 0
      ? (totals.opens / totals.emails_sent * 100).toFixed(2)
      : '0.00'
  };
}
