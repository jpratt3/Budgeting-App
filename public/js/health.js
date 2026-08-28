// Setup health — turns silent misconfiguration into something you can see.
//
// The classification engine fails quietly by design: an unrecognised transfer memo
// just falls through to "neutral", an unlisted landlord just isn't rent. That is the
// right behaviour for the engine (a wrong guess is worse than no guess) but it means
// a half-configured install shows confident, wrong numbers. These checks say so.
//
// Structural checks (rent, transfers) run against the 12-month history rather than
// the selected period — otherwise a 2-week window would report "no rent detected"
// every time, which is noise rather than signal.
import { state } from './state.js';
import { classify, isRentTxn } from './classify.js';
import { INTERNAL_TRANSFER_MEMOS, RENT_MERCHANTS } from './config.js';
import { uncategorizedTxns } from './budget.js';
import { esc, fmt, pct } from './format.js';

const DISMISS_KEY = 'healthDismissed';
const COVERAGE_FLOOR = 70; // % of spend that should map to a budget item

function dismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); }
  catch { return new Set(); }
}

export function dismissHealth(id) {
  const set = dismissed();
  set.add(id);
  localStorage.setItem(DISMISS_KEY, JSON.stringify([...set]));
  renderHealth();
}

export function resetHealth() {
  localStorage.removeItem(DISMISS_KEY);
  renderHealth();
}

export function healthChecks() {
  const out = [];
  const period = state.allTransactions;
  // Structural questions are asked of the widest data we have.
  const structural = state.historyTransactions?.length ? state.historyTransactions : period;
  const structuralWindow = state.historyTransactions?.length ? 'the last 12 months' : 'this period';
  if (!period.length) return out;

  // ── 1. Internal checking↔savings transfers ────────────────────────────────
  const memoCount = INTERNAL_TRANSFER_MEMOS.checkingSide.length + INTERNAL_TRANSFER_MEMOS.savingsSide.length;
  if (!memoCount) {
    const transferish = structural.filter(t =>
      (t.personal_finance_category?.primary || '').startsWith('TRANSFER_')).length;
    out.push({
      id: 'transfers',
      severity: transferish ? 'warn' : 'info',
      title: 'Internal transfers not configured',
      detail: transferish
        ? `${transferish} transfer${transferish === 1 ? '' : 's'} in ${structuralWindow} can't be matched to a checking↔savings pair, so "Transferred to savings" reads $0.`
        : `No checking↔savings memo format is set, so transfers into savings won't be counted.`,
      fix: 'INTERNAL_TRANSFER_MEMOS in public/js/config.js',
    });
  }

  // ── 2. Rent ───────────────────────────────────────────────────────────────
  if (!structural.some(isRentTxn)) {
    out.push({
      id: 'rent',
      severity: 'warn',
      title: 'No rent or mortgage detected',
      detail: RENT_MERCHANTS.length
        ? `Your RENT_MERCHANTS list didn't match anything in ${structuralWindow}.`
        : `Rent paid by ACH or Zelle isn't tagged by Plaid, so your largest monthly expense may be missing from spending entirely.`,
      fix: 'RENT_MERCHANTS in public/js/config.js',
    });
  }

  // ── 3. Income ─────────────────────────────────────────────────────────────
  // `spend` is total outflow; `variableSpend` excludes rent, which is covered by a
  // fixed budget line rather than a variable category. Mixing the two would inflate
  // the coverage figure below — rent is usually the single biggest charge, so
  // counting it as "covered" hid genuinely poor category mapping.
  let income = 0, spend = 0, variableSpend = 0;
  period.forEach(t => {
    const type = classify(t);
    if (type === 'income') { income += -t.amount; return; }
    if ((type === 'essential' || type === 'extra') && t.amount > 0) {
      spend += t.amount;
      if (!isRentTxn(t)) variableSpend += t.amount;
    }
  });
  if (income <= 0) {
    out.push({
      id: 'income',
      severity: 'warn',
      title: 'No income in this period',
      detail: 'Savings rate, projected savings, and the growth projection are all derived from income — they will read as blank or wrong until a paycheck lands in the window.',
      fix: 'Widen the period, or check that your paycheck account is linked',
    });
  }

  // ── 4. Budget coverage ────────────────────────────────────────────────────
  if (variableSpend > 0 && state.budgetItems.some(i => i.type === 'variable')) {
    const uncat = uncategorizedTxns().reduce((s, t) => s + t.amount, 0);
    const coverage = (1 - uncat / variableSpend) * 100;
    if (coverage < COVERAGE_FLOOR) {
      out.push({
        id: 'coverage',
        severity: 'info',
        title: `Only ${pct(coverage)} of spending is budgeted`,
        detail: `${fmt(uncat)} isn't mapped to any variable category, so budget-vs-actual and the pace bar understate what you're spending.`,
        fix: 'Assign the Uncategorized rows on the Budget page',
      });
    }
  }

  // ── 5. Live balances ──────────────────────────────────────────────────────
  if (!state.balances.live) {
    out.push({
      id: 'balances',
      severity: 'warn',
      title: 'Balances are a stored snapshot',
      detail: 'Plaid did not return live balances, so net worth is whatever was last saved. Re-linking the account usually fixes it.',
      fix: 'Connect account in the sidebar',
    });
  } else if (state.balances.partial) {
    out.push({
      id: 'balances-partial',
      severity: 'info',
      title: 'Some accounts did not report',
      detail: 'At least one linked institution errored, so balances and net worth are incomplete.',
      fix: 'See Accounts for which one',
    });
  }

  return out;
}

export function renderHealth() {
  const el = document.getElementById('setup-health');
  if (!el) return;

  const skip = dismissed();
  const all = healthChecks();
  const items = all.filter(c => !skip.has(c.id));

  if (!items.length) {
    // Leave a way back if everything visible was dismissed rather than fixed.
    el.innerHTML = all.length
      ? `<div class="health-cleared">${all.length} setup ${all.length === 1 ? 'note' : 'notes'} hidden ·
         <button class="linkish" onclick="resetHealth()">show</button></div>`
      : '';
    return;
  }

  const warn = items.filter(i => i.severity === 'warn').length;
  el.innerHTML = `<div class="health">
    <div class="health-head">
      <span>⚠</span>
      <span>Setup needs attention</span>
      <span class="health-count">${warn ? `${warn} likely to affect your numbers` : 'minor'}</span>
    </div>
    ${items.map(i => `<div class="health-item ${esc(i.severity)}">
      <span class="health-dot"></span>
      <div class="health-body">
        <div class="health-title">${esc(i.title)}</div>
        <div class="health-detail">${esc(i.detail)}</div>
        <div class="health-fix">${esc(i.fix)}</div>
      </div>
      <button class="health-x" title="Dismiss" onclick="dismissHealth('${esc(i.id)}')">✕</button>
    </div>`).join('')}
  </div>`;
}
