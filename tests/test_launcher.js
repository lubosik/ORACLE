import { CONFIG } from '../src/config.js';
import { BASE_SEQUENCE } from '../src/sequences/base_sequence.js';

// Unit tests for launcher config and sequence validity.
// Full integration tests (createCampaign, bulkAddLeads) require live Instantly credentials.

async function run() {
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
      passed++;
    } catch (e) {
      console.error(`  FAIL: ${name} — ${e.message}`);
      failed++;
    }
  }

  console.log('\nLAUNCHER TESTS\n');

  await test('CONFIG.campaign_schedule has required fields', () => {
    const s = CONFIG.campaign_schedule;
    if (!s.name) throw new Error('campaign_schedule.name missing');
    if (!s.timing?.from) throw new Error('campaign_schedule.timing.from missing');
    if (!s.timing?.to) throw new Error('campaign_schedule.timing.to missing');
    if (!s.timezone) throw new Error('campaign_schedule.timezone missing');
  });

  await test('CONFIG.campaign_settings has stop_on_reply and daily_limit', () => {
    const s = CONFIG.campaign_settings;
    if (typeof s.stop_on_reply !== 'boolean') throw new Error('stop_on_reply must be boolean');
    if (typeof s.daily_limit !== 'number') throw new Error('daily_limit must be number');
  });

  await test('BASE_SEQUENCE has exactly 4 email steps', () => {
    if (!Array.isArray(BASE_SEQUENCE.emails)) throw new Error('BASE_SEQUENCE.emails must be array');
    if (BASE_SEQUENCE.emails.length !== 4) throw new Error(`Expected 4 emails, got ${BASE_SEQUENCE.emails.length}`);
  });

  await test('BASE_SEQUENCE email steps have correct delays', () => {
    const delays = BASE_SEQUENCE.emails.map(e => e.delay_days);
    if (delays[0] !== 0) throw new Error(`Email 1 delay should be 0, got ${delays[0]}`);
    if (delays[1] !== 3) throw new Error(`Email 2 delay should be 3, got ${delays[1]}`);
    if (delays[2] !== 4) throw new Error(`Email 3 delay should be 4, got ${delays[2]}`);
    if (delays[3] !== 6) throw new Error(`Email 4 delay should be 6, got ${delays[3]}`);
  });

  await test('BASE_SEQUENCE email 2 contains voice recording placeholders', () => {
    const body = BASE_SEQUENCE.emails[1].body;
    if (!body.includes('[VOICE RECORDING 1]')) throw new Error('[VOICE RECORDING 1] missing from email 2');
    if (!body.includes('[VOICE RECORDING 2]')) throw new Error('[VOICE RECORDING 2] missing from email 2');
  });

  await test('BASE_SEQUENCE contains no em dashes', () => {
    const allText = BASE_SEQUENCE.emails.map(e => e.subject + ' ' + e.body).join('\n');
    if (allText.includes('\u2014')) throw new Error('Em dash found in BASE_SEQUENCE');
    if (allText.includes('\u2013')) throw new Error('En dash found in BASE_SEQUENCE');
  });

  await test('BASE_SEQUENCE email 1 subject is just {{firstName}}', () => {
    if (BASE_SEQUENCE.emails[0].subject !== '{{firstName}}') {
      throw new Error(`Expected '{{firstName}}', got '${BASE_SEQUENCE.emails[0].subject}'`);
    }
  });

  await test('INSTANTLY_API_KEY env var is set', () => {
    if (!process.env.INSTANTLY_API_KEY) throw new Error('INSTANTLY_API_KEY env var not set');
  });

  await test('campaign name format is correct', () => {
    const variantId = 'v1_baseline';
    const dateStr = new Date().toISOString().split('T')[0];
    const name = `ORACLE_AIRO_RE_${variantId}_${dateStr}`;
    if (!name.startsWith('ORACLE_AIRO_RE_')) throw new Error('Campaign name format incorrect');
    if (!name.includes(variantId)) throw new Error('variant_id missing from campaign name');
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error('Test runner error:', e); process.exit(1); });
