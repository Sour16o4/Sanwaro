'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { done } from '@/lib/actions';

// Only same-site paths, so ?next= can't send people to another website.
const safeNext = (next) => (typeof next === 'string' && /^\/(?!\/)/.test(next) ? next : '/dashboard');

export async function signInWithGoogle(formData) {
  const supabase = await createClient();
  const next = safeNext(formData.get('next'));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${process.env.APP_URL}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) done('/login', 'Google sign-in isn’t set up yet. Use email and password for now.');
  redirect(data.url);
}

// Email + password: the demo viewer and local development accounts.
export async function signInWithPassword(formData) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  });
  if (error) done('/login', 'Wrong email or password.');
  // An action's redirect renders the target in the same response (proxy.js doesn't
  // see it), so send owners without a salon straight to onboarding here.
  const { count } = await supabase.from('memberships')
    .select('business_id', { count: 'exact', head: true }).eq('user_id', data.user.id);
  revalidatePath('/', 'layout');
  redirect(count ? safeNext(formData.get('next')) : '/onboarding');
}

// "Try the demo": the read-only viewer of the demo salon (scripts/demo-reset.mjs creates it).
// The password stays on the server; the nightly reset sets it again in case someone changes it.
const DEMO_EMAIL = 'viewer@demo.sanwaro.app';
export async function signInAsDemo() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password: process.env.DEMO_VIEWER_PASSWORD ?? '' });
  if (error) done('/login', 'The demo isn’t available right now.');
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');   // never leave the last owner's pages in the browser cache
  redirect('/login');
}
