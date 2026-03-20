import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { supabase } from '../utils/supabase.js';
import { draftReply } from '../telegram/drafter.js';
import { sendTelegramWithButtons } from '../telegram/bot.js';
import { getOverviewAnalytics, getCampaignAnalytics, getCampaignStepAnalytics } from '../analytics/tracker.js';
import { getEngineState, setEngineState } from '../utils/engine-state.js';
import { getSkipList, addDomain, removeDomain } from '../utils/skip-list.js';
import logger from '../utils/logger.js';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ORACLE is watching',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Health
app.get('/api/health', async (req, res) => {
  const checks = {};

  // Supabase
  try {
    const { count } = await supabase.from('seen_leads').select('*', { count: 'exact', head: true });
    checks.supabase = { status: 'connected', lead_count: count };
  } catch (e) {
    checks.supabase = { status: 'error', error: e.message };
  }

  // Instantly
  try {
    const r = await fetch(`${process.env.INSTANTLY_BASE_URL}/campaigns?limit=1`, {
      headers: { 'Authorization': `Bearer ${process.env.INSTANTLY_API_KEY}` }
    });
    checks.instantly = { status: r.ok ? 'connected' : 'error', http_status: r.status };
  } catch (e) {
    checks.instantly = { status: 'error', error: e.message };
  }

  // Anthropic
  checks.anthropic = { status: process.env.ANTHROPIC_API_KEY ? 'configured' : 'missing' };

  // xAI Grok
  checks.grok = { status: process.env.XAI_API_KEY ? 'configured' : 'missing' };

  // Apify
  checks.apify = { status: process.env.APIFY_API_TOKEN ? 'configured' : 'missing' };

  // Telegram
  checks.telegram = { status: process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'missing' };

  res.json(checks);
});

