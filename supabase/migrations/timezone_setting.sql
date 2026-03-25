-- Add campaign_timezone to system_settings
-- Run this in the Supabase SQL editor

INSERT INTO system_settings (key, value)
VALUES ('campaign_timezone', 'Europe/London')
ON CONFLICT (key) DO NOTHING;
