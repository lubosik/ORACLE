export const CONFIG = {
  verticals: {
    real_estate: {
      name: 'Real Estate',
      product: 'AIRO',
      apify_input: {
        personTitle: [
          'Head of Sales', 'Sales Director', 'Managing Director',
          'CEO', 'Founder', 'Co-Founder', 'Director',
          'Head of Lettings', 'Sales Manager', 'Property Director',
          'Managing Partner', 'President', 'Owner'
        ],
        industry: ['Real Estate'],
        companyEmployeeSize: ['2 - 10', '11 - 50', '51 - 200', '201 - 500'],
        personCountry: ['United Kingdom', 'United States'],
        contactEmailStatus: 'verified',
        includeEmails: true
      },
      icp_description: 'Property sales teams with inbound lead volume'
    }
  },
  active_vertical: 'real_estate',
  daily_lead_limit: parseInt(process.env.DAILY_LEAD_LIMIT) || 200,
  experiment_window_days: parseInt(process.env.EXPERIMENT_WINDOW_DAYS) || 7,
  min_sends_to_score: parseInt(process.env.MIN_SENDS_TO_SCORE) || 150,
  winner_threshold_pp: parseFloat(process.env.WINNER_THRESHOLD_PP) || 0.005,
  dedup_cooldown_days: 30,
  instantly_base_url: process.env.INSTANTLY_BASE_URL || 'https://api.instantly.ai/api/v2',
  campaign_schedule: {
    name: 'UK Business Hours',
    timing: { from: '08:00', to: '17:30' },
    days: { '1': true, '2': true, '3': true, '4': true, '5': true, '6': false, '0': false },
    timezone: 'Europe/London'
  },
  campaign_settings: {
    daily_limit: 50,
    stop_on_reply: true,
    email_gap: 300,
    random_wait_max: 120,
    text_only: true,
    first_email_text_only: true,
    link_tracking: false,
    open_tracking: true,
    stop_for_company: true
  }
};
