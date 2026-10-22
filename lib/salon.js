import 'server-only';
import { admin } from '@/lib/supabase/admin';

// Public view of a salon for the booking page and API: only what customers may see.
export async function getPublicSalon(slug) {
  const { data: salon } = await admin.from('businesses')
    .select('id, name, slug, address, timezone, customer_note, cancel_window_hours, max_days_ahead, hold_minutes')
    .eq('slug', slug).maybeSingle();
  if (!salon) return null;

  const [{ data: services }, { data: staff }, { data: links }] = await Promise.all([
    admin.from('services').select('id, name, duration_min, price_paise, deposit_paise')
      .eq('business_id', salon.id).eq('active', true).order('name'),
    admin.from('staff').select('id, name').eq('business_id', salon.id).eq('active', true).order('name'),
    admin.from('staff_services').select('staff_id, service_id').eq('business_id', salon.id),
  ]);
  return {
    ...salon,
    services,
    staff: staff.map((s) => ({ ...s, serviceIds: links.filter((l) => l.staff_id === s.id).map((l) => l.service_id) })),
  };
}

export async function getSalonRef(slug) {
  const { data } = await admin.from('businesses').select('id, timezone').eq('slug', slug).maybeSingle();
  return data;
}

// Free slots from the database (get_free_slots). staff = uuid, or null for anyone.
export async function freeSlots(salonId, serviceId, date, staffId) {
  const { data, error } = await admin.rpc('get_free_slots', {
    p_business: salonId, p_service: serviceId, p_date: date, p_staff: staffId,
  });
  if (error) throw error;
  return data;
}
