import { Suspense } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireSalon, SALON_COOKIE } from '@/lib/auth';
import { signOut } from '@/app/login/actions';

const NAV = [
  ['/dashboard', 'Today'],
  ['/dashboard/bookings', 'Bookings'],
  ['/dashboard/customers', 'Customers'],
  ['/dashboard/services', 'Services'],
  ['/dashboard/staff', 'Staff'],
  ['/dashboard/hours', 'Hours'],
  ['/dashboard/time-off', 'Time off'],
  ['/dashboard/settings', 'Settings'],
];

async function switchSalon(formData) {
  'use server';
  const { salons } = await requireSalon();
  const id = String(formData.get('salon'));
  if (salons.some((s) => s.id === id)) (await cookies()).set(SALON_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/' });
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

// The nav is static; anything that reads the session streams in behind <Suspense>.
export default function DashboardLayout({ children }) {
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="border-b border-line bg-white md:w-56 md:border-b-0 md:border-r">
        <div className="px-4 py-4">
          <Link href="/dashboard" className="text-lg font-semibold text-brand">Sanwaro</Link>
          <Suspense fallback={<p className="hint mt-1">…</p>}><SalonSwitcher /></Suspense>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col md:pb-4">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href}
              className="whitespace-nowrap rounded-lg px-3 py-2 text-sm text-ink hover:bg-brand-soft">
              {label}
            </Link>
          ))}
          <form action={signOut} className="md:mt-4">
            <button className="whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted hover:bg-paper">Sign out</button>
          </form>
        </nav>
      </aside>
      <main className="w-full max-w-4xl flex-1 px-4 py-8 md:px-8">
        <Suspense fallback={<p className="hint">Loading…</p>}>{children}</Suspense>
      </main>
    </div>
  );
}

async function SalonSwitcher() {
  const { salon, salons, role } = await requireSalon();
  return (
    <>
      {salons.length === 1 ? <p className="hint mt-1 truncate">{salon.name}</p> : (
        <form action={switchSalon} className="mt-2 flex gap-2">
          <select name="salon" defaultValue={salon.id} className="input mt-0 py-1" aria-label="Salon">
            {salons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="btn-ghost">Go</button>
        </form>
      )}
      {role === 'owner' && salons.length < 3 && <Link href="/onboarding" className="hint mt-1 block text-xs hover:text-brand">+ Add a salon</Link>}
      {role === 'viewer' && <p className="mt-2 rounded-lg bg-brand-soft px-2 py-1 text-xs">Demo · read-only</p>}
    </>
  );
}
