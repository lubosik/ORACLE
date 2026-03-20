import logger from './logger.js';
import 'dotenv/config';

const GATEWAY_URL = 'https://gateway.maton.ai/google-mail/gmail/v1/users/me/messages/send';

/**
 * Send an email via Maton AI Gmail gateway.
 * Requires env vars: MATON_API_KEY, MATON_CONNECTION_ID, NOTIFICATION_EMAIL
 */
export async function sendMailNotification({ subject, text }) {
  const apiKey       = process.env.MATON_API_KEY;
  const connectionId = process.env.MATON_CONNECTION_ID;
  const to           = process.env.NOTIFICATION_EMAIL;

  if (!apiKey || !connectionId || !to) {
    logger.warn('Maton email not configured — skipping notification', {
      missing: [
        !apiKey       && 'MATON_API_KEY',
        !connectionId && 'MATON_CONNECTION_ID',
        !to           && 'NOTIFICATION_EMAIL',
      ].filter(Boolean)
    });
    return;
  }

  const rawMessage = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    text,
  ].join('\r\n');

  const encoded = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  try {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Maton-Connection': connectionId,
      },
      body: JSON.stringify({ raw: encoded }),
    });

    const result = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(result));

    logger.info('Campaign draft emailed via Maton', { to, subject, message_id: result.id });
    return result;
  } catch (err) {
    logger.error('Maton email send failed', { error: err.message });
  }
}
