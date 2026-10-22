// Rebuilds the demo salon with a week of realistic bookings around today, and the
// read-only viewer login behind "Try the demo salon".
//   npm run demo:reset                       (local, also makes demo@sanwaro.test its owner)
//   node --env-file=.env.production scripts/demo-reset.mjs   (cloud)
// Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_VIEWER_PASSWORD.
import { createClient } from '@supabase/supabase-js';
import { localToUtc, upcomingDates } from '../lib/time.js';

const VIEWER = 'viewer@demo.sanwaro.app';
const SLUG = 'glow-salon';
const TZ = 'Asia/Kolkata';
const ownerEmail = process.argv[2];
const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, DEMO_VIEWER_PASSWORD: password } = process.env;
if (!url || !key || !password) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DEMO_VIEWER_PASSWORD.');

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const must = async (q) => {
  const { data, error } = await q;
  if (error) throw error;
  return data;
};

// 1. wipe the old demo (bookings first: they hold the FKs to staff/customers)
const old = await must(db.from('businesses').select('id').or(`is_demo.eq.true,slug.eq.${SLUG}`));
if (old.length) {
  const ids = old.map((b) => b.id);
  await must(db.from('bookings').delete().in('business_id', ids));
  await must(db.from('businesses').delete().in('id', ids));
}

// 2. salon, staff, services, hours
const salon = await must(db.from('businesses').insert({
  name: 'Glow Salon', slug: SLUG, address: 'Shop 4, MG Road, Pune', is_demo: true,
  customer_note: 'Parking behind the building. Please arrive 5 minutes early.',
}).select('id').single());
const biz = salon.id;
const staff = await must(db.from('staff').insert(['Ravi', 'Bina', 'Kiran'].map((name) => ({ business_id: biz, name }))).select('id, name'));
const services = await must(db.from('services').insert([
  ['Haircut', 40, 30000, 0], ['Beard trim', 20, 15000, 0], ['Hair colour', 90, 150000, 30000], ['Head massage', 30, 40000, 0],
].map(([name, duration_min, price_paise, deposit_paise]) => ({ business_id: biz, name, duration_min, price_paise, deposit_paise }))).select('*'));
await must(db.from('staff_services').insert(staff.flatMap((s) => services.map((v) => ({ business_id: biz, staff_id: s.id, service_id: v.id })))));
await must(db.from('working_hours').insert(staff.flatMap((s, i) => [0, 1, 2, 3, 4, 5, 6]
  .filter((d) => d !== i + 1)   // each stylist has one day off (Mon / Tue / Wed)
  .flatMap((weekday) => [['10:00', '13:00'], ['14:00', '20:00']]
    .map(([start_time, end_time]) => ({ business_id: biz, staff_id: s.id, weekday, start_time, end_time }))))));

// 3. customers (fake numbers in the 98000 000xx range)
const people = ['Priya Sharma', 'Rahul Verma', 'Ananya Iyer', 'Vikram Singh', 'Sneha Patil', 'Arjun Nair',
  'Meera Joshi', 'Karan Mehta', 'Pooja Desai', 'Rohan Kulkarni', 'Divya Rao', 'Aditya Kapoor'];
const customers = await must(db.from('customers').insert(people.map((name, i) => ({
  business_id: biz, name, phone: `98000000${String(i + 10)}`,
  trusted: i === 0, blocked: i === people.length - 1,
  notes: i === 0 ? 'Regular since 2024. Prefers Bina.' : i === people.length - 1 ? 'Booked 3 times, never came.' : null,
}))).select('id, name, trusted, blocked'));
const regulars = customers.filter((c) => !c.blocked);

// 4. bookings: 6 days back to 2 days ahead, ~2/3 of each stylist's slots filled.
// Each slot is 90 minutes apart, so even the longest service never overlaps.
const TIMES = ['10:00', '11:30', '14:00', '15:30', '17:00', '18:30'];
const now = new Date();
const days = upcomingDates(TZ, 3);
const back = (n) => new Date(Date.parse(days[0] + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
const dates = [6, 5, 4, 3, 2, 1].map(back).concat(days);
const bookings = [];
let n = 0;
dates.forEach((date, d) => staff.forEach((s, si) => TIMES.forEach((time, t) => {
  if ((d * 7 + si * 3 + t) % 3 === 0) return;
  const service = services[(d + si + t) % services.length];
  const customer = regulars[n++ % regulars.length];
  const start = localToUtc(`${date}T${time}`, TZ);
  const end = new Date(start.getTime() + service.duration_min * 60000);
  const status = end > now ? 'confirmed' : !customer.trusted && (d + si + t) % 9 === 0 ? 'no_show' : 'completed';
  bookings.push({
    business_id: biz, staff_id: s.id, service_id: service.id, customer_id: customer.id, booked_name: customer.name,
    slot: `[${start.toISOString()},${end.toISOString()})`, status, source: t % 3 === 1 ? 'manual' : 'online',
    deposit_paise: customer.trusted ? 0 : service.deposit_paise,
  });
})));
await must(db.from('bookings').insert(bookings));
for (const c of customers) {
  const noShows = bookings.filter((b) => b.customer_id === c.id && b.status === 'no_show').length + (c.blocked ? 3 : 0);
  if (noShows) await must(db.from('customers').update({ no_show_count: noShows }).eq('id', c.id));
}

// 5. logins: the viewer (password reset every run) and an optional owner
async function userId(email, create) {
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const found = data.users.find((u) => u.email === email);
  if (found || !create) return found?.id;
  const { data: made, error: e } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (e) throw e;
  return made.user.id;
}
const viewer = await userId(VIEWER, true);
const { error: pwError } = await db.auth.admin.updateUserById(viewer, { password });
if (pwError) throw pwError;
const members = [{ user_id: viewer, business_id: biz, role: 'viewer' }];
if (ownerEmail) {
  const owner = await userId(ownerEmail, false);
  if (!owner) throw new Error(`No user ${ownerEmail}`);
  members.push({ user_id: owner, business_id: biz, role: 'owner' });
}
await must(db.from('memberships').insert(members));

console.log(`Demo reset: ${staff.length} staff, ${customers.length} customers, ${bookings.length} bookings at /b/${SLUG}.`);
