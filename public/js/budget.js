import { state, bumpGen } from './state.js';
import { esc, fmt, fmtSigned, pct } from './format.js';
import { classify, clearDerivedCaches, isRentTxn } from './classify.js';
import { ESSENTIAL_CATS } from './constants.js';
import { C, moneyScale, catScale } from './theme.js';

let budgetChart = null;

// ── Transaction → budget item matching ──────────────────────────────────────
// Assign each spend transaction to at most ONE budget item — the most specific
// (longest) matching category prefix wins. Prevents double counting when one item
// maps a primary (ENTERTAINMENT) and another maps a detailed cat under it.
export function budgetItemIdForTxn(t) {
  const type = classify(t);
  if (type !== 'essential' && type !== 'extra') return null; // transfers/income/savings aren't budget spend
  const pfc = t.personal_finance_category?.detailed || '';
  const prim = t.personal_finance_category?.primary || '';
  let best = null, bestLen = -1;
  state.budgetItems.forEach(i => {
    if (i.type !== 'variable' || !i.plaid_cats) return;
    i.plaid_cats.split(',').map(s => s.trim()).filter(Boolean).forEach(c => {
      if ((pfc.startsWith(c) || prim.startsWith(c)) && c.length > bestLen) { best = i.id; bestLen = c.length; }
    });
  });
  return best;
}

// The match is identical for every caller, so compute it once per generation instead
// of re-deriving it inside each item's filter. Without this, rendering the Budget page
// ran budgetItemIdForTxn (and therefore classify) once per transaction PER item, then
// again for the chart, then again for the pace bar.
let index = null;
let indexGen = -1;
let indexSize = -1;

function matchIndex() {
  if (index && indexGen === state.gen && indexSize === state.allTransactions.length) return index;
  index = new Map();
  state.allTransactions.forEach(t => index.set(t.transaction_id, budgetItemIdForTxn(t)));
  indexGen = state.gen;
  indexSize = state.allTransactions.length;
  return index;
}

export function uncategorizedTxns() {
  const idx = matchIndex();
  return state.allTransactions.filter(t => {
    const type = classify(t);
    if (type !== 'essential' && type !== 'extra') return false;
    if (t.amount <= 0) return false;
    if (isRentTxn(t)) return false; // covered by the Rent fixed line, not a variable bucket
    return idx.get(t.transaction_id) === null;
  }).sort((a, b) => b.date.localeCompare(a.date));
}

