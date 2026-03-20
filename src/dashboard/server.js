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
import { activitySSEHandler } from '../utils/activity.js';
import { getSetting, setSetting } from '../utils/settings.js';
import { logActivity } from '../utils/activity.js';
import { launchApprovedCampaign } from '../pipeline/launch_approved.js';
import { invalidateAssetsCache } from '../utils/assets.js';
import { classifyReply } from '../loop/reply_analyzer.js';
import { getVerticals, updateVerticalStatus } from '../loop/vertical_researcher.js';
import { getBanditState } from '../loop/multi_armed_bandit.js';
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
    // Instantly sends step as 0-indexed — convert to 1-indexed for context
    const emailStep = payload.email_sequence_step != null
      ? parseInt(payload.email_sequence_step) + 1
      : (payload.step_number != null ? parseInt(payload.step_number) : null);

    const { data: leadData } = await supabase
      .from('seen_leads')
      .select('first_name, last_name, company_name')
      .eq('email', leadEmail)
      .single();

    const leadName = leadData
      ? `${leadData.first_name || ''} ${leadData.last_name || ''}`.trim()
      : leadEmail;

    const companyName = leadData?.company_name || 'Unknown Company';

    // Classify reply intent in parallel with draft generation
    const [draft, replyClass] = await Promise.all([
      draftReply({ lead_name: leadName, company_name: companyName, reply_body: replyBody, email_step: emailStep }),
      classifyReply(replyBody)
    ]);

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
        action: 'pending',
        reply_intent: replyClass?.intent || null,
        reply_sentiment: replyClass?.sentiment || null,
        ...(emailStep ? { email_step: emailStep } : {})
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

