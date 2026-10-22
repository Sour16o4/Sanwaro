import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Refreshes the Supabase session cookie and keeps signed-out visitors out of
// the owner area. Pages still check the user themselves (never trust only this).
export async function proxy(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list, headers) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;

  if (!signedIn && pathname !== '/login') {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  if (signedIn && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  // No salon yet -> onboarding. Decided here, before rendering: a redirect thrown
  // while rendering /dashboard gets kept in the browser's router cache and replayed
  // after the salon is created.
  if (signedIn && pathname.startsWith('/dashboard')) {
    const { count } = await supabase.from('memberships')
      .select('business_id', { count: 'exact', head: true }).eq('user_id', data.claims.sub);
    if (!count) return NextResponse.redirect(new URL('/onboarding', request.url));
  }
  return response;
}

export const config = {
  matcher: ['/dashboard/:path*', '/onboarding', '/login'],
};
