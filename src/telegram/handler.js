import { supabase } from '../utils/supabase.js';
import { getPendingEdits } from './bot.js';
import logger from '../utils/logger.js';
import 'dotenv/config';

const BASE_URL = process.env.INSTANTLY_BASE_URL || 'https://api.instantly.ai/api/v2';

async function sendInstantlyReply(replyToUuid, body) {
  const res = await fetch(`${BASE_URL}/emails/reply`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.INSTANTLY_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      reply_to_uuid: replyToUuid,
      body
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Instantly reply error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function handleCallback(query, bot) {
  const { data: callbackData, message, from } = query;
  const chatId = message.chat.id.toString();

  await bot.answerCallbackQuery(query.id);

  const [action, replyId] = callbackData.split('_').reduce((acc, part, i) => {
    if (i === 0) acc[0] = part;
    else acc[1] = (acc[1] ? acc[1] + '_' : '') + part;
    return acc;
  }, ['', '']);

  const { data: replyLog } = await supabase
    .from('reply_log')
    .select('*')
    .eq('id', replyId)
    .single();

  if (!replyLog) {
    await bot.editMessageText('Error: Reply not found.', {
      chat_id: message.chat.id,
      message_id: message.message_id
    });
    return;
  }

  if (action === 'approve') {
    try {
      await sendInstantlyReply(replyLog.reply_to_uuid, replyLog.oracle_draft);

      await supabase
        .from('reply_log')
        .update({
          action: 'approved',
          final_reply: replyLog.oracle_draft,
          sent_at: new Date().toISOString()
        })
        .eq('id', replyId);

      await bot.editMessageText(
        message.text + '\n\nSent.',
        { chat_id: message.chat.id, message_id: message.message_id }
      );

      logger.info('Reply approved and sent', { reply_id: replyId, lead_email: replyLog.lead_email });

    } catch (err) {
      logger.error('Failed to send approved reply', { error: err.message });
      await bot.editMessageText(
        message.text + `\n\nFailed to send: ${err.message}`,
        { chat_id: message.chat.id, message_id: message.message_id }
      );
    }

  } else if (action === 'edit') {
    await bot.sendMessage(chatId, 'Send me your edited version as a reply to this message.');

    const pendingEdits = getPendingEdits();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingEdits.delete(chatId);
        reject(new Error('Edit timeout'));
      }, 5 * 60 * 1000);

      pendingEdits.set(chatId, {
        resolve: async (editedText) => {
          clearTimeout(timeout);
          resolve(editedText);

          await supabase
            .from('reply_log')
            .update({ oracle_draft: editedText })
            .eq('id', replyId);

          await bot.sendMessage(chatId, `Updated draft:\n\n${editedText}`, {
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Approve & Send', callback_data: `approve_${replyId}` }],
                [{ text: 'Cancel', callback_data: `skip_${replyId}` }]
              ]
            }
          });
        }
      });
    }).catch(err => logger.warn('Edit flow ended', { error: err.message }));

  } else if (action === 'skip') {
    await supabase
      .from('reply_log')
      .update({ action: 'skipped' })
      .eq('id', replyId);

    await bot.editMessageText(
      message.text + '\n\nSkipped. Handle manually in Instantly Unibox.',
      { chat_id: message.chat.id, message_id: message.message_id }
    );

    logger.info('Reply skipped', { reply_id: replyId });
  }
}
