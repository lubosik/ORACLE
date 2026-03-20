import { supabase } from '../utils/supabase.js';
import { logActivity } from '../utils/activity.js';
import { getSchedule } from '../utils/settings.js';
import { writeFile, unlink } from 'fs/promises';
import { createTransport } from 'nodemailer';
import logger from '../utils/logger.js';

const DAY_NAMES = { '0':'Sun','1':'Mon','2':'Tue','3':'Wed','4':'Thu','5':'Fri','6':'Sat' };

function buildFullDraftText(draft, schedule) {
  const seq = draft.sequence_snapshot;
  const geoContext = draft.geo_context
    ? (typeof draft.geo_context === 'string' ? JSON.parse(draft.geo_context) : draft.geo_context)
    : null;

  const tz       = geoContext?.timezone        || schedule.timezone;
  const timeFrom = geoContext?.send_hours?.from || schedule.timeFrom;
  const timeTo   = geoContext?.send_hours?.to   || schedule.timeTo;
  const activeDays = schedule.days.map(d => DAY_NAMES[d] || d).join(', ');

  const geoLine = geoContext
    ? `Geo Target   : ${geoContext.geo_label} (${geoContext.country})\nMarkets      : ${geoContext.targets_used.map(t => t.city || t.state).join(', ')}\n`
    : '';

  const inboxList = Array.isArray(draft.selected_inboxes)
    ? draft.selected_inboxes.join(', ')
    : draft.selected_inboxes;

  const leads = Array.isArray(draft.leads_snapshot) ? draft.leads_snapshot : [];

  return `ORACLE — CAMPAIGN DRAFT
${'='.repeat(60)}

Campaign     : ${draft.campaign_name}
Variant      : ${draft.variant_id || 'v1_baseline'}
Leads        : ${draft.lead_count}
${geoLine}Inboxes      : ${inboxList}

SENDING SCHEDULE
Send window  : ${timeFrom} — ${timeTo} ${tz}
Days         : ${activeDays}
Daily limit  : ${schedule.dailyLimit} emails/day

${'='.repeat(60)}
EMAIL 1 — Initial Outreach
${'='.repeat(60)}
Subject: ${seq.email_1.subject}

${seq.email_1.body}

${'='.repeat(60)}
EMAIL 2 — Follow-up (Day 3)
${'='.repeat(60)}
Subject: ${seq.email_2.subject}

${seq.email_2.body}

${'='.repeat(60)}
EMAIL 3 — Follow-up (Day 7)
${'='.repeat(60)}
Subject: ${seq.email_3.subject}

${seq.email_3.body}

${'='.repeat(60)}
EMAIL 4 — Final Touch (Day 13)
${'='.repeat(60)}
Subject: ${seq.email_4.subject}

${seq.email_4.body}

${'='.repeat(60)}
LEAD LIST (${leads.length} contacts)
${'='.repeat(60)}
${leads.map((l, i) =>
  `${String(i + 1).padStart(3, ' ')}. ${l.firstName} ${l.lastName} | ${l.title || 'N/A'} | ${l.companyName} | ${l.email}`
).join('\n')}

${'='.repeat(60)}
Draft ID: ${draft.id}
Created : ${new Date().toISOString()}
Approve from Telegram or the ORACLE dashboard.
`;
}

async function sendDraftEmail(draft, draftText) {
  const to = process.env.NOTIFICATION_EMAIL;
  if (!to) {
    logger.warn('NOTIFICATION_EMAIL not set — skipping email delivery of campaign draft');
    return;
  }

  const transportConfig = process.env.SMTP_HOST ? {
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  } : {
    // Gmail shorthand — works with an App Password
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  };

  try {
    const transporter = createTransport(transportConfig);
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to,
      subject: `ORACLE — Campaign Ready for Approval: ${draft.campaign_name}`,
      text: draftText,
      attachments: [{
        filename: `${draft.campaign_name}.txt`,
        content: draftText
      }]
    });
    logger.info('Campaign draft emailed', { to, campaign: draft.campaign_name });
  } catch (err) {
    logger.error('Failed to email campaign draft', { error: err.message });
  }
}

export async function sendCampaignApprovalRequest(bot, chatId, draft) {
  const schedule = await getSchedule();

  const geoContext = draft.geo_context
    ? (typeof draft.geo_context === 'string' ? JSON.parse(draft.geo_context) : draft.geo_context)
    : null;

  const tz       = geoContext?.timezone        || schedule.timezone;
  const timeFrom = geoContext?.send_hours?.from || schedule.timeFrom;
  const timeTo   = geoContext?.send_hours?.to   || schedule.timeTo;
  const activeDays = schedule.days.map(d => DAY_NAMES[d] || d).join(', ');
  const seq = draft.sequence_snapshot;

  const geoLine = geoContext
    ? `\nGeo: ${geoContext.geo_label} (${geoContext.country}) — ${geoContext.targets_used.map(t => t.city || t.state).join(', ')}`
    : '';

  // Telegram overview message (stays within 4096 char limit)
  const inboxList = Array.isArray(draft.selected_inboxes)
    ? draft.selected_inboxes.join(', ')
    : draft.selected_inboxes;

  const overviewMsg = `ORACLE — CAMPAIGN READY FOR APPROVAL

Campaign: ${draft.campaign_name}
Leads: ${draft.lead_count}
Variant: ${draft.variant_id || 'v1_baseline'}${geoLine}
Inboxes: ${inboxList}
Schedule: ${timeFrom}–${timeTo} ${tz} | ${activeDays} | ${schedule.dailyLimit}/day

EMAIL 1 — ${seq.email_1.subject}
EMAIL 2 — ${seq.email_2.subject}
EMAIL 3 — ${seq.email_3.subject}
EMAIL 4 — ${seq.email_4.subject}

Full copy + lead list attached below. Tap Approve to push live.`.trim();

  // Send overview with approve/reject buttons
  const sent = await bot.sendMessage(chatId, overviewMsg, {
    reply_markup: {
      inline_keyboard: [[
        { text: 'Approve Campaign', callback_data: `approvecampaign_${draft.id}` },
        { text: 'Reject',           callback_data: `rejectcampaign_${draft.id}` }
      ]]
    }
  });

  // Build full draft text
  const draftText = buildFullDraftText(draft, schedule);

  // Send full draft as document to Telegram
  const tmpPath = `/tmp/oracle_draft_${draft.id}.txt`;
  try {
    await writeFile(tmpPath, draftText, 'utf8');
    await bot.sendDocument(chatId, tmpPath, {
      caption: `Full campaign copy + ${draft.lead_count} leads — ${draft.campaign_name}`
    });
  } catch (err) {
    logger.error('Failed to send draft document to Telegram', { error: err.message });
  } finally {
    await unlink(tmpPath).catch(() => {});
  }

  // Also deliver to email if configured
  await sendDraftEmail(draft, draftText);

  // Store telegram_message_id for editing after action
  await supabase
    .from('campaign_drafts')
    .update({ telegram_message_id: String(sent.message_id) })
    .eq('id', draft.id);

  await logActivity({
    category: 'approval',
    level: 'info',
    message: `Campaign approval sent — Telegram + full draft document (${draft.lead_count} leads)`,
    detail: { draft_id: draft.id, campaign_name: draft.campaign_name }
  });

  return sent;
}