export function txnsForItem(item) {
  if (!item.plaid_cats) return [];
  const idx = matchIndex();
  return state.allTransactions
    .filter(t => idx.get(t.transaction_id) === item.id)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function actualForItem(item) {
  return txnsForItem(item).reduce((s, t) => s + t.amount, 0);
}

export function isEssentialItem(item) {
  if (!item.plaid_cats) return false;
  const cats = item.plaid_cats.split(',').map(s => s.trim());
  if (cats.some(c => c.startsWith('TRANSPORTATION_TAXIS_AND_RIDE_SHARES'))) return false;
  if (cats.some(c => c.startsWith('GENERAL_MERCHANDISE'))) return false;
  return cats.some(c => ESSENTIAL_CATS.some(e => c.startsWith(e) || e.startsWith(c)));
}

// ── Render ──────────────────────────────────────────────────────────────────
function itemHTML(item, kind) {
  const scaleFactor = state.currentDays / 30;
  const isVar = item.type === 'variable';
  const matchedTxns = isVar ? txnsForItem(item) : [];
  const actual = isVar ? matchedTxns.reduce((s, t) => s + t.amount, 0) : null;
  const periodBudget = item.amount * scaleFactor;
  const over = actual !== null && actual > periodBudget;
  const usedPct = periodBudget > 0 && actual !== null ? Math.min(100, actual / periodBudget * 100) : 0;

  const actualCol = actual !== null
    ? `<span class="budget-item-actual ${over ? 'over' : ''}">${fmt(actual)} / ${fmt(periodBudget)}</span>`
    : `<span class="budget-item-actual">/mo</span>`;

  const txnRows = matchedTxns.map(t => `<div class="cat-txn">
    <span class="cat-txn-name">${esc(t.merchant_name || t.name)}</span>
    <span class="cat-txn-date">${esc(t.date)}</span>
    <span class="cat-txn-amount">${fmt(t.amount)}</span>
  </div>`).join('');

  const expandable = isVar && txnRows;
  const dot = kind ? `<span class="budget-dot ${kind}"></span>` : '';

  return `<div class="budget-item${expandable ? ' budget-item-expandable' : ''}" data-id="${item.id}">
    <div class="budget-item-top"${expandable ? ' onclick="this.parentNode.classList.toggle(\'open\')"' : ''}>
      ${dot}
      <span class="budget-item-label">${esc(item.label)}</span>
      ${actualCol}
      <span class="budget-item-amount" onclick="event.stopPropagation();editBudgetAmount(${item.id})">${fmt(item.amount)}</span>
      ${expandable ? '<span class="cat-chevron">▾</span>' : ''}
      <button class="budget-item-del" onclick="event.stopPropagation();deleteBudgetItem(${item.id})">✕</button>
    </div>
    ${isVar ? `<div class="budget-bar"><span class="${over ? 'over' : ''}" style="width:${over ? 100 : usedPct}%"></span></div>` : ''}
    ${expandable ? `<div class="cat-txns">${txnRows}</div>` : ''}
  </div>`;
}

export function renderBudget() {
  const constants = [...state.budgetItems.filter(i => i.type === 'constant')].sort((a, b) => b.amount - a.amount);
  const variables = state.budgetItems.filter(i => i.type === 'variable');
  const essVars = variables.filter(i => isEssentialItem(i)).sort((a, b) => b.amount - a.amount);
  const extVars = variables.filter(i => !isEssentialItem(i)).sort((a, b) => b.amount - a.amount);

  const constEl = document.getElementById('budget-constants-list');
  if (constEl) {
    constEl.innerHTML = constants.length
      ? constants.map(i => itemHTML(i, 'essential')).join('')
      : '<div class="empty">No fixed expenses added</div>';
  }

  // ── Uncategorized ────────────────────────────────────────────────────────
  const uncatTxns = uncategorizedTxns();
  const uncatTotal = uncatTxns.reduce((s, t) => s + t.amount, 0);
  const varOptions = variables.map(i => `<option value="${i.id}">${esc(i.label)}</option>`).join('');
  const uncatRows = uncatTxns.map(t => {
    const plaidCat = (t.personal_finance_category?.detailed || t.personal_finance_category?.primary || '').trim();
    return `<div class="cat-txn">
      <span class="cat-txn-name">${esc(t.merchant_name || t.name)}</span>
      <span class="cat-txn-date" style="color:var(--faint)">${esc(plaidCat)}</span>
      <span class="cat-txn-date">${esc(t.date)}</span>
      <span class="cat-txn-amount">${fmt(t.amount)}</span>
      ${plaidCat ? `<select class="uncat-assign" onclick="event.stopPropagation()"
        onchange="assignCategory('${esc(t.transaction_id)}', this.value, '${esc(plaidCat)}', this)">
        <option value="">Assign to…</option>${varOptions}
      </select>` : ''}
    </div>`;
  }).join('');

  const uncatItem = uncatTxns.length ? `<div class="budget-item budget-item-expandable">
    <div class="budget-item-top" onclick="this.parentNode.classList.toggle('open')">
      <span class="budget-dot extra"></span>
      <span class="budget-item-label" style="color:var(--accent)">Uncategorized</span>
      <span class="budget-item-actual over">${fmt(uncatTotal)}</span>
      <span class="budget-item-amount" style="cursor:default">${uncatTxns.length} txns</span>
      <span class="cat-chevron">▾</span>
    </div>
    <div class="cat-txns">${uncatRows}</div>
  </div>` : '';

  const varEl = document.getElementById('budget-variables-list');
  if (varEl) {
    const essHdr = essVars.length ? '<div class="row-group-head">Essentials</div>' : '';
    const extHdr = extVars.length ? '<div class="row-group-head">Discretionary</div>' : '';
    const varHTML = variables.length
      ? essHdr + essVars.map(i => itemHTML(i, 'essential')).join('') + extHdr + extVars.map(i => itemHTML(i, 'extra')).join('')
      : '<div class="empty">No variable categories added</div>';
    varEl.innerHTML = varHTML + uncatItem;
  }

  renderBudgetChart([...essVars, ...extVars]);
  renderProjection(constants, variables);
}

function renderBudgetChart(chartVars) {
  if (budgetChart) { budgetChart.destroy(); budgetChart = null; }
  const canvas = document.getElementById('budget-chart');
  if (!canvas || canvas.offsetParent === null || !chartVars.length) return;
  budgetChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: chartVars.map(i => i.label),
      datasets: [
        { label: 'Budget', data: chartVars.map(i => i.amount * (state.currentDays / 30)), backgroundColor: '#d8d5d0', borderRadius: 4 },
        { label: 'Actual', data: chartVars.map(i => actualForItem(i)), backgroundColor: C.accent, borderRadius: 4 },
      ],
    },
    options: {
      plugins: {
        legend: { position: 'top', align: 'start' },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } },
      },
      scales: { y: moneyScale({ beginAtZero: true }), x: catScale() },
    },
  });
}

