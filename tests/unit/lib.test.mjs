// TZ=UTC node --test tests/unit/   (Vercel runs in UTC, so tests do too)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rupeesToPaise, formatRupees } from '../../lib/money.js';
import { localToUtc, formatDateTime } from '../../lib/time.js';

test('rupeesToPaise parses rupee strings without floats', () => {
  assert.equal(rupeesToPaise('199.99'), 19999);
  assert.equal(rupeesToPaise('100'), 10000);
  assert.equal(rupeesToPaise('0.05'), 5);
  assert.equal(rupeesToPaise('0.5'), 50);
  assert.equal(rupeesToPaise(' 300 '), 30000);
  for (const bad of ['-1', '1.234', 'abc', '', '1e3', '1,000', null]) assert.equal(rupeesToPaise(bad), null, bad);
});

test('formatRupees', () => {
  assert.equal(formatRupees(30000), '₹300');
  assert.equal(formatRupees(150000), '₹1,500');
  assert.equal(formatRupees(29950), '₹299.50');
});

test('localToUtc treats the input as salon wall-clock time, not server time', () => {
  assert.equal(localToUtc('2026-10-24T10:00').toISOString(), '2026-10-24T04:30:00.000Z');
  assert.equal(localToUtc('2026-10-24T00:15').toISOString(), '2026-10-23T18:45:00.000Z'); // crosses midnight
  assert.equal(localToUtc('2026-07-01T12:00', 'Europe/London').toISOString(), '2026-07-01T11:00:00.000Z'); // DST
  assert.equal(localToUtc('not a date'), null);
});

test('formatDateTime shows IST on a UTC server', () => {
  assert.match(formatDateTime('2026-10-24T04:30:00Z'), /24 Oct.*10:00\s?am/i);
});

import { normalizePhone, depositReason } from '../../lib/validation.js';
import { toHttp } from '../../lib/errors.js';

test('normalizePhone accepts common Indian formats, rejects the rest', () => {
  for (const ok of ['9876543210', '+91 98765 43210', '098765-43210', '919876543210']) assert.equal(normalizePhone(ok), '9876543210', ok);
  for (const bad of ['12345', '5876543210', '98765432101', '', null, '+1 9876543210']) assert.equal(normalizePhone(bad), null, String(bad));
});

test('depositReason explains every smart-deposit outcome', () => {
  const svc = { price_paise: 30000, deposit_paise: 10000 };
  assert.equal(depositReason(0, { price_paise: 30000, deposit_paise: 0 }), 'Pay at the salon');
  assert.equal(depositReason(0, svc), 'No deposit needed');
  assert.equal(depositReason(5000, svc), 'Half deposit, thanks for coming back!');
  assert.equal(depositReason(10000, svc), 'A small deposit holds your slot');
  assert.equal(depositReason(20000, svc), 'Deposit is higher after a missed visit');
  assert.equal(depositReason(30000, svc), 'Full payment needed after missed visits');
});

test('toHttp maps named SQL errors and hides everything else', () => {
  assert.deepEqual(toHttp({ message: 'SLOT_TAKEN' }).status, 409);
  assert.equal(toHttp({ message: 'CUSTOMER_BLOCKED' }).status, 403);
  const unknown = toHttp({ message: 'duplicate key value violates unique constraint "x"' });
  assert.equal(unknown.status, 500);
  assert.equal(unknown.body.message, 'Something went wrong.');
  assert.doesNotMatch(JSON.stringify(unknown.body), /duplicate key/);
});
