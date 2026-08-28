import { state, bumpGen } from './state.js';
import { periodStart, updatePeriodLabel } from './period.js';
import { clearDerivedCaches } from './classify.js';
import { migratePendingDecisions } from './lazy.js';
import { renderAll } from './overview.js';
import { reloadHistory } from './history.js';
import { refreshCurrentPage } from './nav.js';
import { esc } from './format.js';

export async function loadConnectedAccounts() {
  const res = await fetch('/api/accounts');
  const { accounts } = await res.json();
  const el = document.getElementById('connected-accounts');
  if (!el) return;
  el.innerHTML = accounts.map(a => {
    const label = a.label ?? a;
    const logo = a.logo ?? null;
    const img = logo
      ? `<img src="data:image/png;base64,${esc(logo)}" alt="">`
      : `<span style="color:var(--accent)">⬤</span>`;
    return `<span class="account-chip">${img} ${esc(label)}</span>`;
  }).join('') || '<div class="empty">No institutions linked yet</div>';
}

export async function loadAll() {
  updatePeriodLabel();
  ['txn-list', 'lazy-list', 'dash-recent'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div class="loading">Loading…</div>';
  });

  try {
    // Rolling windows ask for a day count; mtd/ytd pin an explicit start date.
    const url = state.periodMode === 'rolling'
      ? `/api/transactions?days=${state.currentDays}`
      : `/api/transactions?start=${periodStart().toISOString().split('T')[0]}`;

    const res = await fetch(url);
    const data = await res.json();
    if (data.error) {
      const el = document.getElementById('txn-list');
      if (el) el.innerHTML = `<div class="empty">${esc(data.error)}</div>`;
      return;
    }
    state.allTransactions = data.transactions || [];
    clearDerivedCaches();   // new transaction objects — drop every memo keyed off the old set
    bumpGen();
    migratePendingDecisions(state.allTransactions);
    renderAll(state.allTransactions);
    refreshCurrentPage();

    // The 365-day history backs the net-worth, reports, and recurring views — refresh
    // it too so a period change or Refresh doesn't leave those stale.
    if (state.historyTransactions) reloadHistory();
  } catch (err) {
    console.error(err);
    const el = document.getElementById('txn-list');
    if (el) el.innerHTML = '<div class="empty">Failed to load transactions.</div>';
  }
}
