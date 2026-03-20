import { supabase } from '../utils/supabase.js';
import { sendTelegram } from '../telegram/bot.js';
import { logActivity } from '../utils/activity.js';
import logger from '../utils/logger.js';

const DROP_THRESHOLD = 0.25;   // Alert if open rate drops >25% from 7d avg
const SPIKE_THRESHOLD = 0.50;  // Alert if open rate spikes >50% (could be anomaly)
const MIN_SENDS = 20;           // Ignore campaigns with fewer sends

export async function monitorDeliverability() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const { data: recentStats } = await supabase
      .from('campaign_daily_stats')
      .select('campaign_id, campaign_name, date, open_rate, emails_sent')
      .gte('date', twoWeeksAgo)
      .order('date', { ascending: false });

    if (!recentStats?.length) return;

    // Group by campaign
    const byCampaign = {};
    for (const row of recentStats) {
      if (!byCampaign[row.campaign_id]) byCampaign[row.campaign_id] = { name: row.campaign_name, rows: [] };
      byCampaign[row.campaign_id].rows.push(row);
    }

    let alertsTriggered = 0;

    for (const [campaignId, { name, rows }] of Object.entries(byCampaign)) {
      const todayRow = rows.find(r => r.date === today);
      if (!todayRow || (todayRow.emails_sent || 0) < MIN_SENDS) continue;

      const history = rows.filter(r => r.date !== today).slice(0, 7);
      if (history.length < 3) continue;

      const avgOpenRate = history.reduce((s, r) => s + (r.open_rate || 0), 0) / history.length;
      const todayRate = todayRow.open_rate || 0;

      let anomaly = false;
      let anomalyType = null;

      if (avgOpenRate > 0) {
        const changeRatio = (avgOpenRate - todayRate) / avgOpenRate;
        if (changeRatio >= DROP_THRESHOLD) {
          anomaly = true;
          anomalyType = 'drop';
        } else if (todayRate > 0 && ((todayRate - avgOpenRate) / avgOpenRate) >= SPIKE_THRESHOLD) {
          anomaly = true;
          anomalyType = 'spike';
        }
      }

      await supabase.from('deliverability_log').upsert({
        campaign_id: campaignId,
        campaign_name: name,
        date: today,
        open_rate: todayRate,
        seven_day_avg_open_rate: avgOpenRate,
        anomaly_detected: anomaly,
        anomaly_type: anomalyType,
        alert_sent: false
      }, { onConflict: 'campaign_id,date' });

      if (anomaly) {
        // Check if alert already sent today
        const { data: existing } = await supabase
          .from('deliverability_log')
          .select('alert_sent')
          .eq('campaign_id', campaignId)
          .eq('date', today)
          .single();

        if (!existing?.alert_sent) {
          const changeStr = anomalyType === 'drop'
            ? `DROP: ${(todayRate * 100).toFixed(1)}% today vs ${(avgOpenRate * 100).toFixed(1)}% 7-day avg (${(((avgOpenRate - todayRate) / avgOpenRate) * 100).toFixed(0)}% worse)`
            : `SPIKE: ${(todayRate * 100).toFixed(1)}% today vs ${(avgOpenRate * 100).toFixed(1)}% avg`;

          const message = anomalyType === 'drop'
            ? `ORACLE DELIVERABILITY ALERT\n\nCampaign: ${name}\n${changeStr}\n\nPossible inbox placement issue — check Instantly for spam flags or warm inbox health.`
            : `ORACLE DELIVERABILITY NOTICE\n\nCampaign: ${name}\n${changeStr}\n\nUnusually high open rate today — could be a positive sign or tracking anomaly.`;

          await sendTelegram(message);

          await supabase.from('deliverability_log')
            .update({ alert_sent: true })
            .eq('campaign_id', campaignId)
            .eq('date', today);

          await logActivity({
            category: 'deliverability',
            level: anomalyType === 'drop' ? 'warning' : 'info',
            message: `Deliverability ${anomalyType}: ${name} — ${(todayRate * 100).toFixed(1)}% vs ${(avgOpenRate * 100).toFixed(1)}% avg`,
            detail: { campaign_id: campaignId, anomaly_type: anomalyType, today_rate: todayRate, avg_rate: avgOpenRate }
          });

          alertsTriggered++;
        }
      }
    }

    logger.info('Deliverability monitoring complete', {
      campaigns_checked: Object.keys(byCampaign).length,
      alerts_triggered: alertsTriggered
    });

  } catch (err) {
    logger.error('Deliverability monitor error', { error: err.message });
  }
}
