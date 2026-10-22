import { Suspense } from 'react';
import PageLoading from '@/components/PageLoading';
import Flash from '@/components/Flash';
import { z } from 'zod';
import { requireOwner, requireSalon } from '@/lib/auth';
import { done, firstIssue } from '@/lib/actions';

export const metadata = { title: 'Settings · Sanwaro' };
const PATH = '/dashboard/settings';
const int = (min, max, label) => z.coerce.number().int().min(min, `${label}: ${min} to ${max}.`).max(max, `${label}: ${min} to ${max}.`);

// Same limits as the CHECK constraints in the database.
const Settings = z.object({
  name: z.string().trim().min(2, 'Salon name is too short.').max(80),
  address: z.string().trim().max(200).transform((s) => s || null),
  buffer_min: int(0, 60, 'Gap after each booking'),
  hold_minutes: int(3, 15, 'Hold time'),
  cancel_window_hours: int(0, 168, 'Cancellation window'),
  max_days_ahead: int(1, 90, 'Booking window'),
  slot_step_min: z.coerce.number().refine((n) => [5, 10, 15, 20, 30, 60].includes(n), 'Pick a slot step from the list.'),
  smart_deposit: z.boolean(),
  customer_note: z.string().trim().max(300, 'Note for customers: up to 300 characters.').transform((s) => s || null),
});

async function saveSettings(formData) {
  'use server';
  const { supabase, salon } = await requireOwner(PATH);
  const s = Settings.safeParse({ ...Object.fromEntries(formData), smart_deposit: formData.get('smart_deposit') === 'on' });
  if (!s.success) done(PATH, firstIssue(s));
  const { error } = await supabase.from('businesses').update(s.data).eq('id', salon.id);
  done(PATH, error, 'Settings saved.');
}

function NumberField({ name, label, hint, min, max, value }) {
  return (
    <label className="label">{label}
      <input className="input" type="number" name={name} min={min} max={max} defaultValue={value} required />
      <span className="hint font-normal">{hint}</span>
    </label>
  );
}

// Each page streams in behind its own boundary, so moving between pages is instant.
export default function SettingsPage({ searchParams }) {
  return <Suspense fallback={<PageLoading />}><SettingsContent searchParams={searchParams} /></Suspense>;
}

async function SettingsContent({ searchParams }) {
  const { salon } = await requireSalon();
  return (
    <div className="space-y-6">
      <h1 className="h1">Settings</h1>
      <Flash searchParams={searchParams} />

      <form action={saveSettings} className="space-y-6">
        <section className="card grid gap-4 sm:grid-cols-2">
          <h2 className="h2 sm:col-span-2">Salon</h2>
          <label className="label">Name<input className="input" name="name" defaultValue={salon.name} required maxLength={80} /></label>
          <label className="label">Booking link
            <input className="input bg-paper text-muted" value={`/b/${salon.slug}`} readOnly />
          </label>
          <label className="label sm:col-span-2">Address
            <input className="input" name="address" defaultValue={salon.address ?? ''} maxLength={200} />
          </label>
        </section>

        <section className="card grid gap-4 sm:grid-cols-2">
          <h2 className="h2 sm:col-span-2">Booking rules</h2>
          <NumberField name="hold_minutes" label="Hold time (minutes)" min={3} max={15} value={salon.hold_minutes}
            hint="How long a picked slot waits for the deposit." />
          <NumberField name="cancel_window_hours" label="Free cancellation (hours before)" min={0} max={168}
            value={salon.cancel_window_hours} hint="Cancel earlier than this and the deposit is refunded." />
          <NumberField name="max_days_ahead" label="Book up to (days ahead)" min={1} max={90} value={salon.max_days_ahead}
            hint="How far into the future customers can book." />
          <NumberField name="buffer_min" label="Gap after each booking (minutes)" min={0} max={60} value={salon.buffer_min}
            hint="Cleaning and setup time between customers." />
          <label className="label">Slot step
            <select className="input" name="slot_step_min" defaultValue={salon.slot_step_min}>
              {[5, 10, 15, 20, 30, 60].map((n) => <option key={n} value={n}>Every {n} minutes</option>)}
            </select>
            <span className="hint font-normal">How often a new start time is offered.</span>
          </label>
          <label className="flex items-start gap-3 text-sm sm:col-span-2">
            <input type="checkbox" name="smart_deposit" defaultChecked={salon.smart_deposit} className="mt-1" />
            <span>
              <span className="font-medium">Smart deposits</span>
              <span className="hint block">Regulars (3+ visits, no no-shows) pay half. After a no-show the deposit goes up.
                Only customers you mark as trusted book with no deposit.</span>
            </span>
          </label>
        </section>

        <section className="card">
          <h2 className="h2">Note for customers</h2>
          <p className="hint">Shown on every confirmation: parking, directions, what to bring.</p>
          <textarea className="input mt-3 min-h-24" name="customer_note" maxLength={300}
            defaultValue={salon.customer_note ?? ''} placeholder="Parking behind the building. Ring the bell at the side door." />
        </section>

        <button className="btn">Save settings</button>
      </form>
    </div>
  );
}
