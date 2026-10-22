// Money is stored as integer paise. Parse rupee strings without floats.
export function rupeesToPaise(input) {
  const s = String(input ?? '').trim();
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export function formatRupees(paise) {
  const r = paise / 100;
  return '₹' + (Number.isInteger(r) ? r.toLocaleString('en-IN') : r.toFixed(2));
}
