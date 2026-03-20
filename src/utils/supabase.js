import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key';

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  {
    db: { schema: 'public' },
    auth: { persistSession: false },
    global: {
      headers: { 'x-oracle-service': 'oracle-railway' }
    }
  }
);
