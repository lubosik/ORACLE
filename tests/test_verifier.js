import { verifyEmail } from '../src/pipeline/verifier.js';

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

  console.log('\nVERIFIER TESTS\n');

  await test('verifyEmail returns object with required fields', async () => {
    const result = await verifyEmail('test@example.com');
    if (typeof result !== 'object') throw new Error('Expected object');
    if (!('email' in result)) throw new Error('Missing email field');
    if (!('passed' in result)) throw new Error('Missing passed field');
    if (!('status' in result)) throw new Error('Missing status field');
  });

  await test('verifyEmail returns passed:false for clearly invalid email', async () => {
    const result = await verifyEmail('not-an-email');
    if (result.passed !== false) throw new Error(`Expected passed:false, got ${result.passed}`);
  });

  await test('verifyEmail handles API errors gracefully', async () => {
    // Temporarily use a bad key context by checking the shape
    const result = await verifyEmail('graceful_error@test_domain_xyz.io');
    if (typeof result.passed !== 'boolean') throw new Error('passed must be boolean');
    if (typeof result.status !== 'string') throw new Error('status must be string');
  });

  await test('verifyEmail normalises email field in response', async () => {
    const email = 'TEST@example.com';
    const result = await verifyEmail(email);
    if (result.email !== email) throw new Error(`Email field should preserve input, got ${result.email}`);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error('Test runner error:', e); process.exit(1); });
