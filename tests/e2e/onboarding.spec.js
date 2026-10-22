// Phase 2 "done when": a new owner sets up a salon; salon B sees nothing of salon A.
// Uses the local seed logins (supabase/seed.sql) and starts from a clean slate each run.
import { test, expect } from '@playwright/test';
import pg from 'pg';

const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

test.beforeAll(async () => {
  if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB)) throw new Error('E2E resets data: local Supabase only.');
  const db = new pg.Client(DB);
  await db.connect();
  await db.query(`delete from businesses where id in (
    select business_id from memberships m join auth.users u on u.id = m.user_id
    where u.email in ('owner1@sanwaro.test', 'owner2@sanwaro.test'))`);
  await db.end();
});

async function signIn(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const formWith = (page, button) => page.locator('form').filter({ has: page.getByRole('button', { name: button }) });

test('signed-out visitors are sent to the login page', async ({ page }) => {
  await page.goto('/dashboard/services');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fservices/);
});

test('a new owner sets up a salon from scratch', async ({ page }) => {
  await signIn(page, 'owner1@sanwaro.test');
  await expect(page).toHaveURL(/\/onboarding/);

  await page.getByLabel('Salon name', { exact: true }).fill('Glow Test Salon');
  await page.getByRole('button', { name: 'Create salon' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByText('Glow Test Salon', { exact: true })).toBeVisible();
  await expect(page.getByText('/b/glow-test-salon')).toBeVisible();
  await expect(page.getByText('Finish setting up')).toBeVisible();

  // services: deposit above price is refused, a valid one is listed with the split
  await page.getByRole('link', { name: 'Services', exact: true }).first().click();
  const add = formWith(page, 'Add service');
  await add.getByLabel('Name').fill('Haircut');
  await add.getByLabel('Minutes').fill('40');
  await add.getByLabel('Price ₹').fill('300');
  await add.getByLabel('Deposit ₹').fill('500');
  await add.getByRole('button', { name: 'Add service' }).click();
  await expect(page.getByText('can’t be more than the price')).toBeVisible();
  await formWith(page, 'Add service').getByLabel('Name').fill('Haircut');
  await formWith(page, 'Add service').getByLabel('Minutes').fill('40');
  await formWith(page, 'Add service').getByLabel('Price ₹').fill('300');
  await formWith(page, 'Add service').getByLabel('Deposit ₹').fill('100');
  await formWith(page, 'Add service').getByRole('button', { name: 'Add service' }).click();
  await expect(page.getByText('₹100 now, ₹200 at the salon')).toBeVisible();

  // staff: new staff can do every service by default
  await page.goto('/dashboard/staff');
  await formWith(page, 'Add staff').getByLabel('Name').fill('Ravi');
  await page.getByRole('button', { name: 'Add staff' }).click();
  await expect(page.getByRole('checkbox', { name: 'Haircut' })).toBeChecked();

  // hours: morning + afternoon = lunch break; an overlapping window is refused
  await page.goto('/dashboard/hours');
  await page.getByRole('button', { name: 'Add hours' }).click();
  await page.getByLabel('From', { exact: true }).fill('14:00');
  await page.getByLabel('To', { exact: true }).fill('19:00');
  await page.getByRole('button', { name: 'Add hours' }).click();
  const monday = page.locator('dl > div').filter({ hasText: 'Monday' });
  await expect(monday).toContainText('10:00–13:00');
  await expect(monday).toContainText('14:00–19:00');
  await expect(page.locator('dl > div').filter({ hasText: 'Sunday' })).toContainText('Closed');
  await page.getByLabel('From', { exact: true }).fill('12:00');
  await page.getByLabel('To', { exact: true }).fill('15:00');
  await page.getByRole('button', { name: 'Add hours' }).click();
  await expect(page.getByText('overlaps')).toBeVisible();

  // time off shows in salon time
  await page.goto('/dashboard/time-off');
  await page.getByLabel('From', { exact: true }).fill('2030-01-10T10:00');
  await page.getByLabel('To', { exact: true }).fill('2030-01-10T18:00');
  await page.getByLabel('Reason (optional)').fill('Wedding');
  await page.getByRole('button', { name: 'Add time off' }).click();
  await expect(page.getByText(/10 Jan.*10:00\s?am → 10 Jan.*6:00\s?pm/i)).toBeVisible();

  // settings persist
  await page.goto('/dashboard/settings');
  await page.getByPlaceholder('Parking behind').fill('Parking at the back.');
  await page.getByLabel('Hold time (minutes)').fill('10');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByPlaceholder('Parking behind')).toHaveValue('Parking at the back.');
  await expect(page.getByLabel('Hold time (minutes)')).toHaveValue('10');

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Ravi' })).toBeVisible();   // a column per stylist
  await expect(page.getByText('Finish setting up')).toHaveCount(0);
});

test('salon B sees nothing of salon A', async ({ page }) => {
  await signIn(page, 'owner2@sanwaro.test');
  await expect(page).toHaveURL(/\/onboarding/);   // owner 2 has no access to salon A
  await page.getByLabel('Salon name', { exact: true }).fill('Other Test Salon');
  await page.getByRole('button', { name: 'Create salon' }).click();
  await expect(page.getByText('Other Test Salon', { exact: true })).toBeVisible();
  await expect(page.getByText('Glow Test Salon')).toHaveCount(0);

  await page.goto('/dashboard/services');
  await expect(page.getByText('No services yet')).toBeVisible();
  await page.goto('/dashboard/staff');
  await expect(page.getByText('Ravi')).toHaveCount(0);
  await page.goto('/dashboard/time-off');
  await expect(page.getByText('Wedding')).toHaveCount(0);
});
