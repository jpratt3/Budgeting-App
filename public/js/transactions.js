// The Transactions page and the dashboard's "recent" strip. Both draw the same rows
// from rows.js; only the filter and the cap differ.
import { state } from './state.js';
import { classify, getEffectiveDecision, isLazy } from './classify.js';
import { esc, fmt } from './format.js';
import { txnRow, emptyRow } from './rows.js';

const DASH_RECENT = 8;

export function setTxnFilter(filter, el) {
  state.txnFilter = filter;
  document.querySelectorAll('#txn-filter button').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  renderTransactions();
}

function visibleTxns() {
  const rows = state.allTransactions
    .filter(t => classify(t) !== 'skip')
    .sort((a, b) => b.date.localeCompare(a.date));
  if (state.txnFilter === 'all') return rows;
  return rows.filter(t => classify(t) === state.txnFilter);
}

// A transaction still awaiting a verdict gets the orange "review" chip instead of
// its category chip, so the queue is visible from the full list too.
function rowFor(t) {
  const flagged = t.amount > 0 && isLazy(t) && !getEffectiveDecision(t);
  const extra = flagged ? '<span class="chip flagged">⚠ review</span>' : '';
  return txnRow(t, { extra });
}

export function renderTransactions() {
  const list = document.getElementById('txn-list');
  if (list) {
    const rows = visibleTxns();
    const count = document.getElementById('txn-count');
    if (count) {
      const sum = rows.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      count.textContent = rows.length ? `${rows.length} transactions · ${fmt(sum)} out` : '';
    }
    list.innerHTML = rows.length
      ? groupByDate(rows).map(([date, group]) =>
          `<div class="row-group-head">${esc(date)}</div>` + group.map(rowFor).join('')).join('')
      : emptyRow('No transactions in this period');
  }

  const recent = document.getElementById('dash-recent');
  if (recent) {
    const rows = state.allTransactions
      .filter(t => { const c = classify(t); return c !== 'skip' && c !== 'balance'; })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, DASH_RECENT);
    recent.innerHTML = rows.length ? rows.map(rowFor).join('') : emptyRow('No transactions in this period');
  }
}

function groupByDate(rows) {
  const by = new Map();
  rows.forEach(t => {
    if (!by.has(t.date)) by.set(t.date, []);
    by.get(t.date).push(t);
  });
  return [...by.entries()];
}
