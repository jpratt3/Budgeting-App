import { state } from './state.js';

// Single source of truth for "where does the selected period start?" — the label,
// the chat scope line, and the transactions URL all derive from this, so a period
// mode only has to be defined once.
export function periodStart(now = new Date()) {
  if (state.periodMode === 'mtd') return new Date(now.getFullYear(), now.getMonth(), 1);
  if (state.periodMode === 'ytd') return new Date(now.getFullYear(), 0, 1);
  const start = new Date(now);
  start.setDate(now.getDate() - state.currentDays);
  return start;
}

export function periodDates() {
  const now = new Date();
  return { start: periodStart(now).toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
}

export function updatePeriodLabel() {
  const now = new Date();
  const start = periodStart(now);
  const opts = { month: 'short', day: 'numeric' };
  const label = `${start.toLocaleDateString('en-US', opts)} – ${now.toLocaleDateString('en-US', opts)}`;
  document.querySelectorAll('.period-label').forEach(el => el.textContent = label);
}
