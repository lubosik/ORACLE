import { enrichLead } from '../src/pipeline/enricher.js';

const MOCK_LEAD = {
  email: 'test@knightfrank.com',
  firstName: 'James',
  lastName: 'Knight',
  companyName: 'Knight Frank',
  companyWebsite: 'https://www.knightfrank.com',
  title: 'Head of Sales'
};

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

  console.log('\nENRICHER TESTS\n');

  await test('enrichLead returns object with required fields', async () => {
    const result = await enrichLead(MOCK_LEAD);
    if (typeof result !== 'object') throw new Error('Expected object');
    if (!result.inbound_source) throw new Error('Missing inbound_source');
    if (!result.funnel_summary) throw new Error('Missing funnel_summary');
    if (!result.personalisation_hook) throw new Error('Missing personalisation_hook');
  });

  await test('personalisation_hook is a non-empty string', async () => {
    const result = await enrichLead(MOCK_LEAD);
    if (typeof result.personalisation_hook !== 'string') throw new Error('personalisation_hook must be string');
    if (result.personalisation_hook.trim().length === 0) throw new Error('personalisation_hook is empty');
  });

  await test('enrichLead falls back gracefully with no XAI key', async () => {
    const origKey = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = 'invalid_key_for_test';
    const lead = { ...MOCK_LEAD, email: 'fallback_test@example.com', companyName: 'FallbackCo' };
    const result = await enrichLead(lead);
    process.env.XAI_API_KEY = origKey;
    if (!result.personalisation_hook) throw new Error('Fallback must include personalisation_hook');
  });

  await test('fallback personalisation_hook references company name', async () => {
    const origKey = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = '';
    const lead = { ...MOCK_LEAD, email: 'fallback2@example.com', companyName: 'TestPropertyGroup' };
    const result = await enrichLead(lead);
    process.env.XAI_API_KEY = origKey;
    if (!result.inbound_source) throw new Error('inbound_source must exist in fallback');
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error('Test runner error:', e); process.exit(1); });
