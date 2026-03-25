import TelegramBot from 'node-telegram-bot-api';
import { handleCallback } from './handler.js';
import logger from '../utils/logger.js';
import 'dotenv/config';

let bot = null;
const pendingEdits = new Map();

export function getBot() {
  return bot;
}

export function getPendingEdits() {
  return pendingEdits;
}

export async function sendTelegram(message) {
  if (!bot || !process.env.TELEGRAM_CHAT_ID) {
    logger.warn('Telegram not configured, skipping message', { preview: message.slice(0, 100) });
    return null;
  }
  try {
    return await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, message);
  } catch (err) {
    logger.error('Telegram send failed', { error: err.message });
    return null;
  }
}

export async function sendTelegramWithButtons(message, inlineKeyboard) {
  if (!bot || !process.env.TELEGRAM_CHAT_ID) {
    logger.warn('Telegram not configured');
    return null;
  }
  try {
    return await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, message, {
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
  } catch (err) {
    logger.error('Telegram send with buttons failed', { error: err.message });
    return null;
  }
}

export async function stopTelegramBot() {
  if (bot) {
    try {
      await bot.stopPolling();
      bot = null;
      logger.info('Telegram bot polling stopped');
    } catch (err) {
      logger.warn('Error stopping Telegram bot polling', { error: err.message });
    }
  }
}

export function startTelegramBot() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    logger.warn('TELEGRAM_BOT_TOKEN not set, Telegram bot disabled');
    return;
  }

  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

  bot.on('callback_query', async (query) => {
    try {
      await handleCallback(query, bot);
    } catch (err) {
      logger.error('Callback handler error', { error: err.message });
    }
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id.toString();
    const pending = pendingEdits.get(chatId);
    if (pending && msg.text) {
      pendingEdits.delete(chatId);
      await pending.resolve(msg.text);
    }
  });

  bot.on('polling_error', async (err) => {
    if (err.message && err.message.includes('409 Conflict')) {
      logger.warn('Telegram 409 Conflict: another instance is polling. Retrying in 15s...');
      await stopTelegramBot();
      setTimeout(() => startTelegramBot(), 15000);
    } else {
      logger.error('Telegram polling error', { error: err.message });
    }
  });

  logger.info('Telegram bot started');
}
