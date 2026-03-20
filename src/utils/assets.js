import { supabase } from './supabase.js';

let assetsCache = null;
let assetsCacheExpiry = 0;
const CACHE_TTL_MS = 60_000;

export function invalidateAssetsCache() {
  assetsCache = null;
  assetsCacheExpiry = 0;
}

export async function getAssets() {
  if (Date.now() < assetsCacheExpiry && assetsCache) return assetsCache;
  const { data } = await supabase
    .from('campaign_assets')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');
  assetsCache = data || [];
  assetsCacheExpiry = Date.now() + CACHE_TTL_MS;
  return assetsCache;
}

export async function getVoiceRecordings() {
  const assets = await getAssets();
  return assets.filter(a => a.category === 'voice_recording');
}

export async function getEmail2Assets() {
  const assets = await getAssets();
  return assets.filter(a => a.use_in_email_2 && a.is_active);
}

export async function getAssetsByCategory(category) {
  const assets = await getAssets();
  return assets.filter(a => a.category === category);
}

// Build a formatted asset library string for Claude system prompts
export async function buildAssetLibraryPrompt() {
  const assets = await getAssets();

  const byCategory = {};
  for (const a of assets) {
    if (!byCategory[a.category]) byCategory[a.category] = [];
    byCategory[a.category].push(a);
  }

  const lines = ['ORACLE ASSET LIBRARY (use these URLs exactly — never fabricate URLs):'];

  if (byCategory.vsl) {
    lines.push('VSL / Product explainer:');
    for (const a of byCategory.vsl) lines.push(`  - ${a.name}: ${a.url}${a.description ? ` (${a.description})` : ''}`);
  }
  if (byCategory.calendar) {
    lines.push('Calendar / Booking:');
    for (const a of byCategory.calendar) lines.push(`  - ${a.name}: ${a.url}${a.description ? ` (${a.description})` : ''}`);
  }
  if (byCategory.voice_recording) {
    lines.push('Voice recordings (real live calls handled by AIRO — use as inline links in Email 2):');
    for (const a of byCategory.voice_recording) lines.push(`  - ${a.name}: ${a.url}${a.description ? ` (${a.description})` : ''}`);
  }
  if (byCategory.document) {
    lines.push('Documents:');
    for (const a of byCategory.document) lines.push(`  - ${a.name}: ${a.url}`);
  }
  if (byCategory.other) {
    lines.push('Other:');
    for (const a of byCategory.other) lines.push(`  - ${a.name}: ${a.url}`);
  }

  return lines.join('\n');
}
