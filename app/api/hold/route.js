import { HoldBody, depositReason } from '@/lib/validation';
import { getSalonRef, freeSlots } from '@/lib/salon';
import { allow, clientIp } from '@/lib/rate-limit';
import { verifyTurnstile } from '@/lib/turnstile';
import { admin } from '@/lib/supabase/admin';
import { fail, json, toHttp } from '@/lib/errors';

// POST /api/hold: the customer picked a slot. Returns a hold, or a confirmed
// booking when no deposit is due. The database decides who wins a slot.
export async function POST(request) {
  const raw = await request.json().catch(() => null);
  const b = HoldBody.safeParse(raw ?? {});
  if (!b.success) {
    const phoneIssue = b.error.issues.find((i) => i.path[0] === 'phone');
    return fail(400, 'BAD_REQUEST', phoneIssue?.message ?? 'Please check your details.');
  }
  const d = b.data;
  const ip = clientIp(request);

  // Honeypot filled = bot. Pretend it worked, store nothing.
  if (d.website) {
    return json(200, { bookingId: crypto.randomUUID(), status: 'confirmed', holdExpiresAt: null,
      deposit: 0, depositReason: 'Pay at the salon', manageToken: crypto.randomUUID() });
  }
  if (!(await verifyTurnstile(d.turnstileToken, ip))) {
    return fail(403, 'TURNSTILE_FAILED', 'Please complete the check and try again.');
  }

  try {
    if (!(await allow(`hold:phone:${d.phone}`, 3, 3600)) || !(await allow(`hold:ip:${ip}`, 20, 3600))) {
      return fail(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
    }
    const salon = await getSalonRef(d.salon);
    if (!salon) return fail(404, 'BUSINESS_NOT_FOUND', 'Not found.');

    // "Any available": every stylist free at that time, tried in turn.
    let candidates = [d.staffId];
    if (d.staffId === 'any') {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: salon.timezone }).format(new Date(d.start));
      const startMs = new Date(d.start).getTime();
      candidates = (await freeSlots(salon.id, d.serviceId, date, null))
        .filter((s) => new Date(s.start_at).getTime() === startMs)
        .map((s) => s.staff_id);
      if (!candidates.length) return fail(409, 'SLOT_TAKEN', toHttp({ message: 'SLOT_TAKEN' }).body.message);
    }

    let lastError;
    for (const staffId of candidates) {
      const { data, error } = await admin.rpc('create_hold', {
        p_business: salon.id, p_staff: staffId, p_service: d.serviceId, p_start: d.start,
        p_customer_name: d.name, p_phone: d.phone, p_hold_key: d.holdKey,
      });
      if (error?.message === 'SLOT_TAKEN') { lastError = error; continue; }   // next stylist
      if (error) { lastError = error; break; }

      const hold = data[0];
      const { data: service } = await admin.from('services')
        .select('deposit_paise, price_paise').eq('id', d.serviceId).eq('business_id', salon.id).single();
      return json(200, {
        bookingId: hold.booking_id,
        status: hold.status,
        holdExpiresAt: hold.hold_expires_at,
        deposit: hold.deposit_paise,
        depositReason: depositReason(hold.deposit_paise, service),
        manageToken: hold.manage_token,
        staffId,
      });
    }
    const { status, body } = toHttp(lastError);
    if (status === 500) console.error('POST /api/hold', lastError);
    return json(status, body);
  } catch (error) {
    console.error('POST /api/hold', error);
    return fail(500, 'INTERNAL', 'Something went wrong.');
  }
}
