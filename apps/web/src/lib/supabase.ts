import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set in apps/web/.env',
  );
}

/**
 * The browser's Supabase client.
 *
 * The publishable key is designed to be public and grants nothing on its own —
 * it identifies the project, and the signed-in session is what carries
 * authority. Every permission decision still happens in the Probild API.
 *
 * `supabase-js` owns the session: it restores one on load and refreshes the
 * access token before it expires, which is why there is no refresh logic left
 * in `api.ts`.
 */
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
