import { state } from './state.js';
import { applyChartDefaults } from './theme.js';
import { editBalance, loadBalances } from './accounts.js';
import { addBudgetItem, assignCategory, deleteBudgetItem, editBudgetAmount, loadBudget } from './budget.js';
import { askSuggestion, chatGrow, chatKey, resetChat, sendChat, toggleChat } from './chat.js';
import { loadAll, loadConnectedAccounts } from './data.js';
import { addMilestone, deleteMilestone, loadGrowth, renderGrowth, toggleLazyGrowth } from './growth.js';
import { ensureHistory, renderNetWorth, setHistoryRange } from './history.js';
import { decide } from './lazy.js';
import { go } from './nav.js';
import { resetLazySurvey, saveLazySurvey, showLazySurvey, surveyOptChange } from './survey.js';
import { setTxnFilter } from './transactions.js';
import { renderBalances } from './accounts.js';
import { connectBank, setPeriod } from './ui.js';

export async function migrateFromLocalStorage() {
  const localDecisions = JSON.parse(localStorage.getItem('lazy_decisions') || '{}');
  if (Object.keys(localDecisions).length > 0) {
    await Promise.all(Object.entries(localDecisions).map(([transaction_id, verdict]) =>
      fetch('/api/decisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction_id, verdict }) })
    ));
    localStorage.removeItem('lazy_decisions');
  }
  const localBalances = JSON.parse(localStorage.getItem('account_balances') || 'null');
  if (localBalances) {
    await Promise.all(Object.entries(localBalances).map(([key, amount]) =>
      fetch('/api/balances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, amount }) })
    ));
    localStorage.removeItem('account_balances');
  }
}

export async function initApp() {
  applyChartDefaults();
  await migrateFromLocalStorage();

  const decRes = await fetch('/api/decisions');
  state.decisions = (await decRes.json()).decisions || {};

  await loadBalances();
  if (!localStorage.getItem('lazySurveyDone')) showLazySurvey();

  await Promise.all([loadAll(), loadBudget(), loadGrowth(), loadConnectedAccounts()]);

  // The 365-day history backs the dashboard net-worth chart and the month-over-month
  // delta, so warm it in the background rather than waiting for a page visit.
  ensureHistory().then(() => { renderNetWorth(); renderBalances(); });
}

// The markup (both index.html and the template strings the render functions emit)
// wires interaction through inline on* attributes, which are evaluated in global
// scope. Module scope isn't global, so every entry point the DOM names has to be
// published on window explicitly — this list IS the app's public surface.
Object.assign(window, {
  addBudgetItem, addMilestone, askSuggestion, assignCategory, chatGrow, chatKey,
  connectBank, decide, deleteBudgetItem, deleteMilestone, editBalance,
  editBudgetAmount, go, loadAll, renderGrowth, resetChat, resetLazySurvey,
  saveLazySurvey, sendChat, setHistoryRange, setPeriod, setTxnFilter,
  surveyOptChange, toggleChat, toggleLazyGrowth,
});

initApp();
