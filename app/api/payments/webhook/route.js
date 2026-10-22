import { admin } from '@/lib/supabase/admin';
import { webhookSignatureOk } from '@/lib/razorpay';
import { settleCapture } from '@/lib/payments';

// POST /api/payments/webhook: Razorpay's server-to-server events. The source of truth
// when the customer closes the tab. Razorpay retries anything that isn't 2xx.
export async function POST(request) {
  const raw = await request.text();   // signature is over the exact bytes
  if (!webhookSignatureOk(raw, request.headers.get('x-razorpay-signature'))) {
    return new Response('bad signature', { status: 400 });
  }
  const event = JSON.parse(raw);
  try {
    if (event.event === 'payment.captured') {
      const p = event.payload.payment.entity;
      const outcome = await settleCapture(p.order_id, p.id, p.amount);
      if (outcome === 'UNKNOWN_ORDER' || outcome === 'AMOUNT_MISMATCH') console.error('webhook', outcome, p.order_id);
    } else if (event.event === 'refund.processed') {
      const r = event.payload.refund.entity;
      const { error } = await admin.rpc('mark_refunded', { p_payment_id: r.payment_id, p_refund_id: r.id });
      if (error) throw error;
    }
    return new Response('ok');
  } catch (e) {
    console.error(e);
    return new Response('retry', { status: 500 });
  }
}
