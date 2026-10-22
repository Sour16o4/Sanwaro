import { Suspense } from 'react';
import Link from 'next/link';
import PageLoading from '@/components/PageLoading';
import Flash from '@/components/Flash';
import BookingRow from '@/components/BookingRow';
import { requireSalon } from '@/lib/auth';
import { BOOKING_FIELDS, withTimes, dayRange } from '@/lib/bookings';
import { upcomingDates, formatDay } from '@/lib/time';
import { isoDate } from '@/lib/validation';
import { addPhoneBooking } from './bookings/actions';

export const metadata = { title: 'Today · Sanwaro' };

const shift = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);

// Each page streams in behind its own boundary, so moving between pages is instant.
export default function Today({ searchParams }) {
  return <Suspense fallback={<PageLoading />}><TodayContent searchParams={searchParams} /></Suspense>;
}

async function TodayContent({ searchParams }) {
  const { supabase, salon, role } = await requireSalon();
  const tz = salon.timezone;
  const today = upcomingDates(tz, 1)[0];
  const asked = (await searchParams).date;
  const date = isoDate.safeParse(asked).success ? asked : today;
  const back = date === today ? '/dashboard' : `/dashboard?date=${date}`;

  const [{ data: staff }, { data: services }, { data: rows, error }, setup] = await Promise.all([
    supabase.from('staff').select('id, name').eq('business_id', salon.id).eq('active', true).order('name'),
    supabase.from('services').select('id, name, duration_min').eq('business_id', salon.id).eq('active', true).order('name'),
    supabase.from('bookings').select(BOOKING_FIELDS).eq('business_id', salon.id)
      .neq('status', 'expired').overlaps('slot', dayRange(date, tz)).order('slot'),
    setupSteps(supabase, salon.id),
  ]);
  if (error) throw error;
  const bookings = withTimes(rows);
  const live = bookings.filter((b) => b.status !== 'cancelled');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">{date === today ? 'Today' : formatDay(date + 'T12:00:00Z', 'UTC')}</h1>
          <p className="hint mt-1">{live.length} booking{live.length === 1 ? '' : 's'} · booking link{' '}
            <Link href={`/b/${salon.slug}`} className="font-mono hover:text-brand">/b/{salon.slug}</Link></p>
        </div>
        <nav className="flex gap-2" aria-label="Day">
          <Link className="btn-ghost" href={`/dashboard?date=${shift(date, -1)}`}>← Prev</Link>
          {date !== today && <Link className="btn-ghost" href="/dashboard">Today</Link>}
          <Link className="btn-ghost" href={`/dashboard?date=${shift(date, 1)}`}>Next →</Link>
        </nav>
      </div>
      <Flash searchParams={searchParams} />

      {setup.some((s) => !s[3]) && <Checklist steps={setup} />}

      <div className="grid gap-6 lg:grid-cols-2">
        {staff.map((p) => {
          const mine = bookings.filter((b) => b.staff_id === p.id);
          return (
            <section key={p.id} aria-label={p.name}>
              <h2 className="h2 mb-3">{p.name}</h2>
              <ul className="space-y-2">
                {mine.map((b) => <BookingRow key={b.id} b={b} tz={tz} back={back} />)}
                {!mine.length && <p className="hint">Free all day.</p>}
              </ul>
            </section>
          );
        })}
      </div>

      {role === 'owner' && staff.length > 0 && services.length > 0 && (
        <details className="card" open={!bookings.length}>
          <summary className="cursor-pointer font-medium">Add a phone booking</summary>
          <form action={addPhoneBooking} className="mt-4 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="back" value={back} />
            <label className="label">Service
              <select className="input" name="service" required>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.duration_min} min)</option>)}
              </select>
            </label>
            <label className="label">Stylist
              <select className="input" name="staff" required>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="label">Date<input className="input" type="date" name="date" defaultValue={date} required /></label>
            <label className="label">Time<input className="input" type="time" name="time" step={300} required /></label>
            <label className="label">Customer name<input className="input" name="name" maxLength={80} required /></label>
            <label className="label">Mobile number<input className="input" name="phone" type="tel" inputMode="numeric" required /></label>
            <button className="btn sm:col-span-2 sm:justify-self-start">Add booking</button>
          </form>
        </details>
      )}
    </div>
  );
}

async function setupSteps(supabase, salonId) {
  const count = async (table, extra = (q) => q) => {
    const { count } = await extra(supabase.from(table).select('*', { count: 'exact', head: true }).eq('business_id', salonId));
    return count ?? 0;
  };
  const [services, staff, links, hours] = await Promise.all([
    count('services', (q) => q.eq('active', true)),
    count('staff', (q) => q.eq('active', true)),
    count('staff_services'),
    count('working_hours'),
  ]);
  return [
    ['Add your services', 'Name, duration, price and deposit.', '/dashboard/services', services > 0],
    ['Add your staff', 'Who works at the salon.', '/dashboard/staff', staff > 0],
    ['Choose who does what', 'Tick the services each stylist offers.', '/dashboard/staff', links > 0],
    ['Set opening hours', 'Working windows per stylist; gaps are breaks.', '/dashboard/hours', hours > 0],
    ['Check your policies', 'Hold time, cancellation window, note for customers.', '/dashboard/settings', true],
  ];
}

function Checklist({ steps }) {
  return (
    <section className="card">
      <h2 className="h2">Finish setting up</h2>
      <ol className="mt-4 space-y-3">
        {steps.map(([title, hint, href, ok]) => (
          <li key={title} className="flex items-start gap-3">
            <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs
              ${ok ? 'bg-brand text-white' : 'border border-line text-muted'}`}>{ok ? '✓' : ''}</span>
            <div>
              <Link href={href} className="font-medium hover:text-brand">{title}</Link>
              <p className="hint">{hint}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
