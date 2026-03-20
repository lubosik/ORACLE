import { supabase } from '../utils/supabase.js';
import { logActivity } from '../utils/activity.js';
import { getSchedule } from '../utils/settings.js';

const DAY_NAMES = { '0':'Sun','1':'Mon','2':'Tue','3':'Wed','4':'Thu','5':'Fri','6':'Sat' };

export async function sendCampaignApprovalRequest(bot, chatId, draft) {
  const inboxList = Array.isArray(draft.selected_inboxes)
    ? draft.selected_inboxes.join('\n  ')
    : draft.selected_inboxes;
  const seq = draft.sequence_snapshot;

  const schedule = await getSchedule();
  const activeDays = schedule.days.map(d => DAY_NAMES[d] || d).join(', ');

  const truncate = (str, n) => (str || '').length > n ? (str || '').slice(0, n) + '...' : (str || '');

  const message = `ORACLE — CAMPAIGN READY FOR APPROVAL

Campaign: ${draft.campaign_name}
Leads: ${draft.lead_count}
Variant: ${draft.variant_id || 'v1_baseline'}

INBOXES SELECTED:
  ${inboxList}

SENDING SCHEDULE:
  ${schedule.timeFrom} — ${schedule.timeTo} ${schedule.timezone}
  Days: ${activeDays}
  Daily limit: ${schedule.dailyLimit} emails/day

EMAIL 1
Subject: ${seq.email_1.subject}
${truncate(seq.email_1.body, 300)}

EMAIL 2
Subject: ${seq.email_2.subject}
${truncate(seq.email_2.body, 300)}

EMAIL 3
Subject: ${seq.email_3.subject}
${truncate(seq.email_3.body, 200)}

EMAIL 4
Subject: ${seq.email_4.subject}
${truncate(seq.email_4.body, 150)}

SAMPLE LEADS (first 5):
${draft.leads_snapshot.slice(0, 5).map(l =>
  `  ${l.firstName} ${l.lastName} — ${l.companyName} (${l.email})`
).join('\n')}${draft.lead_count > 5 ? `\n  ...and ${draft.lead_count - 5} more` : ''}

Approve to push live to Instantly. Reject to discard.
Draft expires in 24 hours.`.trim();

  const sent = await bot.sendMessage(chatId, message, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Approve Campaign', callback_data: `approvecampaign_${draft.id}` },
          { text: 'Reject', callback_data: `rejectcampaign_${draft.id}` }
        ]
      ]
    }
  });

  // Store telegram_message_id so we can edit it after action
  await supabase
    .from('campaign_drafts')
    .update({ telegram_message_id: String(sent.message_id) })
    .eq('id', draft.id);

  await logActivity({
    category: 'approval',
    level: 'info',
    message: `Campaign approval request sent to Telegram — draft ID: ${draft.id}`
  });

  return sent;
}