// Overview stats
app.get('/api/overview', async (req, res) => {
  try {
    const [leadsResult, statsResult, experimentsResult, baselineResult] = await Promise.all([
      supabase.from('seen_leads').select('*', { count: 'exact', head: true }),
      supabase.from('campaign_daily_stats').select('emails_sent, replies_unique, auto_replies_unique, opens_unique'),
      supabase.from('experiment_ledger').select('*', { count: 'exact', head: true }).eq('outcome', 'pending'),
      supabase.from('baselines').select('*').eq('vertical', 'real_estate').single()
    ]);

    const stats = statsResult.data || [];
    const totalSent = stats.reduce((s, r) => s + (r.emails_sent || 0), 0);
    const totalReplies = stats.reduce((s, r) => s + (r.replies_unique || 0), 0);
    const totalAutoReplies = stats.reduce((s, r) => s + (r.auto_replies_unique || 0), 0);
    const totalOpens = stats.reduce((s, r) => s + (r.opens_unique || 0), 0);

    res.json({
      total_leads: leadsResult.count || 0,
      total_emails_sent: totalSent,
      open_rate: totalSent > 0 ? ((totalOpens / totalSent) * 100).toFixed(2) : '0.00',
      reply_rate: totalSent > 0 ? ((totalReplies / totalSent) * 100).toFixed(2) : '0.00',
      positive_reply_rate: totalSent > 0 ? (((totalReplies - totalAutoReplies) / totalSent) * 100).toFixed(2) : '0.00',
      active_experiments: experimentsResult.count || 0,
      current_baseline: baselineResult.data?.positive_reply_rate
        ? (baselineResult.data.positive_reply_rate * 100).toFixed(2)
        : null
    });
  } catch (err) {
    logger.error('Overview API error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Campaigns
app.get('/api/campaigns', async (req, res) => {
  try {
    const r = await fetch(`${process.env.INSTANTLY_BASE_URL}/campaigns?limit=100`, {
      headers: { 'Authorization': `Bearer ${process.env.INSTANTLY_API_KEY}` }
    });
    const data = await r.json();

    const { data: statsRows } = await supabase
      .from('campaign_daily_stats')
      .select('*')
      .order('date', { ascending: false });

    const statsMap = {};
    for (const row of (statsRows || [])) {
      if (!statsMap[row.campaign_id]) statsMap[row.campaign_id] = row;
    }

    const campaigns = (data.items || data || []).map(c => ({
      ...c,
      stats: statsMap[c.id] || null
    }));

    res.json(campaigns);
  } catch (err) {
    logger.error('Campaigns API error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Single campaign with step analytics
app.get('/api/campaigns/:id', async (req, res) => {
  try {
    const [campaign, analytics, steps] = await Promise.all([
      fetch(`${process.env.INSTANTLY_BASE_URL}/campaigns/${req.params.id}`, {
        headers: { 'Authorization': `Bearer ${process.env.INSTANTLY_API_KEY}` }
      }).then(r => r.json()),
      getCampaignAnalytics(req.params.id),
      getCampaignStepAnalytics(req.params.id)
    ]);
    res.json({ campaign, analytics, steps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Experiment ledger
app.get('/api/experiments', async (req, res) => {
  try {
    const { data } = await supabase
      .from('experiment_ledger')
      .select('*')
      .order('created_at', { ascending: false });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Current copy / base sequence
app.get('/api/copy', async (req, res) => {
  try {
    const { BASE_SEQUENCE } = await import('../sequences/base_sequence.js');
    const { data: topVariants } = await supabase
      .from('experiment_ledger')
      .select('*')
      .eq('outcome', 'winner')
      .order('positive_reply_rate', { ascending: false })
      .limit(5);
    res.json({ base_sequence: BASE_SEQUENCE, top_variants: topVariants || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pipeline status
app.get('/api/pipeline', async (req, res) => {
  try {
    const { data } = await supabase
      .from('pipeline_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();
    res.json(data || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reply queue
app.get('/api/reply-queue', async (req, res) => {
  try {
    const { data } = await supabase
      .from('reply_log')
      .select('*')
      .eq('action', 'pending')
      .order('created_at', { ascending: false });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Campaign actions
app.post('/api/campaigns/:id/pause', async (req, res) => {
  try {
    const r = await fetch(`${process.env.INSTANTLY_BASE_URL}/campaigns/${req.params.id}/pause`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.INSTANTLY_API_KEY}` }
    });
    res.json(await r.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/campaigns/:id/activate', async (req, res) => {
  try {
    const r = await fetch(`${process.env.INSTANTLY_BASE_URL}/campaigns/${req.params.id}/activate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.INSTANTLY_API_KEY}` }
    });
    res.json(await r.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Instantly reply webhook receiver
app.post('/webhook/reply', async (req, res) => {
  res.sendStatus(200);

  const payload = req.body;
  logger.info('Reply webhook received', { email: payload.lead_email });

  try {
    const leadEmail = payload.lead_email || payload.email;
    const replyBody = payload.reply_body || payload.body || '';
    const campaignId = payload.campaign_id || '';
    const replyToUuid = payload.reply_to_uuid || payload.uuid || '';
    const threadId = payload.thread_id || '';

    const { data: leadData } = await supabase
      .from('seen_leads')
      .select('first_name, last_name, company_name')
      .eq('email', leadEmail)
      .single();

    const leadName = leadData
      ? `${leadData.first_name || ''} ${leadData.last_name || ''}`.trim()
      : leadEmail;

    const companyName = leadData?.company_name || 'Unknown Company';

    const draft = await draftReply({
      lead_name: leadName,
      company_name: companyName,
      reply_body: replyBody
    });

    const { data: logRow } = await supabase
      .from('reply_log')
      .insert({
        lead_email: leadEmail,
        company_name: companyName,
        campaign_id: campaignId,
        instantly_thread_id: threadId,
        reply_to_uuid: replyToUuid,
        inbound_message: replyBody,
        oracle_draft: draft,
        action: 'pending'
      })
      .select()
      .single();

    if (!logRow) throw new Error('Failed to create reply log entry');

    const replyId = logRow.id;
    const excerpt = replyBody.slice(0, 200) + (replyBody.length > 200 ? '...' : '');

    const message = `ORACLE REPLY DRAFT

From: ${leadName} (${leadEmail})
Company: ${companyName}
Campaign: ${campaignId}

THEIR REPLY:
"${excerpt}"

ORACLE DRAFT:
${draft}

---
Review and choose an action:`;

    const sentMsg = await sendTelegramWithButtons(message, [
      [{ text: 'Approve & Send', callback_data: `approve_${replyId}` }],
      [{ text: 'Edit', callback_data: `edit_${replyId}` }],
      [{ text: 'Skip', callback_data: `skip_${replyId}` }]
    ]);

    if (sentMsg) {
      await supabase
        .from('reply_log')
        .update({ telegram_message_id: sentMsg.message_id.toString() })
        .eq('id', replyId);
    }

  } catch (err) {
    logger.error('Reply webhook processing error', { error: err.message });
  }
});

// Engine on/off state
app.get('/api/engine/state', (req, res) => {
  res.json(getEngineState());
});

app.post('/api/engine/state', (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  const state = setEngineState(enabled);
  logger.info(`ORACLE engine ${enabled ? 'ENABLED' : 'DISABLED'} via dashboard`);
  res.json(state);
});

// Skip list (client/blocked domains)
app.get('/api/skip-list', (req, res) => {
  res.json(getSkipList());
});

app.post('/api/skip-list', (req, res) => {
  const { domain } = req.body;
  if (!domain || typeof domain !== 'string' || !domain.trim()) {
    return res.status(400).json({ error: 'domain is required' });
  }
  const result = addDomain(domain.trim());
  logger.info('Skip list: domain added', { domain: result.domain });
  res.json(result);
});

app.delete('/api/skip-list/:domain', (req, res) => {
  const domains = removeDomain(decodeURIComponent(req.params.domain));
  logger.info('Skip list: domain removed', { domain: req.params.domain });
  res.json({ domains });
});

// Mobile view
app.get('/mobile', (req, res) => {
  res.sendFile(join(__dirname, 'public/mobile.html'));
});

export function startDashboard() {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    logger.info(`ORACLE dashboard running on port ${port}`);
  });
  return app;
}

export default app;
