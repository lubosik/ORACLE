/**
 * Shared AI client for ORACLE — routes all LLM calls through AgentRouter.
 * Uses OpenAI SDK (AgentRouter is fully OpenAI-compatible).
 * Primary model: claude-sonnet-4-5-20250514
 * Fallback model: deepseek/deepseek-chat
 */
import OpenAI from 'openai';
import { logActivity } from './activity.js';
import 'dotenv/config';

const PRIMARY_MODEL = process.env.AGENT_ROUTER_PRIMARY_MODEL || 'claude-sonnet-4-5-20250514';
const FALLBACK_MODEL = process.env.AGENT_ROUTER_FALLBACK_MODEL || 'deepseek/deepseek-chat';

// Lazy singleton — constructed on first use so missing env var doesn't crash startup
let _client = null;
function getClient() {
  if (!_client) {
    const apiKey = process.env.AGENT_ROUTER_API_KEY;
    if (!apiKey) throw new Error('AGENT_ROUTER_API_KEY is not set');
    _client = new OpenAI({
      apiKey,
      baseURL: process.env.AGENT_ROUTER_BASE_URL || 'https://agentrouter.org/'
    });
  }
  return _client;
}

/**
 * Call the AI with automatic primary → fallback routing.
 * Returns the response content string, or parsed JSON if expectJSON=true.
 * Supports both `system` and `systemPrompt` param names for backwards compatibility.
 * Throws only if both primary and fallback fail.
 *
 * @param {object} opts
 * @param {Array}   opts.messages         - OpenAI-style messages array [{role, content}]
 * @param {string}  [opts.systemPrompt]   - System prompt (preferred param name)
 * @param {string}  [opts.system]         - System prompt (legacy alias)
 * @param {number}  [opts.maxTokens=1000] - Max tokens to generate
 * @param {number}  [opts.temperature=0.7]
 * @param {string}  [opts.module]         - Caller module name (for logging)
 * @param {boolean} [opts.expectJSON]     - Parse and return JSON instead of raw string
 */
export async function callAI({
  messages,
  systemPrompt = null,
  system = null,
  maxTokens = 1000,
  temperature = 0.7,
  module: mod = 'unknown',
  expectJSON = false
}) {
  const resolvedSystem = systemPrompt || system;
  const builtMessages = [];
  if (resolvedSystem) {
    builtMessages.push({ role: 'system', content: resolvedSystem });
  }
  for (const msg of messages) {
    builtMessages.push(msg);
  }

  // Try primary model first
  try {
    const response = await getClient().chat.completions.create({
      model: PRIMARY_MODEL,
      messages: builtMessages,
      max_tokens: maxTokens,
      temperature
    });

    const content = response.choices[0]?.message?.content || '';

    logActivity({
      category: 'system',
      level: 'info',
      message: `AI call successful via ${PRIMARY_MODEL}`,
      detail: { module: mod, model: PRIMARY_MODEL, tokens_used: response.usage?.total_tokens }
    }).catch(() => {});

    return expectJSON ? sanitiseJSON(content) : content;

  } catch (primaryErr) {
    const isCredit = isCreditsError(primaryErr);
    const isRate = isRateLimitError(primaryErr);

    logActivity({
      category: 'error',
      level: 'warning',
      message: `Primary model ${PRIMARY_MODEL} failed in ${mod} — trying fallback`,
      detail: { error: primaryErr.message, is_credit: isCredit, is_rate: isRate }
    }).catch(() => {});

    if (isCredit) {
      sendAlert(
        `ORACLE — AgentRouter Credit Warning\n\nPrimary model (${PRIMARY_MODEL}) returned a credit error.\nFalling back to ${FALLBACK_MODEL}.\n\nTop up credits at agentrouter.org/console`
      );
    }

    // Try fallback model
    try {
      const fallbackResponse = await getClient().chat.completions.create({
        model: FALLBACK_MODEL,
        messages: builtMessages,
        max_tokens: maxTokens,
        temperature
      });

      const content = fallbackResponse.choices[0]?.message?.content || '';

      logActivity({
        category: 'system',
        level: 'warning',
        message: `AI call completed via FALLBACK model ${FALLBACK_MODEL}`,
        detail: { module: mod, model: FALLBACK_MODEL, tokens_used: fallbackResponse.usage?.total_tokens }
      }).catch(() => {});

      return expectJSON ? sanitiseJSON(content) : content;

    } catch (fallbackErr) {
      const errMsg = `Both AI models failed in ${mod}. Primary: ${primaryErr.message}. Fallback: ${fallbackErr.message}`;

      logActivity({
        category: 'error',
        level: 'error',
        message: errMsg,
        detail: { module: mod, primary_error: primaryErr.message, fallback_error: fallbackErr.message }
      }).catch(() => {});

      sendAlert(
        `ORACLE CRITICAL ERROR\n\nBoth AI models failed in module: ${mod}\n\nPrimary (${PRIMARY_MODEL}): ${primaryErr.message}\nFallback (${FALLBACK_MODEL}): ${fallbackErr.message}\n\nPipeline has paused. Check AgentRouter credits and try again.`
      );

      throw new Error(errMsg);
    }
  }
}

/**
 * Fire-and-forget Telegram alert — dynamic import avoids circular dependencies.
 */
function sendAlert(message) {
  import('../telegram/bot.js')
    .then(({ sendTelegram }) => sendTelegram(message))
    .catch(() => {});
}

/**
 * Strip markdown fences and parse JSON safely.
 */
function sanitiseJSON(raw) {
  const stripped = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Failed to parse AI response as JSON: ${stripped.slice(0, 200)}`);
  }
}

function isCreditsError(err) {
  const msg = (err.message || '').toLowerCase();
  const status = err.status || err.statusCode;
  return status === 402 ||
    msg.includes('credit') ||
    msg.includes('quota') ||
    msg.includes('insufficient') ||
    msg.includes('balance is too low') ||
    msg.includes('billing');
}

function isRateLimitError(err) {
  return err.status === 429 || (err.message || '').includes('rate limit');
}
