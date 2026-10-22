// API tests for /api/slots and /api/hold against `next dev` + local Supabase.
//   npm run dev   (in another terminal)   then   npm run test:api
// Each test sends its own fake client IP (x-forwarded-for) so rate limits don't collide.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB)) throw new Error('API tests write data: local Supabase only.');

const db = new pg.Pool({ connectionString: DB });
const q = (sql, params) => db.query(sql, params).then((r) => r.rows);
const SLUG = 'api-test-salon';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';   // Cloudflare's test token, accepted by the test secret
let salonId, free, paid, asha, bina;
let ipCounter = 0;
const newIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
const uuid = () => crypto.randomUUID();
let phoneCounter = 0;
const newPhone = () => `90000${String(Date.now() % 1000).padStart(3, '0')}${String(++phoneCounter).padStart(2, '0')}`;

before(async () => {
  await q(`delete from rate_events where key like 'hold:phone:90000%' or key like '%:ip:10.0.%'`);
  await q('delete from bookings where business_id in (select id from businesses where slug = $1)', [SLUG]);
  await q('delete from businesses where slug = $1', [SLUG]);
  [{ id: salonId }] = await q(`insert into businesses (name, slug) values ('API Test Salon', $1) returning id`, [SLUG]);
  [{ id: asha }, { id: bina }] = await q(
    `insert into staff (business_id, name) values ($1, 'Asha'), ($1, 'Bina') returning id`, [salonId]);
  [{ id: free }, { id: paid }] = await q(
    `insert into services (business_id, name, duration_min, price_paise, deposit_paise)
     values ($1, 'Haircut', 30, 30000, 0), ($1, 'Colour', 60, 150000, 30000) returning id`, [salonId]);
  await q(`insert into staff_services (business_id, staff_id, service_id)
           select $1, s, v from unnest($2::uuid[]) s, unnest($3::uuid[]) v`, [salonId, [asha, bina], [free, paid]]);
  await q(`insert into working_hours (business_id, staff_id, weekday, start_time, end_time)
           select $1, s, d, '09:00', '21:00' from unnest($2::uuid[]) s, generate_series(0, 6) d`, [salonId, [asha, bina]]);
});

after(async () => {
  await q('delete from bookings where business_id = $1', [salonId]);
  await q('delete from businesses where id = $1', [salonId]);
  await db.end();
});

// local IST time `days` from today as ISO, e.g. at(1, '10:00')
const at = async (days, time) => (await q(
  `select ((((now() at time zone 'Asia/Kolkata')::date + $1::int) + $2::time) at time zone 'Asia/Kolkata') as t`,
  [days, time]))[0].t.toISOString();
const dateOf = async (days) => (await q(`select ((now() at time zone 'Asia/Kolkata')::date + $1::int)::text as d`, [days]))[0].d;

const slots = (params, ip = newIp()) =>
  fetch(`${BASE}/api/slots?${new URLSearchParams({ salon: SLUG, ...params })}`, { headers: { 'x-forwarded-for': ip } });

async function hold(over = {}, ip = newIp()) {
  const res = await fetch(`${BASE}/api/hold`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ salon: SLUG, serviceId: free, staffId: 'any', name: 'Test', phone: newPhone(),
      holdKey: uuid(), turnstileToken: TOKEN, website: '', ...over }),
  });
  return { status: res.status, body: await res.json() };
}

test('slots: one list per stylist, "any" deduplicated by time', async () => {
  const date = await dateOf(2);
  const one = await (await slots({ service: free, date, staff: asha })).json();
  const any = await (await slots({ service: free, date, staff: 'any' })).json();
  assert.equal(one.length, 47);              // 09:00..20:30 every 15 min for a 30-min service
  assert.equal(any.length, one.length);      // both stylists work the same hours
  assert.equal(new Set(any.map((s) => s.start)).size, any.length);
  assert.equal(one[0].staffName, 'Asha');
});

test('slots: unknown salon 404, bad date 400', async () => {
  assert.equal((await fetch(`${BASE}/api/slots?salon=nope-nope&service=${free}&date=2030-01-01`)).status, 404);
  assert.equal((await slots({ service: free, date: '24-10-2026' })).status, 400);
});

