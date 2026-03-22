import { supabase } from '../utils/supabase.js';
import { getPendingEdits } from './bot.js';
import { logActivity } from '../utils/activity.js';
import { launchApprovedCampaign, activateStagedCampaign } from '../pipeline/launch_approved.js';
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

  // --- Campaign approval callbacks ---
  if (callbackData.startsWith('approvecampaign_')) {
    const draftId = callbackData.replace('approvecampaign_', '');

    const { data: draft } = await supabase
      .from('campaign_drafts')
      .select('*')
      .eq('id', draftId)
      .eq('status', 'pending')
      .single();

    if (!draft) {
      await bot.sendMessage(chatId, 'Campaign draft not found or already actioned.');
      return;
    }

    await supabase
      .from('campaign_drafts')
      .update({ status: 'approved', actioned_at: new Date().toISOString() })
      .eq('id', draftId);

    await bot.editMessageText(
      `ORACLE — CAMPAIGN APPROVED\n${draft.campaign_name}\n${draft.lead_count} leads\nPushing to Instantly now...`,
      { chat_id: message.chat.id, message_id: message.message_id }
    );

    await logActivity({
      category: 'approval',
      level: 'success',
      message: `Campaign approved via Telegram — pushing to Instantly`,
      detail: { draft_id: draftId }
    });

    try {
      await launchApprovedCampaign(draft);
    } catch (err) {
      await bot.sendMessage(chatId, `Campaign launch failed: ${err.message}\n\nCheck Railway logs for details.`);
    }
    return;
  }

  // --- Launch staged campaign (after user reviews in Instantly UI) ---
  if (callbackData.startsWith('launchcampaign_')) {
    const draftId = callbackData.replace('launchcampaign_', '');

    const { data: draft } = await supabase
      .from('campaign_drafts')
      .select('*')
      .eq('id', draftId)
      .eq('status', 'staged')
      .single();

    if (!draft || !draft.instantly_campaign_id) {
      await bot.sendMessage(chatId, 'Campaign not found or already launched.');
      return;
    }

    await bot.editMessageText(
      `ORACLE — LAUNCHING...\n${draft.campaign_name}\nActivating campaign in Instantly now...`,
      { chat_id: message.chat.id, message_id: message.message_id }
    );

    try {
      await activateStagedCampaign(draft.instantly_campaign_id, draft);

      await bot.sendMessage(chatId,
        `ORACLE — CAMPAIGN LIVE\n\nName: ${draft.campaign_name}\nInstantly ID: ${draft.instantly_campaign_id}\n\nEmails are now sending. Monitor from the ORACLE dashboard.`
      );

      await logActivity({
        category: 'approval',
        level: 'success',
        message: `Campaign launched via Telegram — now active in Instantly`,
        detail: { draft_id: draftId, instantly_campaign_id: draft.instantly_campaign_id }
      });
    } catch (err) {
      await bot.sendMessage(chatId, `Failed to activate campaign: ${err.message}\n\nYou can activate it manually in Instantly.`);
      logger.error('Campaign activation failed', { error: err.message, draft_id: draftId });
    }
    return;
  }

  // --- Cancel a staged campaign ---
  if (callbackData.startsWith('cancelcampaign_')) {
    const draftId = callbackData.replace('cancelcampaign_', '');

    await supabase
      .from('campaign_drafts')
      .update({ status: 'cancelled', actioned_at: new Date().toISOString() })
      .eq('id', draftId);

    await bot.editMessageText(
      `ORACLE — CAMPAIGN CANCELLED\nCampaign remains in Instantly as a draft. Delete it manually if needed.`,
      { chat_id: message.chat.id, message_id: message.message_id }
    );

    await logActivity({
      category: 'approval',
      level: 'warning',
      message: `Staged campaign cancelled via Telegram`,
      detail: { draft_id: draftId }
    });
    return;
  }

  if (callbackData.startsWith('rejectcampaign_')) {
    const draftId = callbackData.replace('rejectcampaign_', '');

    await supabase
      .from('campaign_drafts')
      .update({ status: 'rejected', actioned_at: new Date().toISOString() })
      .eq('id', draftId);

    await bot.editMessageText(
      `ORACLE — CAMPAIGN REJECTED\nDraft discarded. No emails were sent.`,
      { chat_id: message.chat.id, message_id: message.message_id }
    );

    await logActivity({
      category: 'approval',
      level: 'warning',
      message: `Campaign rejected via Telegram — draft discarded`,
      detail: { draft_id: draftId }
    });
    return;
  }

  // --- Reply log callbacks (existing) ---
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