function renderProjection(constants, variables) {
  let periodIncome = 0, totalSpending = 0, detectedFixed = 0;
  state.allTransactions.forEach(t => {
    const type = classify(t);
    if (type === 'income') periodIncome += -t.amount; // credits negative; reversals net out
    if ((type === 'essential' || type === 'extra') && t.amount > 0) {
      totalSpending += t.amount;
      // Rent/utilities that DID hit the account — tracked here so we don't double-count
      // them against the budgeted fixed expenses below.
      if ((t.personal_finance_category?.primary || '') === 'RENT_AND_UTILITIES' || isRentTxn(t)) detectedFixed += t.amount;
    }
  });

  const monthlyIncome = state.currentDays > 0 ? periodIncome * (30 / state.currentDays) : 0;
  const constTotal = constants.reduce((s, i) => s + i.amount, 0);
  const varTotal = variables.reduce((s, i) => s + i.amount, 0);
  const projSavings = monthlyIncome - constTotal - varTotal;

  const categorizedSpending = variables.reduce((s, i) => s + actualForItem(i), 0);
  const coveragePct = totalSpending > 0 ? Math.round(categorizedSpending / totalSpending * 100) : 0;

  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('proj-income', monthlyIncome > 0 ? fmt(monthlyIncome) : '—');
  set('proj-constants', fmt(constTotal));
  set('proj-variables', fmt(varTotal));

  const savEl = document.getElementById('proj-savings');
  if (savEl) {
    savEl.textContent = monthlyIncome > 0 ? fmtSigned(projSavings) : '—';
    savEl.className = projSavings < 0 ? 'red' : '';
  }

  // Actual realized savings over the selected period: income − detected spending − fixed
  // costs. Fixed costs (e.g. rent via Zelle) aren't always captured as spend transactions,
  // so subtract the budgeted constants prorated to the period, then remove any
  // rent/utilities already detected so they aren't counted twice.
  const proratedFixed = constTotal * (state.currentDays / 30);
  const actualSavings = periodIncome - (totalSpending - detectedFixed) - proratedFixed;
  const actEl = document.getElementById('proj-actual');
  if (actEl) {
    actEl.textContent = state.allTransactions.length ? fmtSigned(actualSavings) : '—';
    actEl.className = actualSavings < 0 ? 'red' : '';
  }

  set('proj-coverage', totalSpending > 0 ? `${fmt(categorizedSpending)} / ${fmt(totalSpending)} (${pct(coveragePct)})` : '—');
}

// ── CRUD ────────────────────────────────────────────────────────────────────
export async function loadBudget() {
  const res = await fetch('/api/budget');
  const data = await res.json();
  state.budgetItems = data.items || [];
  bumpGen();
  renderBudget();
}

export function editBudgetAmount(id) {
  const item = state.budgetItems.find(i => i.id === id);
  if (!item) return;
  const el = document.querySelector(`[data-id="${id}"] .budget-item-amount`);
  if (!el || el.querySelector('input')) return;
  const input = document.createElement('input');
  input.type = 'number'; input.step = '1'; input.value = item.amount.toFixed(0);
  input.className = 'budget-input';
  input.onclick = e => e.stopPropagation();
  input.onblur = () => {
    item.amount = parseFloat(input.value) || 0;
    fetch('/api/budget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
    renderBudget();
  };
  input.onkeydown = e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') renderBudget(); };
  el.textContent = '';
  el.appendChild(input);
  input.focus(); input.select();
}

export async function addBudgetItem(type) {
  const label = prompt(type === 'constant' ? 'Expense name (e.g. Rent):' : 'Category name (e.g. Groceries):');
  if (!label) return;
  const amount = parseFloat(prompt('Monthly budget ($):') || '0') || 0;
  const plaid_cats = type === 'variable'
    ? (prompt('Plaid category prefix (optional — leave blank to skip chart matching):\nExamples: FOOD_AND_DRINK_GROCERIES, TRANSPORTATION') || '')
    : '';
  const res = await fetch('/api/budget', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, amount, type, plaid_cats }),
  });
  const data = await res.json();
  state.budgetItems.push({ id: data.id, label, amount, type, plaid_cats });
  bumpGen();
  renderBudget();
}

export async function deleteBudgetItem(id) {
  await fetch(`/api/budget/${id}`, { method: 'DELETE' });
  state.budgetItems = state.budgetItems.filter(i => i.id !== id);
  bumpGen();
  renderBudget();
}

export async function assignCategory(txnId, bucketId, plaidCat, selectEl) {
  if (!bucketId || !plaidCat) return;
  const item = state.budgetItems.find(i => i.id == bucketId);
  if (!item) return;
  const existing = item.plaid_cats ? item.plaid_cats.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (existing.includes(plaidCat)) { selectEl.value = ''; return; }
  const updated = [...existing, plaidCat].join(',');
  await fetch('/api/budget', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: item.id, label: item.label, amount: item.amount, type: item.type, plaid_cats: updated }),
  });
  item.plaid_cats = updated;
  clearDerivedCaches(); // the new prefix changes which transactions match
  renderBudget();
}
