import { logActivity } from './activity.js';

const ERROR_MESSAGES = {
  apify_credits: {
    message: 'Apify credits exhausted — scraping stopped',
    action: 'Top up Apify credits at console.apify.com. Scraping will resume on next pipeline run once credits are available.'
  },
  grok_credits: {
    message: 'Grok API credits exhausted — enrichment stopped',
    action: 'Top up xAI credits at console.x.ai. Enrichment will resume when credits are available.'
  },
  nvidia_credits: {
    message: 'NVIDIA NIM API credits exhausted — copy generation stopped',
    action: 'Top up NVIDIA NIM credits at build.nvidia.com or verify NVIDIA_NIM_API_KEY in Railway Variables. Copy generation will resume when available.'
  },
  instantly_rate_limit: {
    message: 'Instantly API rate limit hit — pausing for 60 seconds',
    action: 'ORACLE will automatically retry. If this persists, check Instantly plan limits.'
  },
  instantly_auth: {
    message: 'Instantly API authentication failed — check API key',
    action: 'Verify INSTANTLY_API_KEY in Railway Variables. The key may have expired or been revoked.'
  },
  supabase_connection: {
    message: 'Supabase connection failed',
    action: 'Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Railway Variables.'
  },
  no_warm_inboxes: {
    message: 'No warm inboxes available — campaign cannot launch',
    action: 'Wait for inboxes to reach 21 days of warming. Currently warm: check the Inboxes section of the ORACLE dashboard.'
  }
};

export async function handleError(errorType, originalError, context = {}) {
  const known = ERROR_MESSAGES[errorType];
  const message = known?.message || `Unknown error in ${context.module || 'ORACLE'}: ${originalError.message}`;
  const action = known?.action || 'Check Railway logs for details.';

  await logActivity({
    category: 'error',
    level: 'error',
    message,
    detail: { action, error: originalError.message, ...context }
  });

  // Send Telegram alert without circular imports
  try {
    const { sendTelegram } = await import('../telegram/bot.js');
    await sendTelegram(`ORACLE ERROR\n\n${message}\n\nAction: ${action}\n\nTime: ${new Date().toISOString()}`);
  } catch (telegramErr) {
    // Telegram failure shouldn't crash anything
  }
}

export function classifyError(error, apiName) {
  const msg = (error.message || '').toLowerCase();
  const status = error.status || error.statusCode;

  if (status === 429) return apiName === 'instantly' ? 'instantly_rate_limit' : `${apiName}_rate_limit`;
  if (status === 401 || status === 403) return `${apiName}_auth`;
  if (msg.includes('credit') || msg.includes('quota') || msg.includes('insufficient')) {
    if (apiName === 'apify') return 'apify_credits';
    if (apiName === 'grok' || apiName === 'xai') return 'grok_credits';
    if (apiName === 'nvidia' || apiName === 'kimi') return 'nvidia_credits';
  }
  return 'unknown';
}
