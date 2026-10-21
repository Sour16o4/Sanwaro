// Concurrency checks pgTAP can't do (it runs in one connection): 18, 19, 40, 42, 50
// and walk-ins vs online holds. Runs against LOCAL Supabase only.
//   npm run test:race
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  throw new Error('Race tests write real rows: point DATABASE_URL at local Supabase only.');
}
const pool = new pg.Pool({ connectionString: url, max: 60 });
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const tag = Date.now().toString(36);
let biz, svc, ravi, staffIds;

// Fires all calls at once, each on its own connection; returns fulfilled/rejected results.
const together = (n, fn) => Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)));
const errors = (results) => results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);

before(async () => {
  // A salon whose clock reads about noon right now, so walk-ins always have room today.
  const offset = 12 - new Date().getUTCHours();
  const tz = offset > 0 ? `Etc/GMT-${offset}` : offset < 0 ? `Etc/GMT+${-offset}` : 'Etc/GMT';
  [{ id: biz }] = await q(
    `insert into businesses (name, slug, timezone) values ('Race Salon', $1, $2) returning id`,
    [`race-${tag}`, tz]);
  staffIds = (await q(
    `insert into staff (business_id, name) select $1, unnest(array['Ravi','Bina','Kiran']) returning id`,
    [biz])).map((r) => r.id);
  ravi = staffIds[0];
  [{ id: svc }] = await q(
    `insert into services (business_id, name, duration_min, price_paise, deposit_paise)
     values ($1, 'Haircut', 30, 30000, 10000) returning id`, [biz]);
  await q(`insert into staff_services (business_id, staff_id, service_id)
           select $1, unnest($2::uuid[]), $3`, [biz, staffIds, svc]);
  await q(`insert into working_hours (business_id, staff_id, weekday, start_time, end_time)
           select $1, s, d, '06:00', '22:00' from unnest($2::uuid[]) s, generate_series(0, 6) d`,
          [biz, staffIds]);
});

after(async () => {
  await q('delete from bookings where business_id = $1', [biz]);
  await q('delete from businesses where id = $1', [biz]);
  await q(`delete from rate_events where key like $1`, [`race-${tag}%`]);
  await pool.end();
});

// local time tomorrow / day after, in the salon's timezone
const at = async (days, time) =>
  (await q(`select (((now() at time zone b.timezone)::date + $2::int) + $3::time) at time zone b.timezone as t
            from businesses b where id = $1`, [biz, days, time]))[0].t;

const hold = (staff, start, phone, key = null) =>
  q('select * from create_hold($1, $2, $3, $4, $5, $6, $7)', [biz, staff, svc, start, 'Racer', phone, key]);

const overlaps = async () => (await q(
  `select count(*)::int as n from bookings a join bookings b
     on a.staff_id = b.staff_id and a.id < b.id and a.slot && b.slot
   where a.business_id = $1 and a.status in ('held','confirmed') and b.status in ('held','confirmed')`,
  [biz]))[0].n;

test('18: 50 customers grab the same slot at once -> exactly 1 booking', async () => {
  const start = await at(1, '10:00');
  const results = await together(50, (i) => hold(ravi, start, `98${String(i).padStart(8, '0')}`));
  const won = results.filter((r) => r.status === 'fulfilled').length;
  assert.equal(won, 1);
  assert.deepEqual([...new Set(errors(results))], ['SLOT_TAKEN']);
  const [{ n }] = await q(`select count(*)::int as n from bookings
                           where staff_id = $1 and lower(slot) = $2 and status = 'held'`, [ravi, start]);
  assert.equal(n, 1);
});

test('19: one phone tries 10 slots at once -> exactly 1 hold', async () => {
  const starts = await Promise.all(Array.from({ length: 10 }, (_, i) => at(2, `${10 + i}:00`)));
  const results = await together(10, (i) => hold(ravi, starts[i], '9700000001'));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.deepEqual([...new Set(errors(results))], ['ACTIVE_HOLD_EXISTS']);
});

test('42: rate limiter under 20 parallel calls lets exactly the limit through', async () => {
  const results = await together(20, () =>
    q('select check_rate($1, 5, 60) as ok', [`race-${tag}:phone`]).then((r) => r[0].ok));
  assert.equal(results.filter((r) => r.value === true).length, 5);
});

test('40: two workers claim notifications together -> no message claimed twice', async () => {
  // ₹0 bookings are confirmed at once and schedule a confirmation that is due now
  await q('update services set deposit_paise = 0 where id = $1', [svc]);
  for (let i = 0; i < 12; i++) {
    await hold(staffIds[1], await at(3, `${8 + i}:00`), `96000000${String(i).padStart(2, '0')}`);
  }
  await q('update services set deposit_paise = 10000 where id = $1', [svc]);
  const due = (await q(`select count(*)::int as n from notifications
                        where business_id = $1 and status = 'pending' and send_at <= now()`, [biz]))[0].n;
  const [a, b] = await Promise.all([1, 2].map(() =>
    q(`select notification_id from claim_due_notifications(100)`).then((r) => r.map((x) => x.notification_id))));
  const mine = new Set((await q('select id from notifications where business_id = $1', [biz])).map((r) => r.id));
  const claimed = [...a, ...b].filter((id) => mine.has(id));
  assert.equal(due, 12);
  assert.equal(claimed.length, new Set(claimed).size, 'a message was claimed twice');
  assert.equal(claimed.length, due);
});

test('50: 15 walk-ins join at the same moment -> all placed, 0 overlaps', async () => {
  const results = await together(15, (i) =>
    q('select * from join_walkin_queue($1, $2, $3, $4)', [biz, svc, `Walker ${i}`, `95000000${String(i).padStart(2, '0')}`]));
  assert.deepEqual(errors(results), []);
  assert.equal(await overlaps(), 0);
});

test('walk-ins and online holds fired together -> 0 overlaps, online winners keep their slots', async () => {
  // online customers aim at the next hours today, while walk-ins pour in
  const [{ base }] = await q(
    `select to_timestamp(ceil(extract(epoch from now()) / 1800) * 1800) + interval '2 hours' as base`);
  const online = together(9, (i) =>
    hold(staffIds[i % 3], new Date(base.getTime() + Math.floor(i / 3) * 30 * 60000), `94000000${String(i).padStart(2, '0')}`));
  const walkins = together(10, (i) =>
    q('select * from join_walkin_queue($1, $2, $3, $4)', [biz, svc, `Late walker ${i}`, `93000000${String(i).padStart(2, '0')}`]));
  const [onlineResults] = await Promise.all([online, walkins]);
  const winners = onlineResults.filter((r) => r.status === 'fulfilled').map((r) => r.value[0].booking_id);
  const [{ n }] = await q(`select count(*)::int as n from bookings where id = any($1) and status = 'held'`, [winners]);
  assert.equal(n, winners.length, 'an online winner lost their slot');
  assert.equal(await overlaps(), 0);
});
