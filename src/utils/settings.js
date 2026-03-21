import { supabase } from './supabase.js';

let settingsCache = {};
let cacheExpiry = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

export async function getSetting(key, fallback = null) {
  if (Date.now() > cacheExpiry) {
    const { data } = await supabase.from('system_settings').select('key, value');
    if (data) {
      // Last-write-wins deduplication in case of any legacy duplicate rows
      settingsCache = {};
      for (const r of data) settingsCache[r.key] = r.value;
      cacheExpiry = Date.now() + CACHE_TTL_MS;
    }
  }
  return settingsCache[key] ?? fallback;
}

export async function setSetting(key, value) {
  const strVal = String(value);

  // Check if row already exists
  const { data: existing, error: selectErr } = await supabase
    .from('system_settings')
    .select('key')
    .eq('key', key)
    .maybeSingle();

  if (selectErr) throw new Error(`setSetting select failed: ${selectErr.message}`);

  if (existing) {
    const { error } = await supabase
      .from('system_settings')
      .update({ value: strVal })
      .eq('key', key);
    if (error) throw new Error(`setSetting update failed: ${error.message}`);
  } else {
    const { error } = await supabase
      .from('system_settings')
      .insert({ key, value: strVal });
    if (error) throw new Error(`setSetting insert failed: ${error.message}`);
  }

  // Always update cache immediately
  settingsCache[key] = strVal;
  cacheExpiry = 0; // Force fresh read on next getSetting call
}

// ORACLE is always enabled when deployed — Telegram approval is the real gate.
// Individual cron tasks still check this so we can add a pause mechanism later.
export async function isOracleEnabled() {
  return true;
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
