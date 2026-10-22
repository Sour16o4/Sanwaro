import { z } from 'zod';
import { admin } from '@/lib/supabase/admin';
import { allow, clientIp } from '@/lib/rate-limit';
import { createOrder, paymentsEnabled } from '@/lib/razorpay';
import { fail, json, toHttp } from '@/lib/errors';

const Body = z.object({ bookingId: z.uuid(), holdKey: z.uuid() });

// POST /api/payments/order: right before Checkout opens.
// start_payment() refuses holds with < 3 min left and extends the hold once to 10 min.
export async function POST(request) {
  const b = Body.safeParse(await request.json().catch(() => ({})));
  if (!b.success) return fail(400, 'BAD_REQUEST', 'Please pick a slot again.');
  if (!paymentsEnabled()) return fail(503, 'PAYMENTS_OFF', 'Online payment isn’t set up yet. Please call the salon.');
  const { bookingId, holdKey } = b.data;

  try {
    if (!(await allow(`pay:ip:${clientIp(request)}`, 30, 3600))) {
      return fail(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes.');
    }
    const { data: holdExpiresAt, error } = await admin.rpc('start_payment', { p_booking: bookingId, p_hold_key: holdKey });
    if (error) {
      const { status, body } = toHttp(error);
      if (status === 500) console.error(error);
      return json(status, body);
    }

    const { data: bk, error: e1 } = await admin.from('bookings')
      .select('business_id, deposit_paise, booked_name, customer:customers(phone), service:services(name, business:businesses(name))')
      .eq('id', bookingId).single();
    if (e1) throw e1;

    // A retry (closed the popup, tapped Pay again) reuses the unpaid order.
    let { data: payment, error: e2 } = await admin.from('payments').select('razorpay_order_id')
      .eq('booking_id', bookingId).eq('status', 'created').eq('amount_paise', bk.deposit_paise).limit(1).maybeSingle();
    if (e2) throw e2;
    if (!payment) {
      const order = await createOrder(bk.deposit_paise, bookingId.slice(0, 40), { booking_id: bookingId });
      ({ error: e2 } = await admin.from('payments').insert({
        business_id: bk.business_id, booking_id: bookingId, razorpay_order_id: order.id, amount_paise: bk.deposit_paise,
      }));
      if (e2) throw e2;
      payment = { razorpay_order_id: order.id };
    }

    return json(200, {
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: payment.razorpay_order_id,
      amount: bk.deposit_paise,
      holdExpiresAt,
      salonName: bk.service.business.name,
      description: `${bk.service.name} deposit`,
      prefill: { name: bk.booked_name, contact: `+91${bk.customer.phone}` },
    });
  } catch (e) {
    console.error(e);
    return fail(500, 'INTERNAL', 'Something went wrong.');
  }
}
