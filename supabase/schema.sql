-- Global lead deduplication with 30-day cooldown
CREATE TABLE IF NOT EXISTS seen_leads (
  email TEXT PRIMARY KEY,
  company_name TEXT,
  first_name TEXT,
  last_name TEXT,
  title TEXT,
  website TEXT,
  linkedin_url TEXT,
  country TEXT,
  source TEXT DEFAULT 'apify',
  campaign_id TEXT,
  last_campaigned_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ DEFAULT NOW()
);

-- Grok enrichment output
CREATE TABLE IF NOT EXISTS lead_enrichment (
  email TEXT PRIMARY KEY REFERENCES seen_leads(email),
  inbound_source TEXT,
  funnel_summary TEXT,
  personalisation_hook TEXT,
  enriched_at TIMESTAMPTZ DEFAULT NOW()
);

-- Instantly verification result
CREATE TABLE IF NOT EXISTS lead_verification (
  email TEXT PRIMARY KEY REFERENCES seen_leads(email),
  verification_status TEXT,
  catch_all BOOLEAN,
  verified_at TIMESTAMPTZ DEFAULT NOW()
);

-- Claude-generated personalised copy
CREATE TABLE IF NOT EXISTS lead_copy (
  email TEXT PRIMARY KEY REFERENCES seen_leads(email),
  email_1_subject TEXT,
  email_1_body TEXT,
  email_2_subject TEXT,
  email_2_body TEXT,
  email_3_subject TEXT,
  email_3_body TEXT,
  email_4_subject TEXT,
  email_4_body TEXT,
  variant_id TEXT,
  campaign_id TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Karpathy experiment results ledger
CREATE TABLE IF NOT EXISTS experiment_ledger (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  variant_id TEXT NOT NULL,
  campaign_id TEXT,
  hypothesis TEXT,
  what_changed TEXT,
  launched_at TIMESTAMPTZ,
  scored_at TIMESTAMPTZ,
  sends INTEGER DEFAULT 0,
  positive_replies INTEGER DEFAULT 0,
  positive_reply_rate DECIMAL(5,4),
  open_rate DECIMAL(5,4),
  baseline_rate DECIMAL(5,4),
  delta DECIMAL(5,4),
  outcome TEXT CHECK (outcome IN ('winner', 'loser', 'inconclusive', 'pending')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Current baselines per vertical
CREATE TABLE IF NOT EXISTS baselines (
  vertical TEXT PRIMARY KEY,
  variant_id TEXT,
  positive_reply_rate DECIMAL(5,4),
  sequence_snapshot JSONB,
  promoted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily campaign stats cache
CREATE TABLE IF NOT EXISTS campaign_daily_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  date DATE DEFAULT CURRENT_DATE,
  emails_sent INTEGER DEFAULT 0,
  replies_unique INTEGER DEFAULT 0,
  auto_replies_unique INTEGER DEFAULT 0,
  opens_unique INTEGER DEFAULT 0,
  bounced INTEGER DEFAULT 0,
  positive_reply_rate DECIMAL(5,4),
  open_rate DECIMAL(5,4),
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, date)
);

-- Pipeline run log
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_date DATE DEFAULT CURRENT_DATE,
  scraped_count INTEGER DEFAULT 0,
  dedupe_skipped INTEGER DEFAULT 0,
  no_email_skipped INTEGER DEFAULT 0,
  enriched_count INTEGER DEFAULT 0,
  verified_count INTEGER DEFAULT 0,
  verification_failed INTEGER DEFAULT 0,
  copy_generated_count INTEGER DEFAULT 0,
  added_to_campaign INTEGER DEFAULT 0,
  campaign_id TEXT,
  variant_id TEXT,
  duration_ms INTEGER,
  status TEXT DEFAULT 'running',
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Telegram reply action log
CREATE TABLE IF NOT EXISTS reply_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_email TEXT,
  company_name TEXT,
  campaign_id TEXT,
  instantly_thread_id TEXT,
  reply_to_uuid TEXT,
  inbound_message TEXT,
  oracle_draft TEXT,
  final_reply TEXT,
  action TEXT CHECK (action IN ('approved', 'edited', 'skipped', 'pending')),
  telegram_message_id TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_seen_leads_campaigned ON seen_leads(last_campaigned_at);
CREATE INDEX IF NOT EXISTS idx_experiment_ledger_outcome ON experiment_ledger(outcome);
CREATE INDEX IF NOT EXISTS idx_campaign_stats_campaign ON campaign_daily_stats(campaign_id);
CREATE INDEX IF NOT EXISTS idx_reply_log_status ON reply_log(action);
