import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Service-role client: bypasses RLS and can call the server-only SQL functions.
// Only API routes and public pages use it, and they validate their own input.
// `server-only` makes the build fail if a client component ever imports this.
export const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
