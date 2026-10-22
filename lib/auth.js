import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { done } from '@/lib/actions';

export const SALON_COOKIE = 'sanwaro_salon';

// The signed-in user, verified with Supabase Auth. Redirects to /login if missing.
export async function requireUser() {
  // Session checks use the clock (token expiry), so they must run per request,
  // never during prerendering. Callers sit inside a <Suspense> boundary.
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  return { supabase, user: data.user };
}

// The salon the owner is working on (an owner can have up to 3).
// Every Server Action calls this again: authorization never trusts the form.
export async function requireSalon() {
  const { supabase, user } = await requireUser();
  const { data: rows, error } = await supabase
    .from('memberships')
    .select('role, business:businesses(*)')
    .eq('user_id', user.id)
    .order('created_at');
  if (error) throw error;
  if (!rows.length) redirect('/onboarding');

  const chosen = (await cookies()).get(SALON_COOKIE)?.value;
  const current = rows.find((r) => r.business.id === chosen) ?? rows[0];
  return {
    supabase,
    user,
    salon: current.business,
    role: current.role,
    salons: rows.map((r) => r.business),
  };
}

// Server Actions that change data. The demo viewer (and future staff logins) get a
// plain message instead of a silent no-op: RLS makes their updates match 0 rows.
export async function requireOwner(path) {
  const ctx = await requireSalon();
  if (ctx.role !== 'owner') done(path, ctx.salon.is_demo ? 'This is a read-only demo. Sign up to run your own salon.' : 'Only the owner can change this.');
  return ctx;
}
