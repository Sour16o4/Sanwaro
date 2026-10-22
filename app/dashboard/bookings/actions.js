'use server';
import { z } from 'zod';
import { requireOwner } from '@/lib/auth';
import { done, firstIssue } from '@/lib/actions';
import { localToUtc, formatTime } from '@/lib/time';
import { isoDate, normalizePhone } from '@/lib/validation';

// Back to the page the button was on (dashboard paths only).
const backTo = (formData) => {
  const back = String(formData.get('back') ?? '');
  return /^\/dashboard(\/|\?|$)/.test(back) ? back : '/dashboard';
};

const LABEL = { completed: 'Marked completed.', no_show: 'Marked as no-show.', cancelled: 'Booking cancelled.' };

// completed / no-show / cancel. bookings_guard in the database decides which moves are legal.
export async function setBookingStatus(formData) {
  const back = backTo(formData);
  const { supabase, salon } = await requireOwner(back);
  const status = String(formData.get('status'));
  if (!LABEL[status]) done(back, 'Unknown action.');
  const { data, error } = await supabase.from('bookings').update({ status })
    .eq('id', formData.get('id')).eq('business_id', salon.id).select('id');
  if (!error && !data.length) done(back, 'Booking not found.');
  done(back, error, LABEL[status]);
}

const PhoneBooking = z.object({
  service: z.uuid('Pick a service.'),
  staff: z.uuid('Pick a stylist.'),
  date: isoDate,
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a time.'),
  name: z.string().trim().min(1, 'Enter the customer’s name.').max(80),
  phone: z.string().transform(normalizePhone).refine(Boolean, 'Enter a 10-digit Indian mobile number.'),
});

// The owner takes a booking on the phone. Any time is allowed (the owner knows the
// diary); only a clash with another booking for that stylist is refused.
export async function addPhoneBooking(formData) {
  const back = backTo(formData);
  const { supabase, salon } = await requireOwner(back);
  const parsed = PhoneBooking.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done(back, firstIssue(parsed));
  const f = parsed.data;

  const start = localToUtc(`${f.date}T${f.time}`, salon.timezone);
  const { data: service } = await supabase.from('services').select('duration_min')
    .eq('id', f.service).eq('business_id', salon.id).maybeSingle();
  if (!start || !service) done(back, 'Pick a service and a time.');
  const end = new Date(start.getTime() + (service.duration_min + salon.buffer_min) * 60000);

  // existing customer by phone (their saved name stays), or a new one
  let { data: customer, error } = await supabase.from('customers').select('id')
    .eq('business_id', salon.id).eq('phone', f.phone).maybeSingle();
  if (!customer && !error) {
    ({ data: customer, error } = await supabase.from('customers')
      .insert({ business_id: salon.id, name: f.name, phone: f.phone }).select('id').single());
  }
  if (error) done(back, error);

  ({ error } = await supabase.from('bookings').insert({
    business_id: salon.id, staff_id: f.staff, service_id: f.service, customer_id: customer.id,
    slot: `[${start.toISOString()},${end.toISOString()})`, status: 'confirmed', source: 'manual', booked_name: f.name,
  }));
  if (error?.code === '23P01') done(back, 'That stylist already has a booking at that time.');
  done(back, error, `Booked ${f.name} at ${formatTime(start, salon.timezone)}.`);
}
