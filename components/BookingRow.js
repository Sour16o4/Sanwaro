import Link from 'next/link';
import { setBookingStatus } from '@/app/dashboard/bookings/actions';
import { formatRupees } from '@/lib/money';
import { formatTime, formatDay } from '@/lib/time';

const BADGE = {
  held: ['Held', 'bg-amber-100 text-amber-800'],
  confirmed: ['Confirmed', 'bg-emerald-100 text-emerald-800'],
  completed: ['Completed', 'bg-paper text-muted'],
  no_show: ['No-show', 'bg-red-100 text-red-800'],
  cancelled: ['Cancelled', 'bg-paper text-muted line-through'],
  expired: ['Expired', 'bg-paper text-muted'],
};

function StatusButton({ b, back, status, label, className = 'btn-ghost' }) {
  return (
    <form action={setBookingStatus}>
      <input type="hidden" name="id" value={b.id} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="back" value={back} />
      <button className={className}>{label}</button>
    </form>
  );
}

// One booking with the moves that are legal right now (bookings_guard enforces them anyway).
export default function BookingRow({ b, tz, back, showDay = false, showStaff = false }) {
  const [label, tone] = BADGE[b.status];
  const c = b.customer;
  return (
    <li className="card space-y-2 p-4 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">{showDay && `${formatDay(b.start, tz)}, `}{formatTime(b.start, tz)}–{formatTime(b.end, tz)}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>{label}</span>
        {b.source === 'manual' && <span className="hint text-xs">phone</span>}
        {b.source === 'walkin' && <span className="hint text-xs">walk-in</span>}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <Link href={`/dashboard/customers/${c.id}`} className="font-medium hover:text-brand">{b.booked_name || c.name}</Link>
        <a href={`tel:+91${c.phone}`} className="text-muted hover:text-brand">{c.phone}</a>
        {c.trusted && <span className="text-xs text-emerald-700">trusted</span>}
        {c.no_show_count > 0 && <span className="text-xs text-red-700">{c.no_show_count} no-show{c.no_show_count > 1 && 's'}</span>}
      </div>
      <p className="text-muted">
        {b.service.name}{showStaff && ` · ${b.staff.name}`} · {formatRupees(b.service.price_paise)}
        {b.deposit_paise > 0 && ` (${formatRupees(b.deposit_paise)} deposit)`}
      </p>
      <div className="flex flex-wrap gap-2">
        {b.status === 'confirmed' && b.started && <StatusButton b={b} back={back} status="completed" label="Completed" />}
        {(b.status === 'confirmed' && b.started || b.status === 'completed') && <StatusButton b={b} back={back} status="no_show" label="No-show" />}
        {(b.status === 'confirmed' || b.status === 'held') && !b.started &&
          <StatusButton b={b} back={back} status="cancelled" label="Cancel" className="btn-danger" />}
      </div>
    </li>
  );
}