test('hold: no-deposit service is confirmed; deposit service is held with a reason', async () => {
  const a = await hold({ start: await at(1, '09:00'), staffId: asha });
  assert.equal(a.status, 200);
  assert.equal(a.body.status, 'confirmed');
  assert.equal(a.body.depositReason, 'Pay at the salon');
  const b = await hold({ start: await at(1, '11:00'), staffId: asha, serviceId: paid });
  assert.equal(b.body.status, 'held');
  assert.equal(b.body.deposit, 30000);
  assert.equal(b.body.depositReason, 'A small deposit holds your slot');
  assert.ok(new Date(b.body.holdExpiresAt) > new Date());
});

test('hold: the same slot twice -> 409 SLOT_TAKEN', async () => {
  const start = await at(1, '13:00');
  assert.equal((await hold({ start, staffId: asha })).status, 200);
  const again = await hold({ start, staffId: asha });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'SLOT_TAKEN');
});

test('hold: "any" falls through to the next free stylist, then reports SLOT_TAKEN', async () => {
  const start = await at(1, '15:00');
  await hold({ start, staffId: asha });
  const any = await hold({ start });
  assert.equal(any.status, 200);
  assert.equal(any.body.staffId, bina);
  assert.equal((await hold({ start })).body.error, 'SLOT_TAKEN');
});

test('hold: same browser can switch slots; another browser with the same phone cannot', async () => {
  const phone = newPhone(), key = uuid();
  const first = await hold({ start: await at(3, '10:00'), serviceId: paid, phone, holdKey: key });
  const second = await hold({ start: await at(3, '12:00'), serviceId: paid, phone, holdKey: key });
  assert.equal(second.status, 200);
  const [{ status }] = await q('select status from bookings where id = $1', [first.body.bookingId]);
  assert.equal(status, 'cancelled');
  const stranger = await hold({ start: await at(3, '14:00'), serviceId: paid, phone, holdKey: uuid() });
  assert.equal(stranger.status, 409);
  assert.equal(stranger.body.error, 'ACTIVE_HOLD_EXISTS');
});

test('hold: bots - no Turnstile 403, honeypot stores nothing, bad phone 400', async () => {
  const start = await at(4, '10:00');
  assert.equal((await hold({ start, turnstileToken: '' })).status, 403);
  const before = (await q('select count(*)::int n from bookings where business_id = $1', [salonId]))[0].n;
  const bot = await hold({ start, website: 'http://spam.example' });
  assert.equal(bot.status, 200);
  assert.equal((await q('select count(*)::int n from bookings where business_id = $1', [salonId]))[0].n, before);
  const bad = await hold({ start, phone: '12345' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /10-digit/);
  assert.equal((await hold({ start, phone: '+91 98765-43210' })).status, 200);   // normalised
});

test('hold: 4th attempt for one phone in an hour -> 429', async () => {
  const phone = newPhone(), key = uuid();
  for (const t of ['10:00', '11:00', '12:00']) {
    assert.equal((await hold({ start: await at(5, t), serviceId: paid, phone, holdKey: key })).status, 200);
  }
  assert.equal((await hold({ start: await at(5, '13:00'), serviceId: paid, phone, holdKey: key })).status, 429);
});

test('hold: 21st hold from one IP in an hour -> 429 (generous: shared mobile IPs)', async () => {
  const ip = newIp();
  for (let i = 0; i < 20; i++) {
    const r = await hold({ start: await at(6, `${9 + Math.floor(i / 2)}:${i % 2 ? '30' : '00'}`), staffId: asha }, ip);
    assert.equal(r.status, 200, `hold ${i + 1}`);
  }
  assert.equal((await hold({ start: await at(7, '10:00') }, ip)).status, 429);
});

test('slots: 121st request in a minute from one IP -> 429', async () => {
  const ip = newIp(), date = await dateOf(2);
  const codes = await Promise.all(Array.from({ length: 121 }, () => slots({ service: free, date }, ip).then((r) => r.status)));
  assert.equal(codes.filter((c) => c === 429).length, 1);
});
