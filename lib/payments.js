import 'server-only';
import { admin } from '@/lib/supabase/admin';
import { refundPayment } from '@/lib/razorpay';

// A captured payment, from Checkout (verify) or the webhook, whichever comes first.
// confirm_payment() locks the payment row and stores the payment id once, so the
// second caller gets ALREADY_PROCESSED and changes nothing.
export async function settleCapture(orderId, paymentId, amountPaise) {
  const { data: outcome, error } = await admin.rpc('confirm_payment',
    { p_order_id: orderId, p_payment_id: paymentId, p_amount_paise: amountPaise });
  if (error) throw error;
  if (outcome === 'REFUND_NEEDED') await refund(paymentId, amountPaise);
  return outcome;
}

// Paid too late for a slot someone else now has (or cancelled in time): give the money back.
// If Razorpay fails, the payment stays refund_pending and the daily sweep tries again.
export async function refund(paymentId, amountPaise) {
  try {
    const r = await refundPayment(paymentId, amountPaise);
    const { error } = await admin.rpc('mark_refunded', { p_payment_id: paymentId, p_refund_id: r.id });
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('refund failed, will retry', paymentId, e.message);
    return false;
  }
}
