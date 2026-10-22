import { Suspense } from 'react';
import PageLoading from '@/components/PageLoading';
import Flash from '@/components/Flash';
import { requireOwner, requireSalon } from '@/lib/auth';
import { done } from '@/lib/actions';
import { localToUtc, formatDateTime } from '@/lib/time';

export const metadata = { title: 'Time off · Sanwaro' };
const PATH = '/dashboard/time-off';

async function addTimeOff(formData) {
  'use server';
  const { supabase, salon } = await requireOwner(PATH);
  const from = localToUtc(String(formData.get('from')), salon.timezone);
  const to = localToUtc(String(formData.get('to')), salon.timezone);
  if (!from || !to) done(PATH, 'Pick a start and end.');
  if (to <= from) done(PATH, 'The end must be after the start.');
  const { error } = await supabase.from('time_off').insert({
    business_id: salon.id,
    staff_id: formData.get('staff'),
    period: `[${from.toISOString()},${to.toISOString()})`,
    reason: String(formData.get('reason') ?? '').slice(0, 200) || null,
  });
  done(PATH, error);
}

async function removeTimeOff(formData) {
  'use server';
  const { supabase, salon } = await requireOwner(PATH);
  const { error } = await supabase.from('time_off').delete().eq('id', formData.get('id')).eq('business_id', salon.id);
  done(PATH, error);
}

// tstzrange text: ["2026-10-24 04:30:00+00","2026-10-24 12:30:00+00")
const bounds = (range) => range.slice(1, -1).split(',').map((s) => s.replaceAll('"', ''));

// Each page streams in behind its own boundary, so moving between pages is instant.
export default function TimeOffPage({ searchParams }) {
  return <Suspense fallback={<PageLoading />}><TimeOffContent searchParams={searchParams} /></Suspense>;
}

async function TimeOffContent({ searchParams }) {
  const { supabase, salon } = await requireSalon();
  const [{ data: staff }, { data: rows }] = await Promise.all([
    supabase.from('staff').select('id, name').eq('business_id', salon.id).order('name'),
    // upcoming only: period not entirely before now ('now' is a Postgres timestamp literal)
    supabase.from('time_off').select('*').eq('business_id', salon.id).not('period', 'sl', '[now,)').order('period'),
  ]);
  const name = Object.fromEntries(staff.map((s) => [s.id, s.name]));
  const upcoming = rows.map((r) => ({ ...r, range: bounds(r.period) }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Time off</h1>
        <p className="hint mt-1">Leave and holidays. Nobody can book these times. Times are in {salon.timezone}.</p>
      </div>
      <Flash searchParams={searchParams} />

      {staff.length ? (
        <form action={addTimeOff} className="card grid gap-3 sm:grid-cols-2">
          <label className="label">Who
            <select className="input" name="staff" required>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="label">Reason (optional)
            <input className="input" name="reason" maxLength={200} placeholder="Diwali leave" />
          </label>
          <label className="label">From<input className="input" type="datetime-local" name="from" required /></label>
          <label className="label">To<input className="input" type="datetime-local" name="to" required /></label>
          <button className="btn sm:col-span-2 sm:justify-self-start">Add time off</button>
        </form>
      ) : <p className="hint">Add staff first.</p>}

      <ul className="space-y-2">
        {upcoming.map((r) => (
          <li key={r.id} className="card flex flex-wrap items-center gap-3 py-3 text-sm">
            <span className="font-medium">{name[r.staff_id]}</span>
            <span>{formatDateTime(r.range[0], salon.timezone)} → {formatDateTime(r.range[1], salon.timezone)}</span>
            {r.reason && <span className="text-muted">{r.reason}</span>}
            <form action={removeTimeOff} className="ml-auto">
              <input type="hidden" name="id" value={r.id} />
              <button className="btn-danger">Remove</button>
            </form>
          </li>
        ))}
        {!upcoming.length && <p className="hint">No upcoming time off.</p>}
      </ul>
    </div>
  );
}
