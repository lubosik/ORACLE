import { scrapeLeads } from '../src/pipeline/scraper.js';
import { CONFIG } from '../src/config.js';

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

  console.log('\nSCRAPER TESTS\n');

  await test('CONFIG has real_estate vertical defined', () => {
    if (!CONFIG.verticals.real_estate) throw new Error('real_estate vertical missing from CONFIG');
    if (!CONFIG.verticals.real_estate.apify_input) throw new Error('apify_input missing');
  });

  await test('CONFIG apify_input has required fields', () => {
    const inp = CONFIG.verticals.real_estate.apify_input;
    if (!Array.isArray(inp.personTitle)) throw new Error('personTitle must be array');
    if (!Array.isArray(inp.industry)) throw new Error('industry must be array');
    if (!inp.contactEmailStatus) throw new Error('contactEmailStatus missing');
  });

  await test('daily_lead_limit is a positive number', () => {
    if (typeof CONFIG.daily_lead_limit !== 'number') throw new Error('daily_lead_limit must be number');
    if (CONFIG.daily_lead_limit <= 0) throw new Error('daily_lead_limit must be > 0');
  });

  await test('scrapeLeads throws for unknown vertical', async () => {
    let threw = false;
    try {
      await scrapeLeads('unknown_vertical_xyz');
    } catch(e) {
      threw = true;
    }
    if (!threw) throw new Error('Expected scrapeLeads to throw for unknown vertical');
  });

  await test('APIFY_ACTOR_ID env var is set', () => {
    if (!process.env.APIFY_ACTOR_ID) throw new Error('APIFY_ACTOR_ID env var not set');
  });

  console.log('\nNote: Full scrape test skipped (requires Apify credits)');
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error('Test runner error:', e); process.exit(1); });
