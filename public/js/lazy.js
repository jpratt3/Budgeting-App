// The Review queue — the app's opinionated feature. Every flagged extra gets one of
// three verdicts, persisted to SQLite by transaction_id.
import { state } from './state.js';
import { fmt, esc } from './format.js';
import { clearDerivedCaches, getEffectiveDecision, isLazy, lazyReason } from './classify.js';
import { txnRow, emptyRow } from './rows.js';
import { renderAll } from './overview.js';

function verdictButtons(id, dec) {
  const on = v => dec === v ? ' on-' + v : '';
  return `<div class="review-actions">
    <button class="review-btn essential${on('essential')}" onclick="decide('${esc(id)}','essential')">Essential</button>
    <button class="review-btn worth${on('worth')}${dec === 'approved' ? ' on-worth' : ''}" onclick="decide('${esc(id)}','approved')">Worth it</button>
    <button class="review-btn regret${dec === 'disapproved' ? ' on-regret' : ''}" onclick="decide('${esc(id)}','disapproved')">Regret</button>
  </div>`;
}

function reviewRow(t) {
  const dec = getEffectiveDecision(t);
  const cls = dec === 'disapproved' ? 'regretted' : dec ? 'resolved' : '';
  const reason = `<span class="review-reason" title="${esc(lazyReason(t))}">${esc(lazyReason(t))}</span>`;
  return txnRow(t, { cls, extra: reason + verdictButtons(t.transaction_id, dec) });
}

export function renderLazy(txns) {
  const flagged = txns.filter(t => t.amount > 0 && (isLazy(t) || state.decisions[t.transaction_id]));
  const needsReview = flagged.filter(t => !getEffectiveDecision(t));
  const regretted   = flagged.filter(t => getEffectiveDecision(t) === 'disapproved');
  const resolved    = flagged.filter(t => {
    const d = getEffectiveDecision(t);
    return d === 'approved' || d === 'essential';
  });

  const regrettedTotal = regretted.reduce((s, t) => s + t.amount, 0);
  const reviewTotal    = needsReview.reduce((s, t) => s + t.amount, 0);

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('lazy-count', String(needsReview.length));
  set('lazy-sum', fmt(reviewTotal));
  set('lazy-approved', String(resolved.filter(t => getEffectiveDecision(t) === 'approved').length));
  set('lazy-disapproved', String(regretted.length));

  const list = document.getElementById('lazy-list');
  if (!list) return;
  if (!flagged.length) {
    list.innerHTML = emptyRow('No spending flagged for review this period');
    return;
  }

  let html = '';
  if (needsReview.length) {
    html += `<div class="row-group-head">Needs review (${needsReview.length}) · ${fmt(reviewTotal)}</div>`;
    html += needsReview.map(reviewRow).join('');
  }
  if (regretted.length) {
    html += `<div class="row-group-head" style="color:var(--spend)">Regretted (${regretted.length}) · ${fmt(regrettedTotal)}</div>`;
    html += regretted.map(reviewRow).join('');
  }
  if (resolved.length) {
    html += `<div class="row-group-head">Resolved (${resolved.length})</div>`;
    html += resolved.map(reviewRow).join('');
  }
  list.innerHTML = html;
}

// Plaid assigns a NEW transaction_id when a pending transaction posts, which would
// orphan any verdict made while it was pending. Posted txns carry the old id in
// pending_transaction_id — carry the verdict forward and persist it under the new id.
export function migratePendingDecisions(txns) {
  txns.forEach(t => {
    const pid = t.pending_transaction_id;
    if (!pid || !state.decisions[pid] || state.decisions[t.transaction_id]) return;
    state.decisions[t.transaction_id] = state.decisions[pid];
    fetch('/api/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_id: t.transaction_id, verdict: state.decisions[pid] }),
    });
  });
}

export function decide(id, verdict) {
  state.decisions[id] = verdict;
  // An 'essential' verdict changes what classify() returns for this transaction, so
  // the memo has to go before anything re-reads it.
  clearDerivedCaches();
  fetch('/api/decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_id: id, verdict }),
  });
  // Full re-render so an essential promotion updates the buckets and KPIs too.
  if (state.allTransactions.length) renderAll(state.allTransactions);
}
