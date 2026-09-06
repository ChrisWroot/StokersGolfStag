import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Missing env vars must not throw at module-import time: that happens before
// React ever calls render(), so the page would go silently blank with no
// on-screen message. Instead, surface it as a normal app error state.
export const configError =
  !url || !key
    ? 'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Add them in your host\'s project settings (see .env.example), then redeploy.'
    : null;

export const supabase = configError ? null : createClient(url, key);
