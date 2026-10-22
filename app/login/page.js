import { Suspense } from 'react';
import Flash from '@/components/Flash';
import { signInWithGoogle, signInWithPassword, signInAsDemo } from './actions';

export const metadata = { title: 'Sign in · Sanwaro' };

export default function LoginPage({ searchParams }) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <h1 className="h1">Sanwaro</h1>
      <p className="hint mt-1">Sign in to manage your salon.</p>

      <div className="mt-8">
        <Flash searchParams={searchParams} />
      </div>

      <Suspense>
        <LoginForms searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoginForms({ searchParams }) {
  const { next = '' } = await searchParams;
  return (
    <div className="card space-y-6">
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <button className="btn w-full">Continue with Google</button>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> or with email <span className="h-px flex-1 bg-line" />
      </div>

      <form action={signInWithPassword} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <label className="label">
          Email
          <input className="input" type="email" name="email" autoComplete="email" required />
        </label>
        <label className="label">
          Password
          <input className="input" type="password" name="password" autoComplete="current-password" required />
        </label>
        <button className="btn-ghost w-full py-2">Sign in</button>
      </form>

      <form action={signInAsDemo} className="border-t border-line pt-4 text-center">
        <button className="text-sm font-medium text-brand hover:underline">Try the demo salon (read-only)</button>
      </form>
    </div>
  );
}
