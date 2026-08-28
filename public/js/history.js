import { state } from './state.js';
import { monthLabel, fmtShort } from './format.js';
import { classify } from './classify.js';
import { migratePendingDecisions } from './lazy.js';
import { ONE_OFF_INCOME_MIN } from './config.js';
import { C, alpha, moneyScale, catScale } from './theme.js';

let savingsHistoryChart = null;
const nwCharts = {};          // canvasId -> Chart
let historyPromise = null;    // de-dupes concurrent 365-day fetches

// One 365-day fetch shared by Reports, Cash Flow, Recurring, Accounts, and the chat
// context builder. Every caller awaits the same promise instead of racing its own.
export function ensureHistory() {
  if (state.historyTransactions) return Promise.resolve(state.historyTransactions);
  if (historyPromise) return historyPromise;
  historyPromise = fetch('/api/transactions?days=365')
    .then(r => r.json())
    .then(data => {
      state.historyTransactions = data.transactions || [];
      migratePendingDecisions(state.historyTransactions);
      return state.historyTransactions;
    })
    .catch(() => { state.historyTransactions = state.historyTransactions || []; return state.historyTransactions; })
    .finally(() => { historyPromise = null; });
  return historyPromise;
}

// Forces a refetch — used when the period changes or the user hits Refresh.
export async function reloadHistory() {
  state.historyTransactions = null;
  await ensureHistory();
  renderSavingsHistory();
  renderNetWorth();
}

export async function loadSavingsHistory() {
  await ensureHistory();
  renderSavingsHistory();
  renderNetWorth();
}

export function setHistoryRange(n) {
  state.historyMonths = n;
  document.querySelectorAll('.hist-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.hist-btn[data-hkey="${n}"]`)?.classList.add('active');
  renderSavingsHistory();
  renderNetWorth();
}

// The first calendar month in the data is a partial artifact — either the 365-day
// window truncates it, or Plaid's history for the item simply starts mid-month.
// Dropping the earliest month PRESENT handles both.
export function earliestDataMonth(txns) {
  let min = null;
  txns.forEach(t => { const ym = t.date.slice(0, 7); if (!min || ym < min) min = ym; });
  return min;
}

// Shared monthly rollup — the savings chart and the chat context bucket the same way,
// so the two views can never disagree.
export function monthlyBuckets({ dropPartial = true, allMonths = false } = {}) {
  const txns = state.historyTransactions || [];
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - state.historyMonths);
  const cutoffStr = allMonths ? '0000-00' : cutoff.toISOString().slice(0, 7);
  const dropMonth = dropPartial ? earliestDataMonth(txns) : null;

  const months = {};
  txns.forEach(t => {
    const ym = t.date.slice(0, 7);
    if (ym < cutoffStr || ym === dropMonth) return;
    if (!months[ym]) months[ym] = { recurring: 0, oneoff: 0, spent: 0, transferred: 0, essential: 0, extra: 0 };
    const type = classify(t);
    if (type === 'income') {
      const amt = -t.amount; // credits negative; reversals (positive) net out
      if (amt >= ONE_OFF_INCOME_MIN) months[ym].oneoff += amt; else months[ym].recurring += amt;
    }
    if (type === 'essential') { months[ym].spent += t.amount; months[ym].essential += t.amount; }
    if (type === 'extra')     { months[ym].spent += t.amount; months[ym].extra += t.amount; }
    if (type === 'savings') months[ym].transferred += t.amount;
  });
  return months;
}

