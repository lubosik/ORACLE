-- ============================================================
-- ORACLE Karpathy Full Intelligence Layer
-- Run this in Supabase SQL editor
-- ============================================================

-- ICP performance: per (title, country, size) reply rates
CREATE TABLE IF NOT EXISTS icp_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  country TEXT NOT NULL,
  company_size_bucket TEXT NOT NULL,
  emails_sent INTEGER DEFAULT 0,
  positive_replies INTEGER DEFAULT 0,
  reply_rate NUMERIC(8,6) DEFAULT 0,
  last_computed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (title, country, company_size_bucket)
);

-- Step attribution: which email step (1-4) generates replies
CREATE TABLE IF NOT EXISTS step_attribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id TEXT,
  variant_id TEXT,
  step_1_replies INTEGER DEFAULT 0,
  step_2_replies INTEGER DEFAULT 0,
  step_3_replies INTEGER DEFAULT 0,
  step_4_replies INTEGER DEFAULT 0,
  total_replies INTEGER DEFAULT 0,
  computed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reply insights: AI-clustered analysis of what drives positive replies
CREATE TABLE IF NOT EXISTS reply_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_date DATE DEFAULT CURRENT_DATE,
  total_replies_analyzed INTEGER DEFAULT 0,
  intent_breakdown JSONB,
  top_objections JSONB,
  top_interests JSONB,
  winning_angles JSONB,
  claude_summary TEXT,
  raw_clusters JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Winner synthesis: meta-analysis after N winners
CREATE TABLE IF NOT EXISTS winner_synthesis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  synthesized_at TIMESTAMPTZ DEFAULT NOW(),
  winners_used JSONB,
  synthesis TEXT,
  new_baseline_elements JSONB,
  applied_to_sequence BOOLEAN DEFAULT FALSE
);

-- Program evolution log: history of program.md rewrites
CREATE TABLE IF NOT EXISTS program_evolution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evolved_at TIMESTAMPTZ DEFAULT NOW(),
  old_program TEXT,
  new_program TEXT,
  rationale TEXT,
  performance_context JSONB
);

-- Deliverability log: open rate anomaly tracking per campaign per day
CREATE TABLE IF NOT EXISTS deliverability_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  date DATE DEFAULT CURRENT_DATE,
  open_rate NUMERIC(8,6),
  seven_day_avg_open_rate NUMERIC(8,6),
  anomaly_detected BOOLEAN DEFAULT FALSE,
  anomaly_type TEXT,
  alert_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (campaign_id, date)
);

-- Cohort insights: company profile → reply rate mapping
CREATE TABLE IF NOT EXISTS cohort_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_key TEXT UNIQUE NOT NULL,
  title TEXT,
  country TEXT,
  company_size_bucket TEXT,
  emails_sent INTEGER DEFAULT 0,
  positive_replies INTEGER DEFAULT 0,
  reply_rate NUMERIC(8,6) DEFAULT 0,
  sample_size INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Multi-armed bandit state: Thompson sampling per variant
CREATE TABLE IF NOT EXISTS bandit_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id TEXT UNIQUE NOT NULL,
  alpha NUMERIC DEFAULT 1,
  beta NUMERIC DEFAULT 1,
  total_trials INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Verticals: proposed and active expansion targets
CREATE TABLE IF NOT EXISTS verticals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  icp_description TEXT,
  apify_input JSONB,
  status TEXT DEFAULT 'proposed',
  proposed_rationale TEXT,
  test_results JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed active real_estate vertical
INSERT INTO verticals (name, description, icp_description, status)
VALUES ('real_estate', 'Real estate and property management teams', 'Property sales teams with high inbound lead volume', 'active')
ON CONFLICT (name) DO NOTHING;

-- Add new columns to existing tables
ALTER TABLE seen_leads
  ADD COLUMN IF NOT EXISTS company_size_bucket TEXT,
  ADD COLUMN IF NOT EXISTS employee_count INTEGER;

ALTER TABLE reply_log
  ADD COLUMN IF NOT EXISTS reply_intent TEXT,
  ADD COLUMN IF NOT EXISTS reply_sentiment TEXT;

ALTER TABLE experiment_ledger
  ADD COLUMN IF NOT EXISTS icp_snapshot JSONB;

-- Index for performance queries
CREATE INDEX IF NOT EXISTS idx_reply_log_intent ON reply_log(reply_intent);
CREATE INDEX IF NOT EXISTS idx_reply_log_email_step ON reply_log(email_step);
CREATE INDEX IF NOT EXISTS idx_seen_leads_size_bucket ON seen_leads(company_size_bucket);
CREATE INDEX IF NOT EXISTS idx_cohort_insights_reply_rate ON cohort_insights(reply_rate DESC);
CREATE INDEX IF NOT EXISTS idx_deliverability_log_date ON deliverability_log(campaign_id, date);
