-- Run this in Supabase SQL editor
-- Campaign asset library

CREATE TABLE IF NOT EXISTS campaign_assets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('voice_recording', 'vsl', 'calendar', 'document', 'other')),
  url TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  use_in_email_2 BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO campaign_assets (name, category, url, description, is_active, use_in_email_2, sort_order) VALUES
  ('AIRO VSL', 'vsl', 'https://airo.velto.ai/', 'Main AIRO explainer video — send when leads want to understand the product', true, false, 1),
  ('Discovery Call Booking', 'calendar', 'https://calendly.com/veltoai/airo-discovery-call', 'Calendly link — send when lead is ready to book', true, false, 2),
  ('Wire Transfer Recording', 'voice_recording', 'https://airo.velto.ai/audio/wire-transfer.mp3', 'Live call: wire transfer enquiry handled by AIRO with no human on the line', true, true, 3),
  ('Not AI Recording', 'voice_recording', 'https://airo.velto.ai/audio/not-ai.mp3', 'Live call: prospect questions whether the agent is AI — handled seamlessly', true, true, 4)
ON CONFLICT DO NOTHING;
