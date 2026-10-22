import { Suspense } from 'react';
import Link from 'next/link';
import PageLoading from '@/components/PageLoading';
import Flash from '@/components/Flash';
import BookingRow from '@/components/BookingRow';
import { requireSalon } from '@/lib/auth';
import { BOOKING_FIELDS, withTimes } from '@/lib/bookings';

export const metadata = { title: 'Bookings · Sanwaro' };
const LIMIT = 100;

// Each page streams in behind its own boundary, so moving between pages is instant.
export default function BookingsPage({ searchParams }) {
  return <Suspense fallback={<PageLoading />}><BookingsContent searchParams={searchParams} /></Suspense>;
}

async function BookingsContent({ searchParams }) {
  const { supabase, salon } = await requireSalon();
  const past = (await searchParams).view === 'past';
  const back = past ? '/dashboard/bookings?view=past' : '/dashboard/bookings';

  // 'now' is a Postgres timestamp literal; sl = strictly left of (ended before now)
  let q = supabase.from('bookings').select(BOOKING_FIELDS).eq('business_id', salon.id).neq('status', 'expired');
  q = past ? q.filter('slot', 'sl', '[now,)').order('slot', { ascending: false })
    : q.not('slot', 'sl', '[now,)').order('slot');
  const { data, error } = await q.limit(LIMIT);
  if (error) throw error;
  const bookings = withTimes(data);

  const tab = (on) => `rounded-lg px-3 py-1.5 text-sm ${on ? 'bg-brand text-white' : 'border border-line bg-white'}`;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Bookings</h1>
        <p className="hint mt-1">Phone bookings are added from <Link href="/dashboard" className="underline">Today</Link>.</p>
      </div>
      <nav className="flex gap-2" aria-label="Which bookings">
        <Link href="/dashboard/bookings" className={tab(!past)}>Upcoming</Link>
        <Link href="/dashboard/bookings?view=past" className={tab(past)}>Past</Link>
      </nav>
      <Flash searchParams={searchParams} />
      <ul className="space-y-2">
        {bookings.map((b) => <BookingRow key={b.id} b={b} tz={salon.timezone} back={back} showDay showStaff />)}
        {!bookings.length && <p className="hint">No {past ? 'past' : 'upcoming'} bookings.</p>}
      </ul>
      {bookings.length === LIMIT && <p className="hint">Showing the {past ? 'latest' : 'next'} {LIMIT}.</p>}
    </div>
  );
}