// ---- Campaign assets CRUD ----
app.get('/api/assets', async (req, res) => {
  try {
    const { data } = await supabase
      .from('campaign_assets')
      .select('*')
      .order('sort_order');
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/assets', async (req, res) => {
  try {
    const { name, category, url, description, use_in_email_2, sort_order } = req.body;
    if (!name || !category || !url) return res.status(400).json({ error: 'name, category, url required' });
    const { data, error } = await supabase
      .from('campaign_assets')
      .insert({ name, category, url, description, use_in_email_2: !!use_in_email_2, sort_order: sort_order || 0, is_active: true })
      .select().single();
    if (error) throw error;
    invalidateAssetsCache();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/assets/:id', async (req, res) => {
  try {
    const allowed = ['name', 'category', 'url', 'description', 'is_active', 'use_in_email_2', 'sort_order'];
    const updates = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    const { data, error } = await supabase
      .from('campaign_assets')
      .update(updates)
      .eq('id', req.params.id)
      .select().single();
    if (error) throw error;
    invalidateAssetsCache();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/assets/:id', async (req, res) => {
  try {
    await supabase.from('campaign_assets').delete().eq('id', req.params.id);
    invalidateAssetsCache();
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- NEW: Activity feed ----
app.get('/api/activity/stream', activitySSEHandler);

app.get('/api/activity', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const { data } = await supabase
      .from('activity_feed')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit);
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- NEW: System settings ----
app.get('/api/settings', async (req, res) => {
  try {
    const { data } = await supabase.from('system_settings').select('*');
    res.json(Object.fromEntries((data || []).map(r => [r.key, r.value])));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'key is required' });
    await setSetting(key, value);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- NEW: Global on/off toggle (Supabase-backed) ----
app.post('/api/oracle/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });
    await setSetting('oracle_enabled', enabled ? 'true' : 'false');
    await logActivity({
      category: 'system',
      level: enabled ? 'success' : 'warning',
      message: `ORACLE ${enabled ? 'ENABLED' : 'DISABLED'} via dashboard`
    });
    res.json({ oracle_enabled: enabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- NEW: Inbox registry ----
app.get('/api/inboxes', async (req, res) => {
  try {
    const { data } = await supabase
      .from('inbox_registry_status')
      .select('*')
      .order('days_warmed', { ascending: false });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- NEW: Campaign drafts ----
app.get('/api/drafts', async (req, res) => {
  try {
    const { data } = await supabase
      .from('campaign_drafts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve draft from dashboard
app.post('/api/drafts/:id/approve', async (req, res) => {
  try {
    const { data: draft } = await supabase
      .from('campaign_drafts')
      .select('*')
      .eq('id', req.params.id)
      .eq('status', 'pending')
      .single();

    if (!draft) return res.status(404).json({ error: 'Draft not found or already actioned' });

    await supabase
      .from('campaign_drafts')
      .update({ status: 'approved', actioned_at: new Date().toISOString(), actioned_by: 'dashboard' })
      .eq('id', req.params.id);

    await logActivity({
      category: 'approval',
      level: 'success',
      message: `Campaign approved via dashboard — pushing to Instantly`,
      detail: { draft_id: req.params.id }
    });

    // Launch async so we can respond immediately
    launchApprovedCampaign(draft).catch(err => {
      logger.error('Dashboard-triggered launch failed', { error: err.message });
    });

    res.json({ ok: true, status: 'approved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reject draft from dashboard
app.post('/api/drafts/:id/reject', async (req, res) => {
  try {
    await supabase
      .from('campaign_drafts')
      .update({ status: 'rejected', actioned_at: new Date().toISOString(), actioned_by: 'dashboard' })
      .eq('id', req.params.id);

    await logActivity({
      category: 'approval',
      level: 'warning',
      message: `Campaign rejected via dashboard — draft discarded`,
      detail: { draft_id: req.params.id }
    });

    res.json({ ok: true, status: 'rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Campaign controls (pause/activate/delete) — log activity ----
app.post('/api/campaigns/:id/pause', async (req, res) => {
  try {
    const r = await fetch(`${process.env.INSTANTLY_BASE_URL}/campaigns/${req.params.id}/pause`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.INSTANTLY_API_KEY}` }
    });
    const result = await r.json();
    await logActivity({ category: 'campaign', level: 'warning', message: `Campaign paused from dashboard — ID: ${req.params.id}`, campaign_id: req.params.id });
    res.json(result);
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
    const result = await r.json();
    await logActivity({ category: 'campaign', level: 'success', message: `Campaign activated from dashboard — ID: ${req.params.id}`, campaign_id: req.params.id });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/campaigns/:id', async (req, res) => {
  try {
    const r = await fetch(`${process.env.INSTANTLY_BASE_URL}/campaigns/${req.params.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${process.env.INSTANTLY_API_KEY}` }
    });
    await logActivity({ category: 'campaign', level: 'warning', message: `Campaign deleted from dashboard — ID: ${req.params.id}`, campaign_id: req.params.id });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Research Intelligence API ----

app.get('/api/research/icp', async (req, res) => {
  try {
    const { data } = await supabase
      .from('cohort_insights')
      .select('*')
      .gte('emails_sent', 3)
      .order('reply_rate', { ascending: false })
      .limit(20);
    const refined = await getSetting('refined_icp', null);
    res.json({ cohorts: data || [], refined_icp: refined ? JSON.parse(refined) : null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/research/replies', async (req, res) => {
  try {
    const { data } = await supabase
      .from('reply_insights')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    const stepAttr = await getSetting('step_attribution', null);
    res.json({
      insights: data || [],
      step_attribution: stepAttr ? JSON.parse(stepAttr) : null
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/research/synthesis', async (req, res) => {
  try {
    const { data } = await supabase
      .from('winner_synthesis')
      .select('*')
      .order('synthesized_at', { ascending: false })
      .limit(3);
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/research/program', async (req, res) => {
  try {
    const { data } = await supabase
      .from('program_evolution')
      .select('evolved_at, rationale, key_changes, performance_context')
      .order('evolved_at', { ascending: false })
      .limit(5);
    const { readFile } = await import('fs/promises');
    const { fileURLToPath } = await import('url');
    const { dirname: dn, join: pjoin } = await import('path');
    const dir = dn(fileURLToPath(import.meta.url));
    let current = '';
    try { current = await readFile(pjoin(dir, '../program.md'), 'utf8'); } catch {}
    res.json({ current_program: current, evolution_history: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/research/deliverability', async (req, res) => {
  try {
    const { data } = await supabase
      .from('deliverability_log')
      .select('*')
      .order('date', { ascending: false })
      .limit(30);
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/research/verticals', async (req, res) => {
  try {
    res.json(await getVerticals());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/research/verticals/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['proposed', 'testing', 'active', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    await updateVerticalStatus(req.params.id, status);
    await logActivity({ category: 'research', level: 'info', message: `Vertical ${req.params.id} status → ${status}` });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/research/bandit', async (req, res) => {
  try {
    res.json(await getBanditState());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export function startDashboard() {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    logger.info(`ORACLE dashboard running on port ${port}`);
  });
  return app;
}

export default app;