export function renderSavingsHistory() {
  if (!state.historyTransactions) return;
  const todayMonth = new Date().toISOString().slice(0, 7);
  const months = monthlyBuckets();
  const sorted = Object.keys(months).sort();

  if (savingsHistoryChart) { savingsHistoryChart.destroy(); savingsHistoryChart = null; }
  const canvas = document.getElementById('savings-history-chart');
  if (!canvas || canvas.offsetParent === null || !sorted.length) return;

  const labels = sorted.map(monthLabel);
  const savedData = sorted.map(ym => Math.round(months[ym].recurring - months[ym].spent));
  const oneOffData = sorted.map(ym => Math.round(months[ym].oneoff));
  const transferredData = sorted.map(ym => Math.round(months[ym].transferred));

  // Average over COMPLETE months only — the in-progress month would drag it down.
  const completeIdx = sorted.map((_, i) => i).filter(i => sorted[i] !== todayMonth);
  const avg = completeIdx.length ? Math.round(completeIdx.reduce((s, i) => s + savedData[i], 0) / completeIdx.length) : 0;

  const savedColors = sorted.map((ym, i) => {
    const neg = savedData[i] < 0;
    if (ym === todayMonth) return neg ? alpha(C.spend, 0.4) : alpha(C.income, 0.4); // faded = in progress
    return neg ? C.spend : C.income;
  });

  savingsHistoryChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Saved (income − spent)', data: savedData, backgroundColor: savedColors, borderRadius: 4, order: 3 },
        { label: 'One-off inflows', data: oneOffData, backgroundColor: C.lazy, borderRadius: 4, order: 3 },
        { label: 'Transferred to savings', data: transferredData, backgroundColor: C.savings, borderRadius: 4, order: 3 },
        { type: 'line', label: `Avg saved/mo (${fmtShort(avg)})`, data: sorted.map(() => avg),
          borderColor: C.text, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false, order: 1 },
      ],
    },
    options: {
      plugins: {
        legend: { position: 'top', align: 'start' },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtShort(c.parsed.y)}` } },
      },
      scales: {
        y: moneyScale({
          beginAtZero: true,
          grid: {
            color: c => c.tick.value === 0 ? '#d8d5d0' : C.line,
            lineWidth: c => c.tick.value === 0 ? 1.5 : 1,
            drawTicks: false,
          },
        }),
        x: catScale(),
      },
    },
  });
}

// Monthly net worth series, back-walked from the live balance anchor.
export function netWorthSeries() {
  const txns = state.historyTransactions || [];
  if (!txns.length) return null;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - state.historyMonths);
  const cutoffStr = cutoff.toISOString().slice(0, 7);
  const dropMonth = earliestDataMonth(txns);

  // Monthly delta = all income (incl. one-offs) − spending, counted at transaction
  // time. Internal transfers and neutral P2P net to zero across accounts.
  const monthly = {};
  txns.forEach(t => {
    const ym = t.date.slice(0, 7);
    if (ym < cutoffStr || ym === dropMonth) return;
    if (!monthly[ym]) monthly[ym] = 0;
    const type = classify(t);
    if (type === 'income') monthly[ym] += -t.amount;
    if (type === 'essential' || type === 'extra') monthly[ym] -= t.amount;
  });

  const sorted = Object.keys(monthly).sort();
  if (!sorted.length) return null;

  const currentNW = (state.balances.checking || 0) + (state.balances.savings || 0) - (state.balances.credit || 0);
  const values = new Array(sorted.length);
  let running = currentNW;
  for (let i = sorted.length - 1; i >= 0; i--) {
    values[i] = Math.round(running);
    running -= monthly[sorted[i]]; // remove this month's contribution to get the prior balance
  }
  return { months: sorted, labels: sorted.map(monthLabel), values, current: currentNW };
}

// Draws the net-worth line into every net-worth canvas that currently has layout.
// Chart.js sizes to zero under a display:none parent, so hidden pages are skipped
// and redrawn when go() opens them.
export function renderNetWorth() {
  const series = netWorthSeries();
  if (!series) return;
  ['net-worth-chart', 'accounts-nw-chart', 'reports-nw-chart'].forEach(id => {
    const canvas = document.getElementById(id);
    if (!canvas || canvas.offsetParent === null) return;
    if (nwCharts[id]) { nwCharts[id].destroy(); delete nwCharts[id]; }
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 240);
    grad.addColorStop(0, alpha(C.income, 0.20));
    grad.addColorStop(1, alpha(C.income, 0.01));
    nwCharts[id] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: series.labels,
        datasets: [{
          label: 'Net worth', data: series.values,
          borderColor: C.income, backgroundColor: grad, borderWidth: 2,
          fill: true, tension: 0.32, pointRadius: 0, pointHoverRadius: 4,
          pointBackgroundColor: C.income,
        }],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => ` ${fmtShort(c.parsed.y)}` } },
        },
        scales: { y: moneyScale(), x: catScale() },
      },
    });
  });
}
