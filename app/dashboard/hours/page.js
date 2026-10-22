import { Suspense } from 'react';
import PageLoading from '@/components/PageLoading';
import Flash from '@/components/Flash';
import { z } from 'zod';
import { requireOwner, requireSalon } from '@/lib/auth';
import { done, firstIssue } from '@/lib/actions';
import { WEEKDAYS, hhmm } from '@/lib/time';

export const metadata = { title: 'Hours · Sanwaro' };
const PATH = '/dashboard/hours';
const time = z.string().regex(/^\d{2}:\d{2}$/, 'Pick a start and end time.');

const Window = z.object({
  staff: z.array(z.uuid()).min(1, 'Pick at least one person.'),
  days: z.array(z.coerce.number().int().min(0).max(6)).min(1, 'Pick at least one day.'),
  start_time: time,
  end_time: time,
}).refine((w) => w.end_time > w.start_time, 'The end time must be after the start time.');

// One row per stylist per day. A lunch break = two windows (10:00–13:00, 14:00–19:00).
async function addWindows(formData) {
  'use server';
  const { supabase, salon } = await requireOwner(PATH);
  const w = Window.safeParse({
    staff: formData.getAll('staff'), days: formData.getAll('day'),
    start_time: formData.get('start_time'), end_time: formData.get('end_time'),
  });
  if (!w.success) done(PATH, firstIssue(w));
  const rows = w.data.staff.flatMap((staff_id) => w.data.days.map((weekday) => ({
    business_id: salon.id, staff_id, weekday, start_time: w.data.start_time, end_time: w.data.end_time,
  })));
  const { error } = await supabase.from('working_hours').insert(rows);
  done(PATH, error?.code === '23P01' ? 'That overlaps hours already set for someone. Remove the old window first.' : error);
}

async function removeWindow(formData) {
  'use server';
  const { supabase, salon } = await requireOwner(PATH);
  const { error } = await supabase.from('working_hours').delete().eq('id', formData.get('id')).eq('business_id', salon.id);
  done(PATH, error);
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

// Each page streams in behind its own boundary, so moving between pages is instant.
export default function HoursPage({ searchParams }) {
  return <Suspense fallback={<PageLoading />}><HoursContent searchParams={searchParams} /></Suspense>;
}

async function HoursContent({ searchParams }) {
  const { supabase, salon } = await requireSalon();
  const [{ data: staff }, { data: windows }] = await Promise.all([
    supabase.from('staff').select('id, name').eq('business_id', salon.id).eq('active', true).order('name'),
    supabase.from('working_hours').select('*').eq('business_id', salon.id).order('start_time'),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Opening hours</h1>
        <p className="hint mt-1">Times are in {salon.timezone}. For a lunch break, add two windows: 10:00–13:00 and 14:00–19:00.</p>
      </div>
      <Flash searchParams={searchParams} />

      {staff.length ? (
        <form action={addWindows} className="card space-y-4">
          <fieldset>
            <legend className="label">Who</legend>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {staff.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="staff" value={p.id} defaultChecked /> {p.name}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="label">Days</legend>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {DAY_ORDER.map((d) => (
                <label key={d} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="day" value={d} defaultChecked={d !== 0} /> {WEEKDAYS[d].slice(0, 3)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-end gap-3">
            <label className="label">From<input className="input" type="time" name="start_time" defaultValue="10:00" required /></label>
            <label className="label">To<input className="input" type="time" name="end_time" defaultValue="13:00" required /></label>
            <button className="btn">Add hours</button>
          </div>
        </form>
      ) : <p className="hint">Add staff first, then set their hours.</p>}

      {staff.map((p) => {
        const mine = windows.filter((w) => w.staff_id === p.id);
        return (
          <section key={p.id} className="card">
            <h2 className="h2">{p.name}</h2>
            <dl className="mt-3 divide-y divide-line text-sm">
              {DAY_ORDER.map((d) => {
                const day = mine.filter((w) => w.weekday === d);
                return (
                  <div key={d} className="flex flex-wrap items-center gap-2 py-2">
                    <dt className="w-24 text-muted">{WEEKDAYS[d]}</dt>
                    <dd className="flex flex-wrap gap-2">
                      {day.length ? day.map((w) => (
                        <form key={w.id} action={removeWindow} className="flex items-center gap-1 rounded-full bg-brand-soft px-3 py-1">
                          <input type="hidden" name="id" value={w.id} />
                          {hhmm(w.start_time)}–{hhmm(w.end_time)}
                          <button aria-label={`Remove ${hhmm(w.start_time)} to ${hhmm(w.end_time)}`} className="ml-1 text-muted hover:text-red-700">×</button>
                        </form>
                      )) : <span className="text-muted">Closed</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
