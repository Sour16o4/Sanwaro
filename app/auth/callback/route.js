import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Google sends the owner back here with a one-time code; swap it for a session.
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '';
  const target = /^\/(?!\/)/.test(next) ? next : '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(target, url.origin));
  }
  return NextResponse.redirect(new URL('/login?error=Sign-in%20failed.%20Please%20try%20again.', url.origin));
}
