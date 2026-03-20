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
