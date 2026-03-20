import { supabase } from './supabase.js';

let settingsCache = {};
let cacheExpiry = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

export async function getSetting(key, fallback = null) {
  if (Date.now() > cacheExpiry) {
    const { data } = await supabase.from('system_settings').select('key, value');
    if (data) {
      settingsCache = Object.fromEntries(data.map(r => [r.key, r.value]));
      cacheExpiry = Date.now() + CACHE_TTL_MS;
    }
  }
  return settingsCache[key] ?? fallback;
}

export async function setSetting(key, value) {
  await supabase
    .from('system_settings')
    .upsert({ key, value: String(value), updated_at: new Date().toISOString() });
  settingsCache[key] = String(value);
}

export async function isOracleEnabled() {
  return (await getSetting('oracle_enabled', 'false')) === 'true';
}

// Returns the full campaign schedule object for use in Instantly campaign creation
export async function getSchedule() {
  const timeFrom   = await getSetting('send_time_from',   '08:00');
  const timeTo     = await getSetting('send_time_to',     '17:30');
  const daysStr    = await getSetting('send_days',        '1,2,3,4,5');
  const timezone   = await getSetting('send_timezone',    'Europe/London');
  const dailyLimit = parseInt(await getSetting('send_daily_limit', '50'));

  const days = daysStr.split(',').map(d => d.trim());
  const daysObj = {};
  for (const d of ['0','1','2','3','4','5','6']) {
    daysObj[d] = days.includes(d);
  }

  return { timeFrom, timeTo, days, daysObj, timezone, dailyLimit };
}
