import { generateCopy } from '../src/pipeline/copywriter.js';
import { COPY_RULES } from '../src/assets/copy_rules.js';

const MOCK_LEAD = {
  email: 'copy_test_' + Date.now() + '@oracle-test.com',
  firstName: 'Sarah',
  lastName: 'Chen',
  companyName: 'Foxtons',
  title: 'Head of Sales',
  enrichment: {
    inbound_source: 'Rightmove and Zoopla listings',
    funnel_summary: 'Foxtons generates inbound property enquiries from major portals and routes them to sales negotiators.',
    personalisation_hook: 'Noticed Foxtons is running strong on Rightmove right now.'
  }
};

const EM_DASH = '\u2014';
const EN_DASH = '\u2013';

async function run() {
  let passed = 0;
  let failed = 0;
  let generatedCopy = null;

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

  console.log('\nCOPYWRITER TESTS\n');

  await test('generateCopy returns object with all 8 fields', async () => {
    generatedCopy = await generateCopy(MOCK_LEAD, 'v_test_baseline');
    const required = ['email_1_subject','email_1_body','email_2_subject','email_2_body',
      'email_3_subject','email_3_body','email_4_subject','email_4_body'];
    for (const field of required) {
      if (!generatedCopy[field]) throw new Error(`Missing field: ${field}`);
    }
  });

  if (generatedCopy) {
    await test('no em dashes in any generated copy', async () => {
      const allText = Object.values(generatedCopy).join(' ');
      if (allText.includes(EM_DASH)) throw new Error('Em dash found in generated copy');
      if (allText.includes(EN_DASH)) throw new Error('En dash found in generated copy');
    });

    await test('email_1_subject is short (under 5 words)', async () => {
      const words = generatedCopy.email_1_subject.trim().split(/\s+/).length;
      if (words > 5) throw new Error(`Email 1 subject has ${words} words, expected <= 5`);
    });

    await test('email_2_body contains voice recording placeholders', async () => {
      if (!generatedCopy.email_2_body.includes('[VOICE RECORDING 1]')) {
        throw new Error('email_2_body missing [VOICE RECORDING 1]');
      }
      if (!generatedCopy.email_2_body.includes('[VOICE RECORDING 2]')) {
        throw new Error('email_2_body missing [VOICE RECORDING 2]');
      }
    });

    await test('no forbidden phrases in any email', async () => {
      const allText = Object.values(generatedCopy).join('\n').toLowerCase();
      for (const phrase of COPY_RULES.forbidden_phrases) {
        if (allText.includes(phrase.toLowerCase())) {
          throw new Error(`Forbidden phrase found: "${phrase}"`);
        }
      }
    });

    await test('email_4_body is under 80 words (strict closing email)', async () => {
      const words = generatedCopy.email_4_body.trim().split(/\s+/).length;
      if (words > 80) throw new Error(`Email 4 has ${words} words, expected <= 80`);
    });

    await test('subject lines are lowercase', async () => {
      const subjects = [
        generatedCopy.email_2_subject,
        generatedCopy.email_3_subject,
        generatedCopy.email_4_subject
      ];
      for (const s of subjects) {
        if (s !== s.toLowerCase()) throw new Error(`Subject line not lowercase: "${s}"`);
      }
    });
  }

  await test('COPY_RULES has correct forbidden phrases', () => {
    if (!Array.isArray(COPY_RULES.forbidden_phrases)) throw new Error('forbidden_phrases must be array');
    if (!COPY_RULES.forbidden_phrases.includes('just following up')) throw new Error('"just following up" missing from forbidden phrases');
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error('Test runner error:', e); process.exit(1); });
