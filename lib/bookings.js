import 'server-only';
import { localToUtc } from '@/lib/time';

export const BOOKING_FIELDS = 'id, slot, status, source, deposit_paise, booked_name, staff_id, staff(name), '
  + 'service:services(name, price_paise), customer:customers(id, name, phone, no_show_count, trusted, blocked)';

// tstzrange text: ["2026-10-24 04:30:00+00","2026-10-24 05:10:00+00")
const bounds = (range) => range.slice(1, -1).split(',').map((s) => new Date(s.replaceAll('"', '')));

// Adds start/end and whether it has begun (completed / no-show only make sense after the start).
export function withTimes(rows) {
  const now = new Date();
  return rows.map((b) => {
    const [start, end] = bounds(b.slot);
    return { ...b, start, end, started: start <= now };
  });
}

// '2026-10-24' in the salon's timezone -> the UTC range covering that day.
export function dayRange(date, tz) {
  const from = localToUtc(`${date}T00:00`, tz);
  const next = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  return `[${from.toISOString()},${localToUtc(`${next}T00:00`, tz).toISOString()})`;
}
