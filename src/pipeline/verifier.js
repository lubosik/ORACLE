import logger from '../utils/logger.js';
import { supabase } from '../utils/supabase.js';
import 'dotenv/config';

const BASE_URL = process.env.INSTANTLY_BASE_URL || 'https://api.instantly.ai/api/v2';

async function pollVerification(email, maxAttempts = 3) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const res = await fetch(`${BASE_URL}/email-verification/${encodeURIComponent(email)}`, {
        headers: { 'Authorization': `Bearer ${process.env.INSTANTLY_API_KEY}` }
      });
      const data = await res.json();
      if (data.verification_status !== 'pending') return data;
    } catch (err) {
      logger.warn('Poll verification error', { email, attempt: i + 1, error: err.message });
    }
  }
  return null;
}

export async function verifyEmail(email) {
  try {
    const res = await fetch(`${BASE_URL}/email-verification`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.INSTANTLY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email })
    });

    if (!res.ok) {
      throw new Error(`Verification API error: ${res.status}`);
    }

    let result = await res.json();

    if (result.verification_status === 'pending') {
      result = await pollVerification(email) || result;
    }

    const passed = result.verification_status === 'verified' ||
                   (result.verification_status === 'valid');

    const failed = result.verification_status === 'invalid' ||
                   result.verification_status === 'error' ||
                   result.verification_status === 'pending';

    await supabase.from('lead_verification').upsert({
      email,
      verification_status: result.verification_status,
      catch_all: result.catch_all === true,
      verified_at: new Date().toISOString()
    }, { onConflict: 'email' });

    return {
      email,
      passed: passed && !failed,
      status: result.verification_status,
      catch_all: result.catch_all
    };

  } catch (err) {
    logger.error('Email verification error', { email, error: err.message });
    return { email, passed: false, status: 'error', catch_all: false };
  }
}

export async function verifyLeads(leads) {
  const verified = [];
  let failCount = 0;

  for (const lead of leads) {
    const result = await verifyEmail(lead.email);
    if (result.passed) {
      verified.push(lead);
    } else {
      failCount++;
      logger.debug('Lead failed verification', { email: lead.email, status: result.status });
    }
    await new Promise(r => setTimeout(r, 200));
  }

  logger.info('Verification complete', { passed: verified.length, failed: failCount });
  return { verified, failCount };
}
