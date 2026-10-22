// Phase 4 "done when": an owner runs a day from the dashboard; the demo login can't change anything.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const OWNER = 'owner3@sanwaro.test';
let db, dates;

test.beforeAll(async () => {
  if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB)) throw new Error('E2E resets data: local Supabase only.');
  db = new pg.Client(DB);
  await db.connect();
  const mine = `select business_id from memberships m join auth.users u on u.id = m.user_id where u.email = '${OWNER}'`;
  await db.query(`delete from bookings where business_id in (${mine})`);
  await db.query(`delete from businesses where id in (${mine})`);
  await db.query(`delete from businesses where slug = 'e2e-dash-salon'`);

  const { rows: [{ id }] } = await db.query(`insert into businesses (name, slug) values ('Dash Salon', 'e2e-dash-salon') returning id`);
  await db.query(`insert into memberships (user_id, business_id, role) select id, $1, 'owner' from auth.users where email = $2`, [id, OWNER]);
  const { rows: [{ id: staff }] } = await db.query(`insert into staff (business_id, name) values ($1, 'Asha') returning id`, [id]);
  const { rows: [{ id: service }] } = await db.query(
    `insert into services (business_id, name, duration_min, price_paise) values ($1, 'Haircut', 30, 30000) returning id`, [id]);
  await db.query(`insert into staff_services (business_id, staff_id, service_id) values ($1, $2, $3)`, [id, staff, service]);
  await db.query(`insert into working_hours (business_id, staff_id, weekday, start_time, end_time)
                  select $1, $2, d, '09:00', '21:00' from generate_series(0, 6) d`, [id, staff]);
  const { rows: [neha, kabir] } = await db.query(`insert into customers (business_id, name, phone)
    values ($1, 'Neha Past', '9811111111'), ($1, 'Kabir Future', '9811111112') returning id`, [id]);
  // one visit that started 2 hours ago, one 3 hours from now
  await db.query(`insert into bookings (business_id, staff_id, service_id, customer_id, slot, status, booked_name)
    values ($1, $2, $3, $4, tstzrange(now() - interval '2 hours', now() - interval '90 minutes'), 'confirmed', 'Neha Past'),
           ($1, $2, $3, $5, tstzrange(now() + interval '3 hours', now() + interval '210 minutes'), 'confirmed', 'Kabir Future')`,
  [id, staff, service, neha.id, kabir.id]);
  const istDate = (expr) => `((${expr}) at time zone 'Asia/Kolkata')::date::text`;
  ({ rows: [dates] } = await db.query(`select ${istDate("now() - interval '2 hours'")} past,
    ${istDate("now() + interval '3 hours'")} future, ${istDate("now() + interval '2 days'")} later`));
});

test.afterAll(() => db.end());

async function signIn(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

const row = (page, name) => page.locator('li', { hasText: name });

test('an owner runs a day: completed, no-show, cancel, phone booking, trusted customer', async ({ page }) => {
  await signIn(page, OWNER);

  await page.goto(`/dashboard?date=${dates.past}`);
  await row(page, 'Neha Past').getByRole('button', { name: 'Completed' }).click();
  await expect(page.getByText('Marked completed.')).toBeVisible();
  await row(page, 'Neha Past').getByRole('button', { name: 'No-show' }).click();   // owner corrects it
  await expect(page.getByText('Marked as no-show.')).toBeVisible();
  await expect(row(page, 'Neha Past').getByText('1 no-show')).toBeVisible();
  const { rows: [neha] } = await db.query(`select no_show_count from customers where phone = '9811111111'`);
  expect(neha.no_show_count).toBe(1);

  await page.goto(`/dashboard?date=${dates.future}`);
  await expect(row(page, 'Kabir Future').getByRole('button', { name: 'No-show' })).toHaveCount(0);   // not started yet
  await row(page, 'Kabir Future').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Booking cancelled.')).toBeVisible();
  await expect(row(page, 'Kabir Future').getByText('Cancelled')).toBeVisible();

  // phone booking, then the same slot again
  for (const expected of [/Booked Phone Person at 11:00/, 'That stylist already has a booking at that time.']) {
    await page.goto(`/dashboard?date=${dates.later}`);
    const form = page.locator('details:visible', { hasText: 'Add a phone booking' });
    if ((await form.getAttribute('open')) === null) await form.locator('summary').click();
    await form.getByLabel('Time').fill('11:00');
    await form.getByLabel('Customer name').fill('Phone Person');
    await form.getByLabel('Mobile number').fill('98222 22222');
    await form.getByRole('button', { name: 'Add booking' }).click();
    await expect(page.getByText(expected)).toBeVisible();
  }
  await expect(row(page, 'Phone Person')).toHaveCount(1);

  await page.goto('/dashboard/customers?q=98222');
  await page.getByRole('link', { name: /Phone Person/ }).click();
  await page.getByLabel(/Trusted/).check();
  await page.getByLabel('Notes (only you see these)').fill('Regular, pays cash.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(row(page, 'Haircut')).toHaveCount(1);   // history
  const { rows: [c] } = await db.query(`select trusted, notes from customers where phone = '9822222222'`);
  expect(c).toEqual({ trusted: true, notes: 'Regular, pays cash.' });
});

test('the demo login sees a busy salon and cannot change it', async ({ page }) => {
  execFileSync('node', ['--env-file=.env.local', 'scripts/demo-reset.mjs', 'demo@sanwaro.test']);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Try the demo salon (read-only)' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Demo · read-only')).toBeVisible();
  await expect(page.getByText('Add a phone booking')).toHaveCount(0);   // owner-only form

  await page.goto('/dashboard/bookings?view=past');
  const before = (await db.query(`select count(*)::int n from bookings b join businesses s on s.id = b.business_id
                                  where s.slug = 'glow-salon' and b.status = 'no_show'`)).rows[0].n;
  await page.getByRole('button', { name: 'No-show' }).first().click();
  await expect(page.getByText('This is a read-only demo.', { exact: false })).toBeVisible();
  const after = (await db.query(`select count(*)::int n from bookings b join businesses s on s.id = b.business_id
                                 where s.slug = 'glow-salon' and b.status = 'no_show'`)).rows[0].n;
  expect(after).toBe(before);
});
