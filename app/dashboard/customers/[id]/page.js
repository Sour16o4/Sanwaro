import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import PageLoading from '@/components/PageLoading';
import Flash from '@/components/Flash';
import BookingRow from '@/components/BookingRow';
import { requireOwner, requireSalon } from '@/lib/auth';
import { done } from '@/lib/actions';
import { BOOKING_FIELDS, withTimes } from '@/lib/bookings';

export const metadata = { title: 'Customer · Sanwaro' };

// Trusted = no deposit next time (deposit_for). Blocked = can't book online or join the queue.
async function saveCustomer(formData) {
  'use server';
  const id = String(formData.get('id'));
  const path = `/dashboard/customers/${id}`;
  const { supabase, salon } = await requireOwner(path);
  const { data, error } = await supabase.from('customers').update({
    notes: String(formData.get('notes') ?? '').trim().slice(0, 1000) || null,
    trusted: formData.get('trusted') === 'on',
    blocked: formData.get('blocked') === 'on',
  }).eq('id', id).eq('business_id', salon.id).select('id');
  if (!error && !data.length) done('/dashboard/customers', 'Customer not found.');
  done(path, error, 'Saved.');
}

// Each page streams in behind its own boundary, so moving between pages is instant.
export default function CustomerPage(props) {
  return <Suspense fallback={<PageLoading />}><CustomerContent {...props} /></Suspense>;
}

async function CustomerContent({ params, searchParams }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { supabase, salon } = await requireSalon();
  const [{ data: c }, { data: rows, error }] = await Promise.all([
    supabase.from('customers').select('*').eq('id', id).eq('business_id', salon.id).maybeSingle(),
    supabase.from('bookings').select(BOOKING_FIELDS).eq('customer_id', id).eq('business_id', salon.id)
      .neq('status', 'expired').order('slot', { ascending: false }).limit(50),
  ]);
  if (error) throw error;
  if (!c) notFound();
  const bookings = withTimes(rows);
  const visits = bookings.filter((b) => b.status === 'completed').length;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/customers" className="hint hover:text-brand">← Customers</Link>
        <h1 className="h1 mt-2">{c.name}</h1>
        <p className="hint mt-1">
          <a href={`tel:+91${c.phone}`} className="hover:text-brand">{c.phone}</a> · {visits} visit{visits === 1 ? '' : 's'} · {c.no_show_count} no-show{c.no_show_count === 1 ? '' : 's'}
        </p>
      </div>
      <Flash searchParams={searchParams} />

      <form action={saveCustomer} className="card space-y-4">
        <input type="hidden" name="id" value={c.id} />
        <label className="label">Notes (only you see these)
          <textarea className="input" name="notes" rows={3} maxLength={1000} defaultValue={c.notes ?? ''} placeholder="Prefers Bina. Allergic to ammonia." />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="trusted" defaultChecked={c.trusted} className="mt-1" />
          <span><b>Trusted</b>: no deposit for online bookings (if they have no no-shows).
            <span className="hint block">Phone numbers aren’t verified, so only trust people you know.</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="blocked" defaultChecked={c.blocked} className="mt-1" />
          <span><b>Blocked</b>: can’t book online or join the walk-in queue.</span>
        </label>
        <button className="btn">Save</button>
      </form>

      <section>
        <h2 className="h2 mb-3">History</h2>
        <ul className="space-y-2">
          {bookings.map((b) => <BookingRow key={b.id} b={b} tz={salon.timezone} back={`/dashboard/customers/${c.id}`} showDay showStaff />)}
          {!bookings.length && <p className="hint">No bookings yet.</p>}
        </ul>
      </section>
    </div>
  );
}
