import { supabase } from './supabase.js';
import logger from './logger.js';

// In-memory buffer for SSE streaming to dashboard
const activityBuffer = [];
const MAX_BUFFER = 500;
const sseClients = new Set();

export async function logActivity({
  category,
  level = 'info',
  message,
  detail = null,
  pipeline_run_id = null,
  campaign_id = null,
  lead_email = null
}) {
  const entry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    category,
    level,
    message,
    detail,
    pipeline_run_id,
    campaign_id,
    lead_email
  };

  // 1. Log to Winston
  const winstonLevel = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
  logger[winstonLevel](message, detail || {});

  // 2. Write to Supabase
  try {
    await supabase.from('activity_feed').insert(entry);
  } catch (err) {
    logger.error('Failed to write activity to Supabase', { err: err.message });
  }

  // 3. Push to in-memory buffer for SSE
  activityBuffer.unshift(entry);
  if (activityBuffer.length > MAX_BUFFER) activityBuffer.pop();

  // 4. Broadcast to all connected SSE dashboard clients
  const ssePayload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const client of sseClients) {
    try { client.write(ssePayload); } catch { sseClients.delete(client); }
  }
}

// SSE endpoint handler — dashboard connects here for real-time feed
export function activitySSEHandler(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send last 100 entries on connect
  const recent = activityBuffer.slice(0, 100);
  res.write(`data: ${JSON.stringify({ type: 'history', entries: recent })}\n\n`);

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
}

export { activityBuffer };
