import { z } from 'zod';

// '+91 98765-43210', '098765 43210', '9876543210' -> '9876543210' (or null)
export function normalizePhone(input) {
  let d = String(input ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export const slug = z.string().regex(/^[a-z0-9-]{3,40}$/);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SlotsQuery = z.object({
  salon: slug,
  service: z.uuid(),
  date: isoDate,
  staff: z.union([z.literal('any'), z.uuid()]).default('any'),
});

export const HoldBody = z.object({
  salon: slug,
  serviceId: z.uuid(),
  staffId: z.union([z.literal('any'), z.uuid()]),
  start: z.iso.datetime({ offset: true }),
  name: z.string().trim().min(1).max(80),
  phone: z.string().transform(normalizePhone).refine(Boolean, 'Enter a 10-digit Indian mobile number.'),
  holdKey: z.uuid(),
  turnstileToken: z.string().max(4096).optional().default(''),
  website: z.string().optional().default(''),   // honeypot: people never see it
});

// Why this deposit? Shown to the customer next to the amount (see deposit_for in SQL).
export function depositReason(deposit, service) {
  if (deposit === 0) return service.deposit_paise === 0 ? 'Pay at the salon' : 'No deposit needed';
  if (deposit < service.deposit_paise) return 'Half deposit, thanks for coming back!';
  if (deposit === service.deposit_paise) return 'A small deposit holds your slot';
  if (deposit >= service.price_paise) return 'Full payment needed after missed visits';
  return 'Deposit is higher after a missed visit';
}
