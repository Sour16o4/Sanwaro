import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { z } from 'zod';
import { admin } from '@/lib/supabase/admin';
import { formatRupees } from '@/lib/money';
import { formatTime } from '@/lib/time';

export const metadata = { title: 'Your booking · Sanwaro', robots: { index: false } };

const STATUS = {
  held: 'Held, waiting for the deposit',
  confirmed: 'Confirmed',
  completed: 'Completed',
  no_show: 'Missed',
  cancelled: 'Cancelled',
  expired: 'Hold expired',
};

export default function ManagePage({ params }) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <Suspense fallback={<p className="hint">Loading…</p>}><Booking params={params} /></Suspense>
    </main>
  );
}

// The unguessable token in the link is the only key: no account needed.
async function Booking({ params }) {
  const { token } = await params;
  await connection();
  if (!z.uuid().safeParse(token).success) notFound();

  // bookings reach their salon through the service (composite FKs, no direct one)
  const { data: b, error } = await admin.from('bookings')
    .select('status, slot, deposit_paise, booked_name, staff(name), service:services(name, price_paise, business:businesses(name, address, timezone, customer_note))')
    .eq('manage_token', token).maybeSingle();
  if (error) throw error;
  if (!b) notFound();
  b.business = b.service.business;

  const start = b.slot.slice(1).split(',')[0].replaceAll('"', '');
  const tz = b.business.timezone;
  return (
    <section className="card space-y-4">
      <div>
        <p className="hint">{b.business.name}</p>
        <h1 className="h1">{STATUS[b.status]}</h1>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Name</dt><dd>{b.booked_name}</dd>
        <dt className="text-muted">Service</dt><dd>{b.service.name}</dd>
        <dt className="text-muted">When</dt>
        <dd>{new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(start))}, {formatTime(start, tz)}</dd>
        <dt className="text-muted">Stylist</dt><dd>{b.staff.name}</dd>
        <dt className="text-muted">Price</dt>
        <dd>{b.deposit_paise
          ? `${formatRupees(b.deposit_paise)} deposit, ${formatRupees(b.service.price_paise - b.deposit_paise)} at the salon`
          : `${formatRupees(b.service.price_paise)} at the salon`}</dd>
        {b.business.address && <><dt className="text-muted">Where</dt><dd>{b.business.address}</dd></>}
      </dl>
      {b.business.customer_note && <p className="rounded-lg bg-paper p-3 text-sm">{b.business.customer_note}</p>}
      <p className="hint">Need to change something? Call the salon. Online cancellation is coming soon.</p>
    </section>
  );
}
