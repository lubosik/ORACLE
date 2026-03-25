-- Migration: reply_sentiment table
-- Stores Kimi K2.5 classifications of inbound replies per campaign.
-- Used by the weekly experiment loop to feed sentiment context into hypothesis generation.

CREATE TABLE IF NOT EXISTS reply_sentiment (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  lead_email TEXT NOT NULL,
  reply_snippet TEXT,
  sentiment TEXT CHECK (sentiment IN ('interested', 'objection_timing', 'objection_relevance', 'objection_trust', 'unsubscribe', 'auto_reply')) NOT NULL,
  key_phrase TEXT,
  email_step INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reply_sentiment_campaign ON reply_sentiment (campaign_id);
CREATE INDEX IF NOT EXISTS idx_reply_sentiment_created ON reply_sentiment (created_at);
CREATE INDEX IF NOT EXISTS idx_reply_sentiment_sentiment ON reply_sentiment (sentiment);

-- Prevent re-classifying the same reply
CREATE UNIQUE INDEX IF NOT EXISTS idx_reply_sentiment_unique ON reply_sentiment (campaign_id, lead_email);
