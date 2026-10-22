import { Suspense } from 'react';
import Link from 'next/link';
import PageLoading from '@/components/PageLoading';
import { requireSalon } from '@/lib/auth';

export const metadata = { title: 'Customers · Sanwaro' };

// Each page streams in behind its own boundary, so moving between pages is instant.
export default function CustomersPage({ searchParams }) {
  return <Suspense fallback={<PageLoading />}><CustomersContent searchParams={searchParams} /></Suspense>;
}

async function CustomersContent({ searchParams }) {
  const { supabase, salon } = await requireSalon();
  const term = String((await searchParams).q ?? '').trim().slice(0, 40);
  let q = supabase.from('customers').select('id, name, phone, no_show_count, trusted, blocked, notes')
    .eq('business_id', salon.id).order('name').limit(200);
  // letters/digits/spaces only: commas and dots are PostgREST filter syntax
  const safe = term.replace(/[^\p{L}\p{N} ]/gu, '');
  if (safe) q = q.or(`name.ilike.%${safe}%,phone.like.%${safe.replace(/\D/g, '') || safe}%`);
  const { data: customers, error } = await q;
  if (error) throw error;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Customers</h1>
        <p className="hint mt-1">Everyone who booked. Mark regulars as trusted to skip their deposit.</p>
      </div>
      <form className="flex gap-2" role="search">
        <input className="input mt-0" name="q" defaultValue={term} placeholder="Name or phone" aria-label="Search customers" />
        <button className="btn-ghost">Search</button>
      </form>
      <ul className="divide-y divide-line rounded-xl border border-line bg-white">
        {customers.map((c) => (
          <li key={c.id}>
            <Link href={`/dashboard/customers/${c.id}`} className="flex flex-wrap items-baseline gap-x-3 px-4 py-3 text-sm hover:bg-paper">
              <span className="font-medium">{c.name}</span>
              <span className="text-muted">{c.phone}</span>
              {c.trusted && <span className="text-xs text-emerald-700">trusted</span>}
              {c.blocked && <span className="text-xs text-red-700">blocked</span>}
              {c.no_show_count > 0 && <span className="text-xs text-red-700">{c.no_show_count} no-show{c.no_show_count > 1 && 's'}</span>}
              {c.notes && <span className="hint w-full truncate">{c.notes}</span>}
            </Link>
          </li>
        ))}
        {!customers.length && <li className="hint px-4 py-3">{term ? 'Nobody matches.' : 'No customers yet.'}</li>}
      </ul>
    </div>
  );
}
