-- Run in Supabase SQL editor

-- 1. Add schedule defaults to system_settings
INSERT INTO system_settings (key, value) VALUES
  ('send_time_from',   '08:00'),
  ('send_time_to',     '17:30'),
  ('send_days',        '1,2,3,4,5'),
  ('send_timezone',    'Europe/London'),
  ('send_daily_limit', '50'),
  ('timing_insights',  'null')
ON CONFLICT (key) DO NOTHING;

-- 2. Extend experiment_ledger for schedule and change_type tracking
ALTER TABLE experiment_ledger ADD COLUMN IF NOT EXISTS change_type TEXT;
ALTER TABLE experiment_ledger ADD COLUMN IF NOT EXISTS schedule_snapshot JSONB;
