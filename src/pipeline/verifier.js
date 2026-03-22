import logger from '../utils/logger.js';
import { supabase } from '../utils/supabase.js';
import { logActivity } from '../utils/activity.js';
import 'dotenv/config';

const MV_API_KEY = process.env.MILLION_VERIFIER_API_KEY;
const MV_BASE_URL = 'https://api.millionverifier.com/api/v3/';

export async function verifyEmail(email) {
  try {
    const url = `${MV_BASE_URL}?api=${MV_API_KEY}&email=${encodeURIComponent(email)}&timeout=10`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`MillionVerifier API error: ${res.status}`);
    }

    const data = await res.json();

    // Only skip if explicitly invalid — catch_all, unknown, risky etc. are all fine to send
    const passed = data.result !== 'invalid';

    await supabase.from('lead_verification').upsert({
      email,
      verification_status: data.result,
      sub_result: data.subresult || null,
      catch_all: data.result === 'catch_all',
      verified_at: new Date().toISOString()
    }, { onConflict: 'email' });

    return {
      email,
      passed,
      status: data.result,
      subresult: data.subresult,
      catch_all: data.result === 'catch_all'
    };

  } catch (err) {
    logger.error('Email verification error', { email, error: err.message });
    // On API error, pass the lead through rather than silently dropping it
    return { email, passed: true, status: 'error', catch_all: false };
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
      logger.debug('Lead failed verification — invalid email', { email: lead.email, subresult: result.subresult });
    }
    // MillionVerifier is fast — 200ms gap is enough
    await new Promise(r => setTimeout(r, 200));
  }

  await logActivity({
    category: 'verification',
    level: 'info',
    message: `Verification complete — ${verified.length} passed, ${failCount} invalid (dropped)`,
    detail: { passed: verified.length, failed: failCount }
  });

  logger.info('Verification complete', { passed: verified.length, failed: failCount });
  return { verified, failCount };
}
