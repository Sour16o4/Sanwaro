// Phase 5 "done when", without real money: signed Checkout callbacks and webhooks
// against `next dev` + local Supabase. Secrets come from .env.local (npm run test:api).
// Payment ids are fake, so refunds to Razorpay fail and stay refund_pending (the sweep retries).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB)) throw new Error('API tests write data: local Supabase only.');
const { RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: HOOK_SECRET, NOTIFY_SECRET } = process.env;

const db = new pg.Pool({ connectionString: DB });
const q = (sql, params) => db.query(sql, params).then((r) => r.rows);
const SLUG = 'api-pay-salon';
let salonId, staffId, serviceId, phoneN = 0;
const sign = (secret, data) => createHmac('sha256', secret).update(data).digest('hex');
const post = async (path, body, headers = {}) => {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: res.status, body: await res.text().then((t) => { try { return JSON.parse(t); } catch { return t; } }) };
};

before(async () => {
  await q('delete from bookings where business_id in (select id from businesses where slug = $1)', [SLUG]);
  await q('delete from businesses where slug = $1', [SLUG]);
  [{ id: salonId }] = await q(`insert into businesses (name, slug) values ('API Pay Salon', $1) returning id`, [SLUG]);
  [{ id: staffId }] = await q(`insert into staff (business_id, name) values ($1, 'Asha') returning id`, [salonId]);
  [{ id: serviceId }] = await q(`insert into services (business_id, name, duration_min, price_paise, deposit_paise)
                                 values ($1, 'Colour', 60, 150000, 30000) returning id`, [salonId]);
});

after(async () => {
  await q('delete from bookings where business_id = $1', [salonId]);
  await q('delete from businesses where id = $1', [salonId]);
  await db.end();
});

// A booking `hoursAhead` from now with an unpaid Razorpay order for its deposit.
async function booking({ hoursAhead, status = 'held', withOrder = true }) {
  const [{ id: customer }] = await q(`insert into customers (business_id, name, phone) values ($1, 'Pay Test', $2) returning id`,
    [salonId, `91000000${String(++phoneN).padStart(2, '0')}`]);
  const holdKey = randomUUID();
  const [{ id }] = await q(`insert into bookings (business_id, staff_id, service_id, customer_id, slot, status,
      hold_expires_at, deposit_paise, hold_key, booked_name)
    values ($1, $2, $3, $4, tstzrange(now() + make_interval(hours => $5), now() + make_interval(hours => $5 + 1)), $6,
      case $6 when 'held' then now() + interval '5 minutes' when 'expired' then now() - interval '1 minute' end, 30000, $7, 'Pay Test')
    returning id`, [salonId, staffId, serviceId, customer, hoursAhead, status, holdKey]);
  const orderId = `order_test_${randomUUID().slice(0, 8)}`;
  if (withOrder) {
    await q(`insert into payments (business_id, booking_id, razorpay_order_id, amount_paise) values ($1, $2, $3, 30000)`,
      [salonId, id, orderId]);
  }
  return { id, orderId, holdKey, paymentId: `pay_test_${randomUUID().slice(0, 8)}` };
}

const state = async (b) => (await q(`select bk.status booking, p.status payment, p.razorpay_payment_id, p.updated_at,
  (select count(*)::int from notifications n where n.booking_id = bk.id) notifications
  from bookings bk left join payments p on p.booking_id = bk.id where bk.id = $1`, [b.id]))[0];
const verify = (b, signature = sign(KEY_SECRET, `${b.orderId}|${b.paymentId}`)) =>
  post('/api/payments/verify', { orderId: b.orderId, paymentId: b.paymentId, signature });
function webhook(b, amount = 30000, event = 'payment.captured') {
  const raw = JSON.stringify({ event, payload: { payment: { entity: { id: b.paymentId, order_id: b.orderId, amount } } } });
  return post('/api/payments/webhook', raw, { 'x-razorpay-signature': sign(HOOK_SECRET, raw) });
}

