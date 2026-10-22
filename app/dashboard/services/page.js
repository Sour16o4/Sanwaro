import { Suspense } from 'react';
import PageLoading from '@/components/PageLoading';
import Flash from '@/components/Flash';
import { z } from 'zod';
import { requireOwner, requireSalon } from '@/lib/auth';
import { done, firstIssue } from '@/lib/actions';
import { rupeesToPaise, formatRupees } from '@/lib/money';

export const metadata = { title: 'Services · Sanwaro' };
const PATH = '/dashboard/services';

const Service = z.object({
  name: z.string().trim().min(1, 'Give the service a name.').max(80),
  duration_min: z.coerce.number().int().min(5, 'Duration: 5 to 480 minutes.').max(480, 'Duration: 5 to 480 minutes.'),
  price_paise: z.number({ error: 'Price must be a rupee amount, like 300 or 299.50.' }).int().min(0),
  deposit_paise: z.number({ error: 'Deposit must be a rupee amount, like 100.' }).int().min(0),
}).refine((s) => s.deposit_paise <= s.price_paise, 'The deposit can’t be more than the price.');

const parse = (formData) => Service.safeParse({
  name: formData.get('name'),
  duration_min: formData.get('duration_min'),
  price_paise: rupeesToPaise(formData.get('price')) ?? undefined,
  deposit_paise: rupeesToPaise(formData.get('deposit') || '0') ?? undefined,
});

async function addService(formData) {
  'use server';
  const { supabase, salon } = await requireOwner(PATH);
  const s = parse(formData);
  if (!s.success) done(PATH, firstIssue(s));
  const { error } = await supabase.from('services').insert({ ...s.data, business_id: salon.id });
  done(PATH, error);
}

async function updateService(formData) {
  'use server';
  const { supabase, salon } = await requireOwner(PATH);
  const s = parse(formData);
  if (!s.success) done(PATH, firstIssue(s));
  const { error } = await supabase.from('services')
    .update({ ...s.data, active: formData.get('active') === 'on' })
    .eq('id', formData.get('id')).eq('business_id', salon.id);
  done(PATH, error);
}

async function deleteService(formData) {
  'use server';
  const { supabase, salon } = await requireOwner(PATH);
  const { error } = await supabase.from('services').delete().eq('id', formData.get('id')).eq('business_id', salon.id);
  done(PATH, error);
}

const rupees = (paise) => (paise / 100).toString();

function Fields({ s = {} }) {
  return (
    <>
      <label className="label sm:col-span-2">Name
        <input className="input" name="name" defaultValue={s.name} placeholder="Haircut" required maxLength={80} />
      </label>
      <label className="label">Minutes
        <input className="input" name="duration_min" type="number" min={5} max={480} step={5}
               defaultValue={s.duration_min ?? 30} required />
      </label>
      <label className="label">Price ₹
        <input className="input" name="price" inputMode="decimal" defaultValue={s.price_paise != null ? rupees(s.price_paise) : ''}
               placeholder="300" required />
      </label>
      <label className="label">Deposit ₹
        <input className="input" name="deposit" inputMode="decimal" defaultValue={s.deposit_paise != null ? rupees(s.deposit_paise) : ''}
               placeholder="0 = pay at salon" />
      </label>
    </>
  );
}

// Each page streams in behind its own boundary, so moving between pages is instant.
export default function ServicesPage({ searchParams }) {
  return <Suspense fallback={<PageLoading />}><ServicesContent searchParams={searchParams} /></Suspense>;
}

async function ServicesContent({ searchParams }) {
  const { supabase, salon } = await requireSalon();
  const { data: services } = await supabase.from('services').select('*')
    .eq('business_id', salon.id).order('active', { ascending: false }).order('name');

  return (
    <div className="space-y-6">
      <h1 className="h1">Services</h1>
      <Flash searchParams={searchParams} />

      <form action={addService} className="card grid gap-3 sm:grid-cols-6 sm:items-end">
        <Fields />
        <button className="btn sm:col-span-6 sm:justify-self-start">Add service</button>
      </form>

      <ul className="space-y-3">
        {services.map((s) => (
          <li key={s.id} className={`card ${s.active ? '' : 'opacity-60'}`}>
            <p className="mb-3 text-sm">
              <span className="font-medium">{s.name}</span>
              <span className="text-muted"> · {s.duration_min} min · {formatRupees(s.price_paise)} ·{' '}
                {s.deposit_paise ? `${formatRupees(s.deposit_paise)} now, ${formatRupees(s.price_paise - s.deposit_paise)} at the salon` : 'pay at salon'}
              </span>
            </p>
            <form action={updateService} className="grid gap-3 sm:grid-cols-6 sm:items-end">
              <input type="hidden" name="id" value={s.id} />
              <Fields s={s} />
              <div className="flex items-center gap-4 sm:col-span-6">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={s.active} /> Bookable
                </label>
                <button className="btn-ghost">Save</button>
                <button formAction={deleteService} className="btn-danger ml-auto">Delete</button>
              </div>
            </form>
          </li>
        ))}
        {!services.length && <p className="hint">No services yet. Add your first one above.</p>}
      </ul>
    </div>
  );
}
