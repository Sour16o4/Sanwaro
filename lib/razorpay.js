// Razorpay over plain fetch (test mode). Docs: https://razorpay.com/docs/api/
import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.razorpay.com/v1';
export const paymentsEnabled = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

const hmac = (secret, data) => createHmac('sha256', secret ?? '').update(data).digest('hex');
const same = (a, b) => typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Checkout success handler: signature = HMAC(key secret, "order_id|payment_id")
export const checkoutSignatureOk = (orderId, paymentId, signature) =>
  Boolean(process.env.RAZORPAY_KEY_SECRET) && same(hmac(process.env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`), signature);

// Webhook: signature = HMAC(webhook secret, raw request body). Never re-serialise the JSON first.
export const webhookSignatureOk = (rawBody, signature) =>
  Boolean(process.env.RAZORPAY_WEBHOOK_SECRET) && same(hmac(process.env.RAZORPAY_WEBHOOK_SECRET, rawBody), signature);

async function call(method, path, body) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Razorpay ${path}: ${res.status} ${data.error?.description ?? ''}`);
  return data;
}

export const createOrder = (amountPaise, receipt, notes) =>
  call('POST', '/orders', { amount: amountPaise, currency: 'INR', receipt, notes, payment_capture: 1 });

export const refundPayment = (paymentId, amountPaise) =>
  call('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise, speed: 'normal' });
