import 'server-only';
import { admin } from '@/lib/supabase/admin';

// Client IP on Vercel = first entry of x-forwarded-for. Indian mobile networks
// and salon Wi-Fi share IPs, so IP limits stay generous; phone limits do the work.
export function clientIp(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
}

// true = allowed. Race-safe counter in Postgres (check_rate).
export async function allow(key, max, windowSeconds) {
  const { data, error } = await admin.rpc('check_rate', { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  if (error) throw error;
  return data === true;
}
