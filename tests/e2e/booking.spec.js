// Phase 3 "done when": two browsers clicking one slot never both win.
// Real booking page, real Turnstile widget (Cloudflare test keys), local Supabase.
import { test, expect } from '@playwright/test';
import pg from 'pg';

const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SLUG = 'e2e-booking-salon';

test.beforeAll(async () => {
  if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB)) throw new Error('E2E resets data: local Supabase only.');
  const db = new pg.Client(DB);
  await db.connect();
  await db.query(`delete from rate_events where key like 'hold:%'`);
  await db.query(`delete from bookings where business_id in (select id from businesses where slug = $1)`, [SLUG]);
  await db.query(`delete from businesses where slug = $1`, [SLUG]);
  const { rows: [{ id }] } = await db.query(
    `insert into businesses (name, slug, customer_note) values ('E2E Salon', $1, 'Ring the side bell.') returning id`, [SLUG]);
  await db.query(`insert into staff (business_id, name) values ($1, 'Ravi')`, [id]);
  await db.query(`insert into services (business_id, name, duration_min, price_paise, deposit_paise)
                  values ($1, 'Haircut', 30, 30000, 0), ($1, 'Colour', 60, 150000, 30000)`, [id]);
  await db.query(`insert into staff_services (business_id, staff_id, service_id)
                  select $1, s.id, v.id from staff s join services v on v.business_id = s.business_id where s.business_id = $1`, [id]);
  await db.query(`insert into working_hours (business_id, staff_id, weekday, start_time, end_time)
                  select $1, id, d, '09:00', '21:00' from staff, generate_series(0, 6) d where business_id = $1`, [id]);
  await db.end();
});

// Service -> Ravi -> Tomorrow -> first free time -> details, ready to submit.
async function pickFirstSlot(page, service, phone, settleMs = 0) {
  await page.goto(`/b/${SLUG}`);
  await page.getByRole('button', { name: new RegExp(`^${service}`) }).click();
  await page.getByRole('button', { name: 'Ravi', exact: true }).click();
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await page.waitForTimeout(settleMs);
  await page.locator('section', { hasText: '4. Time' }).getByRole('button').first().click();
  await page.getByLabel('Name').fill('Test Customer');
  await page.getByLabel('Mobile number').fill(phone);
  // wait for Turnstile to hand over its token
  await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue('', { timeout: 15000 });
}

const ist = (days, opts) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...opts })
  .format(new Date(Date.now() + days * 86400000));

test('a customer books a no-deposit service and gets a booking link', async ({ page }) => {
  // Make "today" slots answer late: they must not replace "Tomorrow" (regression).
  const today = ist(0, { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-');
  await page.route(`**/api/slots?*date=${today}*`, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await pickFirstSlot(page, 'Haircut', '9811100001', 2000);   // pick after the slow answer lands
  await expect(page.getByText('Cancel at least 24 hours before')).toBeVisible();   // policy before booking
  await page.getByRole('button', { name: 'Book this time' }).click();
  await expect(page.getByRole('heading', { name: 'Booked!' })).toBeVisible();
  await expect(page.getByText(ist(1, { weekday: 'long', day: 'numeric', month: 'long' }))).toBeVisible();
  await expect(page.getByText('₹300 at the salon')).toBeVisible();
  await expect(page.getByText('Ring the side bell.')).toBeVisible();

  const link = await page.getByLabel('Booking link').inputValue();
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Confirmed' })).toBeVisible();
  await expect(page.getByText('Test Customer')).toBeVisible();
});

test('a deposit service is held and shows the split', async ({ page }) => {
  await pickFirstSlot(page, 'Colour', '9811100002');
  await page.getByRole('button', { name: 'Book this time' }).click();
  await expect(page.getByRole('heading', { name: 'Your slot is held' })).toBeVisible();
  await expect(page.getByText('₹300 now, ₹1,200 at the salon')).toBeVisible();
  await expect(page.getByText('A small deposit holds your slot')).toBeVisible();
});

test('two browsers click the same slot: exactly one wins', async ({ browser }) => {
  const [a, b] = await Promise.all([browser.newContext(), browser.newContext()]);
  const [pa, pb] = await Promise.all([a.newPage(), b.newPage()]);
  await pickFirstSlot(pa, 'Haircut', '9811100003');
  await pickFirstSlot(pb, 'Haircut', '9811100004');

  await Promise.all([
    pa.getByRole('button', { name: 'Book this time' }).click(),
    pb.getByRole('button', { name: 'Book this time' }).click(),
  ]);
  const outcome = (p) => Promise.race([
    p.getByRole('heading', { name: 'Booked!' }).waitFor().then(() => 'won'),
    p.getByText('Someone just booked this slot').waitFor().then(() => 'lost'),
  ]);
  expect((await Promise.all([outcome(pa), outcome(pb)])).sort()).toEqual(['lost', 'won']);
  await Promise.all([a.close(), b.close()]);
});