test('checkout success confirms the booking and schedules messages', async () => {
  const b = await booking({ hoursAhead: 30 });
  const r = await verify(b);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: 'confirmed' });
  const s = await state(b);
  assert.equal(s.booking, 'confirmed');
  assert.equal(s.payment, 'captured');
  assert.equal(s.razorpay_payment_id, b.paymentId);
  assert.equal(s.notifications, 3);   // confirmation + 24 h + 2 h
});

test('duplicate callbacks and webhooks change nothing', async () => {
  const b = await booking({ hoursAhead: 31 });
  await verify(b);
  const first = await state(b);
  assert.equal((await verify(b)).body.status, 'confirmed');
  assert.equal((await webhook(b)).status, 200);
  assert.equal((await webhook(b)).status, 200);
  assert.deepEqual(await state(b), first);
});

test('the webhook alone confirms (customer closed the tab)', async () => {
  const b = await booking({ hoursAhead: 32 });
  assert.equal((await webhook(b)).status, 200);
  assert.equal((await state(b)).booking, 'confirmed');
});

test('forged signatures are refused and change nothing', async () => {
  const b = await booking({ hoursAhead: 33 });
  assert.equal((await verify(b, sign('wrong-secret', `${b.orderId}|${b.paymentId}`))).status, 400);
  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: b.paymentId, order_id: b.orderId, amount: 30000 } } } });
  assert.equal((await post('/api/payments/webhook', raw, { 'x-razorpay-signature': sign('wrong', raw) })).status, 400);
  assert.equal((await post('/api/payments/webhook', raw)).status, 400);
  const s = await state(b);
  assert.equal(s.booking, 'held');
  assert.equal(s.payment, 'created');
});

test('a wrong amount is not accepted', async () => {
  const b = await booking({ hoursAhead: 34 });
  assert.equal((await webhook(b, 100)).status, 200);   // acknowledged, so Razorpay stops retrying
  const s = await state(b);
  assert.equal(s.booking, 'held');
  assert.equal(s.payment, 'created');
});

test('late payment for a slot someone else took -> refund, never a double booking', async () => {
  const late = await booking({ hoursAhead: 40, status: 'expired' });
  const [{ slot }] = await q('select slot::text from bookings where id = $1', [late.id]);
  const [{ id: customer }] = await q(`insert into customers (business_id, name, phone) values ($1, 'Other', '9100000099') returning id`, [salonId]);
  await q(`insert into bookings (business_id, staff_id, service_id, customer_id, slot, status)
           values ($1, $2, $3, $4, $5::tstzrange, 'confirmed')`, [salonId, staffId, serviceId, customer, slot]);

  const r = await verify(late);
  assert.equal(r.body.status, 'refunded');
  const s = await state(late);
  assert.equal(s.booking, 'expired');
  assert.equal(s.payment, 'refund_pending');   // fake payment id: Razorpay refund fails, the sweep retries
  assert.equal((await q(`select count(*)::int n from bookings where business_id = $1 and slot && $2::tstzrange
                         and status in ('held', 'confirmed')`, [salonId, slot]))[0].n, 1);
});

test('late payment while the slot is still free -> booking revived', async () => {
  const late = await booking({ hoursAhead: 42, status: 'expired' });
  assert.equal((await webhook(late)).status, 200);
  assert.equal((await state(late)).booking, 'confirmed');
});

test('order: refused when payments are off or the hold is not yours', async () => {
  const b = await booking({ hoursAhead: 44, withOrder: false });
  const r = await post('/api/payments/order', { bookingId: b.id, holdKey: randomUUID() });
  assert.equal(r.status, process.env.RAZORPAY_KEY_ID ? 409 : 503);
});

test('refund sweep needs the secret', async () => {
  assert.equal((await post('/api/payments/sweep', {})).status, 403);
  assert.equal((await post('/api/payments/sweep', {}, { 'x-notify-secret': 'nope' })).status, 403);
  const r = await post('/api/payments/sweep', {}, { 'x-notify-secret': NOTIFY_SECRET });
  assert.equal(r.status, 200);
  assert.ok(r.body.pending >= 1);
});
