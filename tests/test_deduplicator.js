import { isDuplicate, filterNewLeads, upsertSeenLead, markLeadCampaigned } from '../src/pipeline/deduplicator.js';
import { supabase } from '../src/utils/supabase.js';

const TEST_EMAIL = `dedup_test_${Date.now()}@oracle-test.com`;

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

  console.log('\nDEDUPLICATOR TESTS\n');

  await test('isDuplicate returns false for unknown email', async () => {
    const result = await isDuplicate('never_seen_' + Date.now() + '@test.com');
    if (result !== false) throw new Error(`Expected false, got ${result}`);
  });

  await test('upsertSeenLead inserts a new lead', async () => {
    await upsertSeenLead({
      email: TEST_EMAIL,
      firstName: 'Test',
      lastName: 'Lead',
      companyName: 'Oracle Test Co',
      companyWebsite: 'https://oracle-test.com',
      linkedinUrl: '',
      title: 'CEO',
      country: 'United Kingdom'
    });
    const { data } = await supabase.from('seen_leads').select('email').eq('email', TEST_EMAIL).single();
    if (!data) throw new Error('Lead not found after upsert');
  });

  await test('isDuplicate returns false for lead not yet campaigned', async () => {
    const result = await isDuplicate(TEST_EMAIL);
    if (result !== false) throw new Error(`Expected false (no campaign date), got ${result}`);
  });

  await test('markLeadCampaigned sets last_campaigned_at', async () => {
    await markLeadCampaigned(TEST_EMAIL, 'test_campaign_001');
    const { data } = await supabase.from('seen_leads').select('last_campaigned_at').eq('email', TEST_EMAIL).single();
    if (!data?.last_campaigned_at) throw new Error('last_campaigned_at not set');
  });

  await test('isDuplicate returns true for recently campaigned lead', async () => {
    const result = await isDuplicate(TEST_EMAIL);
    if (result !== true) throw new Error(`Expected true (within cooldown), got ${result}`);
  });

  await test('filterNewLeads correctly partitions leads', async () => {
    const leads = [
      { email: TEST_EMAIL, firstName: 'Test', lastName: 'Lead', companyName: 'Oracle Test' },
      { email: 'fresh_' + Date.now() + '@oracle-test.com', firstName: 'Fresh', lastName: 'Lead', companyName: 'New Co' },
      { email: '' }
    ];
    const result = await filterNewLeads(leads);
    if (result.passed.length !== 1) throw new Error(`Expected 1 passed, got ${result.passed.length}`);
    if (result.skipped !== 2) throw new Error(`Expected 2 skipped, got ${result.skipped}`);
  });

  // Cleanup
  await supabase.from('seen_leads').delete().eq('email', TEST_EMAIL);

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error('Test runner error:', e); process.exit(1); });
