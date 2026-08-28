// Recurring-charge detection. Purely client-side over the 365-day history we already
// fetch — nothing is written to the database, and nothing here feeds the budget math.
// It is a lens on existing data, not a new source of truth.
import { state } from './state.js';
import { classify } from './classify.js';
import { dayLabel, esc, fmt, initial, pct } from './format.js';

const MIN_CHARGES = 3;

// Cadence buckets, in days. A merchant qualifies if its median gap lands in one.
// `perMonth` is the canonical rate, not medianGap/30.44 — a bill that arrives once a
// calendar month costs one charge per month whether the gap measured 28 days or 35.
const CADENCES = [
  { name: 'Weekly',    days: 7,   lo: 5,   hi: 9,   perMonth: 52 / 12 },
  { name: 'Biweekly',  days: 14,  lo: 12,  hi: 17,  perMonth: 26 / 12 },
  { name: 'Monthly',   days: 30,  lo: 25,  hi: 36,  perMonth: 1 },
  { name: 'Quarterly', days: 91,  lo: 82,  hi: 99,  perMonth: 1 / 3 },
  { name: 'Yearly',    days: 365, lo: 350, hi: 380, perMonth: 1 / 12 },
];

// A charge stream that hasn't fired in two full cycles has probably been cancelled or
// moved to another card. Still worth listing, but it shouldn't inflate the totals.
const STALE_CYCLES = 2;

const median = arr => {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Statement descriptors often carry a trailing reference number that changes every
// charge ("NETFLIX 8829" / "NETFLIX 9134"), which would split one subscription into
// many merchants. Strip trailing digit runs and punctuation before grouping.
function merchantKey(t) {
  return (t.merchant_name || t.name || '')
    .toLowerCase()
    .replace(/[#*]?\s*\b\d{3,}\b/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectRecurring(txns = state.historyTransactions || []) {
  const groups = new Map();
  txns.forEach(t => {
    if (t.amount <= 0) return;
    const type = classify(t);
    if (type !== 'essential' && type !== 'extra') return;
    const key = merchantKey(t);
    if (key.length < 3) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });

  const found = [];
  groups.forEach(list => {
    if (list.length < MIN_CHARGES) return;
    list.sort((a, b) => a.date.localeCompare(b.date));

    // Collapse same-day duplicates — two charges on one date say nothing about cadence.
    const days = [...new Set(list.map(t => t.date))].map(d => Date.parse(d + 'T00:00:00'));
    if (days.length < MIN_CHARGES) return;

    const gaps = [];
    for (let i = 1; i < days.length; i++) gaps.push((days[i] - days[i - 1]) / 86400000);
    const medGap = median(gaps);
    const cadence = CADENCES.find(c => medGap >= c.lo && medGap <= c.hi);
    if (!cadence) return;

    // Gap consistency: every interval within 40% of the median. Loose enough for
    // "monthly on the 3rd-ish", tight enough to reject scattered one-offs.
    if (!gaps.every(g => Math.abs(g - medGap) <= medGap * 0.4)) return;

    // Amount stability: a subscription charges roughly the same amount each time.
    const amounts = list.map(t => t.amount);
    const medAmt = median(amounts);
    if (medAmt <= 0) return;
    if (!amounts.every(a => Math.abs(a - medAmt) <= medAmt * 0.35)) return;

    const last = list[list.length - 1];
    const lastMs = days[days.length - 1];
    const daysSince = (Date.now() - lastMs) / 86400000;
    const active = daysSince <= medGap * STALE_CYCLES;

    found.push({
      label: last.merchant_name || last.name,
      sample: last,
      count: list.length,
      cadence: cadence.name,
      medGap,
      active,
      amount: medAmt,
      monthly: medAmt * cadence.perMonth,
      lastDate: last.date,
      nextDate: new Date(lastMs + medGap * 86400000).toISOString().slice(0, 10),
    });
  });

  // Active first, then by cost — a live $20/mo charge matters more than a dead $200 one.
  return found.sort((a, b) => (b.active - a.active) || (b.monthly - a.monthly));
}

export function renderRecurring() {
  const list = document.getElementById('recurring-list');
  if (!list) return;

  if (!state.historyTransactions) { list.innerHTML = '<div class="loading">Loading…</div>'; return; }

  const items = detectRecurring();
  const live = items.filter(i => i.active);
  const monthly = live.reduce((s, i) => s + i.monthly, 0);

  // Share of spending is measured against the same 12-month history the detector saw.
  let historySpend = 0;
  (state.historyTransactions || []).forEach(t => {
    const type = classify(t);
    if ((type === 'essential' || type === 'extra') && t.amount > 0) historySpend += t.amount;
  });
  const monthsCovered = Math.max(1, new Set((state.historyTransactions || []).map(t => t.date.slice(0, 7))).size);
  const share = historySpend > 0 ? (monthly * monthsCovered) / historySpend * 100 : 0;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('rec-count', String(live.length));
  set('rec-monthly', live.length ? fmt(monthly) : '—');
  set('rec-annual', live.length ? fmt(monthly * 12) : '—');
  set('rec-share', live.length ? pct(Math.min(100, share)) : '—');

  if (!items.length) {
    list.innerHTML = '<div class="empty">No recurring charges detected in the last 12 months</div>';
    return;
  }

  list.innerHTML = items.map(i => {
    const t = i.sample;
    const logo = t.logo_url
      ? `<div class="row-logo"><img src="${esc(t.logo_url)}" alt=""></div>`
      : `<div class="row-logo">${initial(i.label)}</div>`;
    const when = i.active
      ? `next ~${esc(dayLabel(i.nextDate))}`
      : `last seen ${esc(dayLabel(i.lastDate))}`;
    return `<div class="row ${i.active ? '' : 'resolved'}">
      ${logo}
      <div class="row-main">
        <div class="row-name">${esc(i.label)}</div>
        <div class="row-meta">${i.count} charges · ${when}</div>
      </div>
      <span class="chip">${esc(i.cadence)}</span>
      ${i.active ? '' : '<span class="chip">stopped</span>'}
      <span class="row-date">${fmt(i.amount)}</span>
      <span class="row-amount">${fmt(i.monthly)}<span style="color:var(--faint);font-weight:400">/mo</span></span>
    </div>`;
  }).join('');
}
