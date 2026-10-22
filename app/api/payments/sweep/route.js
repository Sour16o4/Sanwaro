import { timingSafeEqual } from 'node:crypto';
import { admin } from '@/lib/supabase/admin';
import { refund } from '@/lib/payments';

// POST /api/payments/sweep: daily pg_cron job (cron.sql). Retries refunds that failed
// earlier, and pays back cancellations from the booking link.
export async function POST(request) {
  const given = Buffer.from(request.headers.get('x-notify-secret') ?? '');
  const secret = Buffer.from(process.env.NOTIFY_SECRET ?? '');
  if (!secret.length || given.length !== secret.length || !timingSafeEqual(given, secret)) {
    return new Response('forbidden', { status: 403 });
  }
  const { data, error } = await admin.from('payments').select('razorpay_payment_id, amount_paise')
    .eq('status', 'refund_pending').not('razorpay_payment_id', 'is', null).limit(50);
  if (error) throw error;
  let done = 0;
  for (const p of data) if (await refund(p.razorpay_payment_id, p.amount_paise)) done++;
  return Response.json({ pending: data.length, refunded: done });
}
