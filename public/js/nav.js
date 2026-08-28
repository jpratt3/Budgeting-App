// Sidebar routing. Pages are all in the DOM; only one is display:block at a time.
//
// Chart.js measures its canvas at construction, and a canvas inside a display:none
// parent measures zero — so every page re-renders its charts on entry rather than
// trying to keep hidden ones up to date.
import { state } from './state.js';
import { ensureHistory, renderNetWorth, renderSavingsHistory } from './history.js';
import { renderPie, renderPaceChart } from './charts.js';
import { renderBudget } from './budget.js';
import { renderGrowth } from './growth.js';
import { renderSankey } from './sankey.js';
import { renderRecurring } from './recurring.js';
import { renderBalances } from './accounts.js';
import { renderHealth } from './health.js';

const TITLES = {
  dashboard: 'Dashboard',
  accounts: 'Accounts',
  transactions: 'Transactions',
  review: 'Review',
  cashflow: 'Cash Flow',
  budget: 'Budget',
  recurring: 'Recurring',
  growth: 'Growth',
  reports: 'Reports',
};

// What each page needs redrawn once it becomes visible. Pages that only contain
// HTML the last renderAll() already wrote (transactions, review) need nothing.
const ON_ENTER = {
  dashboard: () => { renderPie(...lastPie); renderPaceChart(); renderNetWorth(); withHistory(renderHealth); },
  accounts:  () => { renderBalances(); withHistory(renderNetWorth); },
  cashflow:  () => renderSankey(),
  budget:    () => renderBudget(),
  growth:    () => renderGrowth(),
  recurring: () => withHistory(renderRecurring),
  reports:   () => withHistory(() => { renderSavingsHistory(); renderNetWorth(); }),
};

// renderPie's inputs are computed in renderAll; cache them so a page re-entry can
// redraw the same chart without recomputing the whole period.
let lastPie = [0, 0, 0, 0];
export function rememberPie(ess, ext, sav, lazy) { lastPie = [ess, ext, sav, lazy]; }

// Pages that read the 365-day history render twice: once now (possibly empty, showing
// the loading state) and again when the fetch lands.
function withHistory(fn) {
  fn();
  if (!state.historyTransactions) ensureHistory().then(fn);
}

export function go(page) {
  if (!TITLES[page]) return;
  state.page = page;

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');

  document.querySelectorAll('.nav-item[data-page]').forEach(b =>
    b.classList.toggle('active', b.dataset.page === page));

  const title = document.getElementById('page-title');
  if (title) title.textContent = TITLES[page];

  ON_ENTER[page]?.();
}

// Re-runs the current page's enter hook — used after a data reload so the visible
// page picks up new numbers without a full navigation.
export function refreshCurrentPage() {
  ON_ENTER[state.page]?.();
}
