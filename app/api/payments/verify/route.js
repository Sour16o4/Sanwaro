import { z } from 'zod';
import { admin } from '@/lib/supabase/admin';
import { checkoutSignatureOk } from '@/lib/razorpay';
import { settleCapture } from '@/lib/payments';
import { fail, json } from '@/lib/errors';

const Body = z.object({ orderId: z.string().max(64), paymentId: z.string().max(64), signature: z.string().max(256) });

// POST /api/payments/verify: Checkout's success handler, for instant feedback.
// The webhook confirms the same payment too; whichever is second changes nothing.
export async function POST(request) {
  const b = Body.safeParse(await request.json().catch(() => ({})));
  if (!b.success || !checkoutSignatureOk(b.data.orderId, b.data.paymentId, b.data.signature)) {
    return fail(400, 'BAD_SIGNATURE', 'We couldn’t verify this payment. If money was taken, it will be refunded.');
  }
  try {
    // the signature proves Razorpay made this payment for this order; the order's amount is ours
    const { data: p, error } = await admin.from('payments').select('amount_paise')
      .eq('razorpay_order_id', b.data.orderId).maybeSingle();
    if (error) throw error;
    if (!p) return fail(404, 'UNKNOWN_ORDER', 'Payment not found.');
    await settleCapture(b.data.orderId, b.data.paymentId, p.amount_paise);
    return json(200, await outcome(b.data.orderId));
  } catch (e) {
    console.error(e);
    return fail(500, 'INTERNAL', 'Something went wrong. If money was taken, the salon will see it.');
  }
}

// What the customer should see, read back from the database.
async function outcome(orderId) {
  const { data, error } = await admin.from('payments').select('status, booking:bookings(status)')
    .eq('razorpay_order_id', orderId).single();
  if (error) throw error;
  if (data.booking.status === 'confirmed') return { status: 'confirmed' };
  return { status: 'refunded', message: 'Sorry, that slot was taken while you paid. Your deposit is being refunded.' };
}
