import OpenAI from 'openai';
import { logActivity } from './activity.js';
import { sendTelegram as sendTelegramAlert } from '../telegram/bot.js';

const client = new OpenAI({
  apiKey: process.env.NVIDIA_NIM_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
  timeout: 300000 // 5 minutes — Kimi K2.5 is a reasoning model and thinks before responding
});

const MODEL = 'moonshotai/kimi-k2.5';

/**
 * Validate and extract content string from a NVIDIA NIM response.
 * Returns { content, error } rather than throwing so callers get context.
 */
function extractContent(response) {
  if (!response) {
    return { content: null, error: 'Kimi K2.5 returned null or undefined response' };
  }

  if (response.error) {
    return {
      content: null,
      error: `Kimi K2.5 API error: ${response.error.message || JSON.stringify(response.error)}`
    };
  }

  if (!response.choices || !Array.isArray(response.choices)) {
    return {
      content: null,
      error: `Kimi K2.5 response missing choices array. Raw: ${JSON.stringify(response).slice(0, 500)}`
    };
  }

  if (response.choices.length === 0) {
    return {
      content: null,
      error: `Kimi K2.5 returned empty choices array. Raw: ${JSON.stringify(response).slice(0, 500)}`
    };
  }

  const message = response.choices[0]?.message;

  if (!message) {
    return {
      content: null,
      error: `Kimi K2.5 choices[0].message is undefined. Raw: ${JSON.stringify(response).slice(0, 500)}`
    };
  }

  // Kimi K2.5 is a reasoning model — content is null while thinking, populated after.
  // If content is null but reasoning exists, max_tokens was too low to finish thinking.
  const content = message.content;
  const reasoning = message.reasoning;

  if ((content === null || content === undefined || content === '') && reasoning) {
    return {
      content: null,
      error: `Kimi K2.5 ran out of tokens during reasoning (finish_reason: ${response.choices[0]?.finish_reason}). Increase maxTokens — current usage: ${response.usage?.total_tokens} tokens.`
    };
  }

  if (content === null || content === undefined || content === '') {
    return {
      content: null,
      error: `Kimi K2.5 returned empty content. Finish reason: ${response.choices[0]?.finish_reason}`
    };
  }

  return { content, error: null };
}

/**
 * Call Kimi K2.5 via NVIDIA NIM.
 * Used by every ORACLE module for all AI calls.
 * Throws with a descriptive error if the call fails.
 */
export async function callAI({
  messages,
  systemPrompt = null,
  maxTokens = 2000,
  temperature = 0.7,
  module: moduleName = 'unknown',
  expectJSON = false
}) {
  const builtMessages = [];

  if (systemPrompt) {
    builtMessages.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    builtMessages.push(msg);
  }

  let response;

  try {
    response = await client.chat.completions.create({
      model: MODEL,
      messages: builtMessages,
      max_tokens: Math.min(maxTokens, 16384),
      temperature: Math.min(temperature, 1.0),
      top_p: 1.0
    });
  } catch (err) {
    const errMsg = `Kimi K2.5 request failed in ${moduleName}: ${err.message}`;

    await logActivity({
      category: 'error',
      level: 'error',
      message: errMsg,
      detail: { module: moduleName, error: err.message }
    });

    await sendTelegramAlert(
      `ORACLE ERROR\n\nModule: ${moduleName}\nModel: ${MODEL}\nError: ${err.message}\n\nCheck NVIDIA NIM credits at: build.nvidia.com`
    );

    throw new Error(errMsg);
  }

  const { content, error } = extractContent(response);

  if (error) {
    await logActivity({
      category: 'error',
      level: 'error',
      message: `Malformed response from Kimi K2.5 in ${moduleName}`,
      detail: { error, module: moduleName }
    });

    await sendTelegramAlert(
      `ORACLE ERROR\n\nModule: ${moduleName}\nModel: ${MODEL}\nMalformed response: ${error}\n\nCheck NVIDIA NIM status.`
    );

    throw new Error(error);
  }

  await logActivity({
    category: 'system',
    level: 'info',
    message: `Kimi K2.5 call successful in ${moduleName}`,
    detail: {
      module: moduleName,
      model: MODEL,
      tokens_used: response.usage?.total_tokens || 'unknown',
      finish_reason: response.choices[0]?.finish_reason
    }
  });

  return expectJSON ? sanitiseJSON(content) : content;
}

/**
 * Strip markdown fences and parse JSON safely.
 */
function sanitiseJSON(raw) {
  if (!raw) throw new Error('Kimi K2.5 returned empty content — cannot parse JSON');

  const stripped = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
    throw new Error(
      `Failed to parse Kimi K2.5 response as JSON. First 300 chars: ${stripped.slice(0, 300)}`
    );
  }
}
