import { SlotsQuery } from '@/lib/validation';
import { getSalonRef, freeSlots } from '@/lib/salon';
import { allow, clientIp } from '@/lib/rate-limit';
import { fail, json } from '@/lib/errors';

// GET /api/slots?salon=glow-salon&service=<id>&date=2026-10-24&staff=any
export async function GET(request) {
  const q = SlotsQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!q.success) return fail(400, 'BAD_REQUEST', 'Check the service and date.');

  try {
    if (!(await allow(`slots:ip:${clientIp(request)}`, 120, 60))) {
      return fail(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
    }
    const salon = await getSalonRef(q.data.salon);
    if (!salon) return fail(404, 'BUSINESS_NOT_FOUND', 'Not found.');

    const any = q.data.staff === 'any';
    const rows = await freeSlots(salon.id, q.data.service, q.data.date, any ? null : q.data.staff);
    const seen = new Set();
    const slots = [];
    for (const r of rows) {
      if (any && seen.has(r.start_at)) continue;   // "any stylist": one button per time
      seen.add(r.start_at);
      slots.push({ staffId: any ? 'any' : r.staff_id, staffName: any ? null : r.staff_name, start: r.start_at, end: r.end_at });
    }
    return json(200, slots);
  } catch (error) {
    console.error('GET /api/slots', error);
    return fail(500, 'INTERNAL', 'Something went wrong.');
  }
}
