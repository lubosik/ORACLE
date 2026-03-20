export const COPY_RULES = {
  forbidden_phrases: [
    'just following up',
    'I wanted to reach out',
    'I hope this finds you well',
    'quick question',
    'I work at',
    'we do'
  ],
  forbidden_characters: ['\u2014', '\u2013'],
  email_1_rules: {
    max_words: 90,
    no_links: true,
    cta: 'If yes, I will send over the specifics.',
    subject_rule: 'first name only or company name only'
  },
  email_2_rules: {
    must_include: ['[VOICE RECORDING 1]', '[VOICE RECORDING 2]'],
    reference_inbound_source: true
  },
  email_3_rules: {
    must_reference: ['30,000 calls', '391%'],
    no_bullet_points: true
  },
  email_4_rules: {
    max_words: 60,
    cta: 'Just a yes or no is fine.'
  },
  global_rules: [
    'No em dashes anywhere',
    'No bullet points in emails 1, 2, or 4',
    'Subject lines: lowercase, under 5 words',
    'Paragraphs: 1 to 2 sentences maximum',
    'Tone: peer to peer, never vendor to prospect',
    'Never mention AI or artificial intelligence in subject line or first sentence',
    'CTA is always reply-based'
  ]
};
