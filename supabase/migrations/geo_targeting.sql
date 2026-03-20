-- ORACLE Geo Targeting migration
-- Run in Supabase SQL editor

-- Add geo_context column to campaign_drafts
ALTER TABLE campaign_drafts
  ADD COLUMN IF NOT EXISTS geo_context JSONB;

-- Seed the active_geo_group setting (starts with UK)
INSERT INTO system_settings (key, value)
VALUES ('active_geo_group', 'uk')
ON CONFLICT (key) DO NOTHING;
