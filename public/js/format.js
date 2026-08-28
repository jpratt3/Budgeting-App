// Pure display formatting. No imports — everything else may depend on this.

export function fmt(n) {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Signed variant: keeps the minus sign for values that can legitimately go negative
// (net worth, actual savings). fmt() deliberately drops it — callers add their own.
export function fmtSigned(n) {
  return (n < 0 ? '−' : '') + fmt(n);
}

// Axis / chip formatting — $1.2k, $48k, $1.4M.
export function fmtShort(n) {
  const a = Math.abs(n);
  const s = n < 0 ? '−$' : '$';
  if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return s + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return s + Math.round(a);
}

export function pct(n) { return Math.round(n) + '%'; }

// Every render path writes merchant names straight into innerHTML. Plaid strings are
// third-party data, so escape at the boundary rather than trusting the feed.
export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function cleanLabel(str) {
  return str.replace(/_/g,' ').toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/And /g,'& ')
    .replace(/Food & Drink /g,'')
    .replace(/General Merchandise /g,'')
    .replace(/Transportation /g,'')
    .replace(/Rent & Utilities /g,'')
    .trim();
}

export function fmtMonths(m) {
  if (m === Infinity) return 'not reachable';
  if (m === 0) return 'already there';
  const y = Math.floor(m / 12), mo = m % 12;
  if (y === 0) return mo + 'mo';
  return mo === 0 ? y + 'yr' : y + 'yr ' + mo + 'mo';
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'short' }) + " '" + y.slice(2);
}

// "Aug 14" — short date for transaction rows.
export function dayLabel(iso) {
  const [y, m, d] = iso.split('-');
  return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Merchant initial for the avatar circle when Plaid gives us no logo.
export function initial(name) {
  const c = (name || '?').trim()[0] || '?';
  return esc(c.toUpperCase());
}
