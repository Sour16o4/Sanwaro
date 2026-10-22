// Times are stored as UTC timestamptz; salons think in their own timezone.
// Never rely on the server's timezone: Vercel runs in UTC.
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// '2026-10-24T10:00' (wall clock in `tz`) -> Date
export function localToUtc(local, tz = 'Asia/Kolkata') {
  // strict format first: V8's lenient parser turns junk like 'not a date:00Z' into a year-2000 date
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const asUtc = new Date(local + ':00Z');
  if (Number.isNaN(asUtc.getTime())) return null;
  // offset of `tz` at that moment, e.g. +330 min for IST
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(asUtc).map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return new Date(asUtc.getTime() - (wall - asUtc.getTime()));
}

export function formatDateTime(value, tz = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: tz, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

// '10:00:00' -> '10:00'
export const hhmm = (t) => t.slice(0, 5);

// Next `n` dates (YYYY-MM-DD) starting today in `tz`.
export function upcomingDates(tz, n) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const start = new Date(today + 'T00:00:00Z');
  return Array.from({ length: n }, (_, i) => new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10));
}

export function formatTime(value, tz = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export function formatDay(value, tz = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(value));
}
