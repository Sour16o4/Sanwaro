'use client';
import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { formatRupees } from '@/lib/money';
import { formatTime } from '@/lib/time';

const dayLabel = (date, i) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow'
  : new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(date + 'T00:00:00Z')));

// One random key per browser tab visit: lets this browser swap its own hold for another slot.
function holdKey() {
  try {
    let k = sessionStorage.getItem('sanwaro_hold_key');
    if (!k) sessionStorage.setItem('sanwaro_hold_key', (k = crypto.randomUUID()));
    return k;
  } catch {
    return (globalThis.__sanwaroHoldKey ??= crypto.randomUUID());
  }
}

const chip = (on) => `rounded-full border px-4 py-2 text-sm ${on ? 'border-brand bg-brand text-white' : 'border-line bg-white hover:border-brand'}`;

export default function BookingFlow({ salon, dates, siteKey }) {
  const tz = salon.timezone;
  const [service, setService] = useState(null);
  const [staffId, setStaffId] = useState('any');
  const [date, setDate] = useState(dates[0]);
  const [slots, setSlots] = useState(null);
  const [slot, setSlot] = useState(null);
  const [step, setStep] = useState('pick');   // pick -> details -> done
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Quick clicks start overlapping requests; only the latest one may fill the grid,
  // or today's late answer would show up under "Tomorrow".
  const latest = useRef(0);
  async function loadSlots(next) {
    const q = { service: service?.id, staff: staffId, date, ...next };
    const id = ++latest.current;
    setSlot(null);
    setSlots(null);
    if (!q.service) return;
    const res = await fetch(`/api/slots?${new URLSearchParams({ salon: salon.slug, ...q })}`);
    const body = await res.json();
    if (id !== latest.current) return;
    if (res.ok) setSlots(body);
    else { setSlots([]); setError(body.message); }
  }

  const pickService = (s) => { setService(s); setStaffId('any'); setError(''); loadSlots({ service: s.id, staff: 'any' }); };
  const pickStaff = (id) => { setStaffId(id); loadSlots({ staff: id }); };
  const pickDate = (d) => { setDate(d); loadSlots({ date: d }); };

  const stylists = service ? salon.staff.filter((p) => p.serviceIds.includes(service.id)) : [];
  const staffName = (id) => salon.staff.find((p) => p.id === id)?.name;

  async function hold(form) {
    setBusy(true);
    setError('');
    const res = await fetch('/api/hold', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        salon: salon.slug, serviceId: service.id, staffId: slot.staffId, start: slot.start,
        name: form.get('name'), phone: form.get('phone'), website: form.get('website'),
        turnstileToken: form.get('cf-turnstile-response'), holdKey: holdKey(),
      }),
    });
    const body = await res.json().catch(() => ({ message: 'Something went wrong.' }));
    setBusy(false);
    if (res.ok) { setResult(body); setStep('done'); return; }
    setError(body.message);
    window.turnstile?.reset();   // tokens are single-use
    if (body.error === 'SLOT_TAKEN') { setStep('pick'); loadSlots({}); }
  }

  if (step === 'done') {
    return <Confirmation salon={salon} service={service} slot={slot} result={result}
      stylist={staffName(result.staffId)} onChange={() => { setStep('pick'); loadSlots({}); }} />;
  }

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      <section>
        <h2 className="h2 mb-3">1. Service</h2>
        <ul className="space-y-2">
          {salon.services.map((s) => (
            <li key={s.id}>
              <button onClick={() => pickService(s)} aria-pressed={service?.id === s.id}
                className={`card flex w-full items-center justify-between p-4 text-left ${service?.id === s.id ? 'border-brand ring-2 ring-brand/20' : 'hover:border-brand'}`}>
                <span>
                  <span className="font-medium">{s.name}</span>
                  <span className="hint block">{s.duration_min} min</span>
                </span>
                <span className="text-right text-sm">
                  <span className="font-medium">{formatRupees(s.price_paise)}</span>
                  <span className="hint block">{s.deposit_paise ? `${formatRupees(s.deposit_paise)} deposit` : 'Pay at the salon'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {service && (
        <>
          <section>
            <h2 className="h2 mb-3">2. Stylist</h2>
            <div className="flex flex-wrap gap-2">
              <button className={chip(staffId === 'any')} aria-pressed={staffId === 'any'} onClick={() => pickStaff('any')}>Any available</button>
              {stylists.map((p) => (
                <button key={p.id} className={chip(staffId === p.id)} aria-pressed={staffId === p.id} onClick={() => pickStaff(p.id)}>{p.name}</button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="h2 mb-3">3. Day</h2>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
              {dates.map((d, i) => (
                <button key={d} className={`${chip(date === d)} shrink-0`} aria-pressed={date === d} onClick={() => pickDate(d)}>{dayLabel(d, i)}</button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="h2 mb-3">4. Time <span className="hint font-normal">({tz === 'Asia/Kolkata' ? 'IST' : tz})</span></h2>
            {slots === null ? <p className="hint">Finding free times…</p>
              : slots.length === 0 ? <p className="hint">No free times this day. Try another day or stylist.</p>
              : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slots.map((s) => (
                    <button key={s.start + s.staffId} aria-pressed={slot?.start === s.start}
                      onClick={() => { setSlot(s); setStep('details'); setError(''); }}
                      className={`rounded-lg border px-2 py-2 text-sm ${slot?.start === s.start ? 'border-brand bg-brand text-white' : 'border-line bg-white hover:border-brand'}`}>
                      {formatTime(s.start, tz)}
                    </button>
                  ))}
                </div>
              )}
          </section>
        </>
      )}

      {step === 'details' && slot && (
        <Details salon={salon} service={service} slot={slot} stylist={staffName(slot.staffId)}
          siteKey={siteKey} busy={busy} onSubmit={hold} />
      )}
    </div>
  );
}

function Details({ salon, service, slot, stylist, siteKey, busy, onSubmit }) {
  const widget = useRef(null);
  const [ready, setReady] = useState(typeof window !== 'undefined' && Boolean(window.turnstile));

  useEffect(() => {
    if (!ready || !widget.current || widget.current.childElementCount) return;
    window.turnstile.render(widget.current, { sitekey: siteKey });
  }, [ready, siteKey]);

  const h = salon.cancel_window_hours;
  return (
    <section className="card space-y-4">
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={() => setReady(true)} />
      <h2 className="h2">5. Your details</h2>
      <p className="text-sm">
        <span className="font-medium">{service.name}</span> · {formatTime(slot.start, salon.timezone)}
        {stylist ? ` with ${stylist}` : ' with any available stylist'}
      </p>
      <form action={onSubmit} className="space-y-4">
        <label className="label">Name
          <input className="input" name="name" autoComplete="name" required maxLength={80} />
        </label>
        <label className="label">Mobile number
          <input className="input" name="phone" type="tel" inputMode="numeric" autoComplete="tel" required placeholder="98765 43210" />
        </label>
        {/* honeypot: hidden from people, bots fill it in */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
        <div ref={widget} />
        <div className="rounded-lg bg-paper p-3 text-sm text-muted">
          <p>
            {service.deposit_paise
              ? <>Price {formatRupees(service.price_paise)}: usually <b className="text-ink">{formatRupees(service.deposit_paise)} now</b>, {formatRupees(service.price_paise - service.deposit_paise)} at the salon.</>
              : <>Price {formatRupees(service.price_paise)}, paid at the salon.</>}
          </p>
          <p className="mt-1">{h > 0 ? `Cancel at least ${h} hours before for a full deposit refund.` : 'Cancel any time before your visit for a full deposit refund.'}</p>
        </div>
        <button className="btn w-full" disabled={busy}>{busy ? 'Booking…' : 'Book this time'}</button>
      </form>
    </section>
  );
}

function Confirmation({ salon, service, slot, result, stylist, onChange }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/booking/${result.manageToken}`;
  const held = result.status === 'held';
  const tz = salon.timezone;

  return (
    <section className="card space-y-4">
      <h2 className="text-xl font-semibold">{held ? 'Your slot is held' : 'Booked!'}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Service</dt><dd>{service.name}</dd>
        <dt className="text-muted">When</dt>
        <dd>{new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(slot.start))}, {formatTime(slot.start, tz)}</dd>
        {stylist && <><dt className="text-muted">Stylist</dt><dd>{stylist}</dd></>}
        <dt className="text-muted">Price</dt>
        <dd>{result.deposit
          ? `${formatRupees(result.deposit)} now, ${formatRupees(service.price_paise - result.deposit)} at the salon`
          : `${formatRupees(service.price_paise)} at the salon`}
          <span className="hint block">{result.depositReason}</span>
        </dd>
      </dl>

      {held && (
        <p className="rounded-lg bg-brand-soft p-3 text-sm">
          Held until {formatTime(result.holdExpiresAt, tz)}. Online UPI deposit payment is coming soon.
        </p>
      )}
      {salon.customer_note && <p className="rounded-lg bg-paper p-3 text-sm">{salon.customer_note}</p>}

      <div>
        <p className="label">Your booking link</p>
        <p className="hint">Keep it to view or cancel your booking. No account needed.</p>
        <div className="mt-2 flex gap-2">
          <input className="input mt-0 font-mono text-xs" value={link} readOnly aria-label="Booking link" />
          <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      {held && <button className="hint underline" onClick={onChange}>Pick a different time</button>}
    </section>
  );
}
