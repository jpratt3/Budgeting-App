// Top-level render orchestrator. renderAll() is the single entry point every data
// change funnels through — it recomputes the period totals once and then hands the
// results to each page's renderer.
import { cleanLabel, dayLabel, esc, fmt, fmtSigned, pct } from './format.js';
import { classify, getEffectiveDecision, isLazy, isRentTxn } from './classify.js';
import { renderBalances } from './accounts.js';
import { renderPaceChart, renderPie } from './charts.js';
import { renderLazy } from './lazy.js';
import { renderBudget } from './budget.js';
import { renderGrowth } from './growth.js';
import { renderTransactions } from './transactions.js';
import { renderSankey } from './sankey.js';
import { rememberPie } from './nav.js';

// One pass over the period producing every number the pages need.
export function periodTotals(txns) {
  const buckets    = { essential: {}, extra: {}, savings: {} };
  const txnsByType = { essential: {}, extra: {}, savings: {} };
  let spent = 0, saved = 0, income = 0;

  txns.forEach(t => {
    const type = classify(t);
    if (type === 'skip' || type === 'balance') return;
    // Plaid credits are negative — negate so reversals (positive INCOME) net out.
    if (type === 'income') { income += -t.amount; return; }
    const label = isRentTxn(t) ? 'Rent'
      : type === 'savings' ? 'Savings Transfer'
      : cleanLabel(t.personal_finance_category?.detailed || t.personal_finance_category?.primary || 'Other');
    buckets[type][label] = (buckets[type][label] || 0) + t.amount;
    (txnsByType[type][label] ||= []).push(t);
    if (type === 'savings') saved += t.amount; else spent += t.amount;
  });

  return { buckets, txnsByType, spent, saved, income };
}

export function renderAll(txns) {
  const { buckets, txnsByType, spent, income } = periodTotals(txns);

  const ess = renderBucket('essentials-list', 'essentials-total', buckets.essential, txnsByType.essential);
  const ext = renderBucket('extras-list',     'extras-total',     buckets.extra,     txnsByType.extra);
  const sav = renderBucket('savings-list',    'savings-total',    buckets.savings,   txnsByType.savings);

  renderBalances();

  // ── KPI strip ────────────────────────────────────────────────────────────
  const net = income - spent;
  const set = (id, text, cls) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (cls !== undefined) el.className = 'kpi-value ' + cls;
  };
  set('income', income > 0 ? fmt(income) : '—', 'green');
  set('spent', fmt(spent), 'red');
  set('saved', income > 0 ? fmtSigned(net) : '—', net >= 0 ? 'green' : 'red');

  const rateEl = document.getElementById('savings-rate');
  if (rateEl) rateEl.textContent = income > 0 ? `${pct(net / income * 100)} savings rate` : '';

  // Effective decisions (incl. survey auto-regret) so the KPI matches the Review page.
  const lazyTotal = txns
    .filter(t => getEffectiveDecision(t) === 'disapproved' && t.amount > 0)
    .reduce((s, t) => s + t.amount, 0);
  set('lazy-total', fmt(lazyTotal), 'amber');

  const needsReview = txns.filter(t => t.amount > 0 && isLazy(t) && !getEffectiveDecision(t));
  const lazySub = document.getElementById('lazy-sub');
  if (lazySub) lazySub.textContent = needsReview.length ? `${needsReview.length} still to review` : 'all reviewed';

  const badge = document.getElementById('nav-badge-review');
  if (badge) {
    badge.textContent = needsReview.length ? String(needsReview.length) : '';
    badge.dataset.count = String(needsReview.length);
  }

  // ── Pages ────────────────────────────────────────────────────────────────
  rememberPie(ess, ext, sav, lazyTotal); // so nav can redraw the pie on page re-entry
  renderPie(ess, ext, sav, lazyTotal);
  renderLazy(txns);
  renderBudget();
  renderPaceChart();
  renderGrowth();
  renderTransactions();
  renderSankey();
}

// Collapsible category totals used by the Reports page columns.
export function renderBucket(id, totalId, bucket, txnsByCategory) {
  const el = document.getElementById(id);
  const totalEl = document.getElementById(totalId);
  if (!el) return 0;

  const entries = Object.entries(bucket).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    el.innerHTML = '<div class="empty">No transactions</div>';
    if (totalEl) totalEl.textContent = '$0';
    return 0;
  }

  let total = 0;
  el.innerHTML = entries.map(([cat, amt]) => {
    total += amt;
    const catTxns = ((txnsByCategory && txnsByCategory[cat]) || [])
      .sort((a, b) => b.date.localeCompare(a.date));
    const txnRows = catTxns.map(t => `<div class="cat-txn">
      <span class="cat-txn-name">${esc(t.merchant_name || t.name)}</span>
      <span class="cat-txn-date">${esc(dayLabel(t.date))}</span>
      <span class="cat-txn-amount ${t.amount < 0 ? 'green' : ''}">${t.amount < 0 ? '+' : ''}${fmt(t.amount)}</span>
    </div>`).join('');
    return `<div class="category-row" onclick="this.classList.toggle('open')">
      <div class="cat-top">
        <span>${esc(cat)}</span>
        <span class="cat-amt">${fmt(amt)}</span>
        <span class="cat-chevron">▾</span>
      </div>
      ${txnRows ? `<div class="cat-txns">${txnRows}</div>` : ''}
    </div>`;
  }).join('');

  if (totalEl) totalEl.textContent = fmt(total);
  return total;
}
