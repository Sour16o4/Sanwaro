import { Suspense } from 'react';
import PageLoading from '@/components/PageLoading';
import Flash from '@/components/Flash';
import { z } from 'zod';
import { requireOwner, requireSalon } from '@/lib/auth';
import { done, firstIssue } from '@/lib/actions';

export const metadata = { title: 'Staff · Sanwaro' };
const PATH = '/dashboard/staff';
const Name = z.string().trim().min(1, 'Enter a name.').max(80, 'Name is too long.');

async function addStaff(formData) {
  'use server';
  const { supabase, salon } = await requireOwner(PATH);
  const name = Name.safeParse(formData.get('name'));
  if (!name.success) done(PATH, firstIssue(name));
  // new staff can do every active service by default; untick later if not
  const { data: staff, error } = await supabase.from('staff')
    .insert({ business_id: salon.id, name: name.data }).select('id').single();
  if (error) done(PATH, error);
  const { data: services } = await supabase.from('services').select('id').eq('business_id', salon.id).eq('active', true);
  if (services.length) {
    const { error: linkError } = await supabase.from('staff_services').insert(
      services.map((s) => ({ business_id: salon.id, staff_id: staff.id, service_id: s.id })));
    done(PATH, linkError);
  }
  done(PATH);
}

async function updateStaff(formData) {
  'use server';
  const { supabase, salon } = await requireOwner(PATH);
  const id = String(formData.get('id'));
  const name = Name.safeParse(formData.get('name'));
  if (!name.success) done(PATH, firstIssue(name));

  const { error } = await supabase.from('staff')
    .update({ name: name.data, active: formData.get('active') === 'on' })
    .eq('id', id).eq('business_id', salon.id);
  if (error) done(PATH, error);

  // replace which services this person does
  const chosen = formData.getAll('service').map(String);
  const { error: delError } = await supabase.from('staff_services').delete()
    .eq('staff_id', id).eq('business_id', salon.id);
  if (delError) done(PATH, delError);
  if (chosen.length) {
    const { error: insError } = await supabase.from('staff_services').insert(
      chosen.map((service_id) => ({ business_id: salon.id, staff_id: id, service_id })));
    done(PATH, insError);
  }
  done(PATH);
}

async function deleteStaff(formData) {
  'use server';
  const { supabase, salon } = await requireOwner(PATH);
  const { error } = await supabase.from('staff').delete().eq('id', formData.get('id')).eq('business_id', salon.id);
  done(PATH, error);
}

// Each page streams in behind its own boundary, so moving between pages is instant.
export default function StaffPage({ searchParams }) {
  return <Suspense fallback={<PageLoading />}><StaffContent searchParams={searchParams} /></Suspense>;
}

async function StaffContent({ searchParams }) {
  const { supabase, salon } = await requireSalon();
  const [{ data: staff }, { data: services }, { data: links }] = await Promise.all([
    supabase.from('staff').select('*').eq('business_id', salon.id).order('active', { ascending: false }).order('name'),
    supabase.from('services').select('id, name, active').eq('business_id', salon.id).order('name'),
    supabase.from('staff_services').select('staff_id, service_id').eq('business_id', salon.id),
  ]);
  const does = new Set(links.map((l) => `${l.staff_id}:${l.service_id}`));

  return (
    <div className="space-y-6">
      <h1 className="h1">Staff</h1>
      <Flash searchParams={searchParams} />

      <form action={addStaff} className="card flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="label flex-1">Name
          <input className="input" name="name" placeholder="Bina" required maxLength={80} />
        </label>
        <button className="btn">Add staff</button>
      </form>

      <ul className="space-y-3">
        {staff.map((p) => (
          <li key={p.id} className={`card ${p.active ? '' : 'opacity-60'}`}>
            <form action={updateStaff} className="space-y-4">
              <input type="hidden" name="id" value={p.id} />
              <label className="label">Name
                <input className="input" name="name" defaultValue={p.name} required maxLength={80} />
              </label>
              <fieldset>
                <legend className="label">Does these services</legend>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                  {services.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="service" value={s.id} defaultChecked={does.has(`${p.id}:${s.id}`)} />
                      {s.name}{!s.active && <span className="text-muted">(off)</span>}
                    </label>
                  ))}
                  {!services.length && <span className="hint">Add services first.</span>}
                </div>
              </fieldset>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={p.active} /> Taking bookings
                </label>
                <button className="btn-ghost">Save</button>
                <button formAction={deleteStaff} className="btn-danger ml-auto">Delete</button>
              </div>
            </form>
          </li>
        ))}
        {!staff.length && <p className="hint">No staff yet. Add the people who take appointments.</p>}
      </ul>
    </div>
  );
}
