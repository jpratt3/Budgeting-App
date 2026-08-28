// Test helpers. The frontend modules are plain browser ES modules; public/package.json
// marks that directory as ESM so Node can import them directly, with no build step and
// no test framework beyond node:test.

// classify() reads survey preferences from localStorage via getLazyPref(). Install a
// stub before anything imports the modules under test.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const { state } = await import('../public/js/state.js');
const { clearDerivedCaches } = await import('../public/js/classify.js');

let seq = 0;

// Builds a Plaid-shaped transaction. Positive amount = money out, which is Plaid's
// convention and the one the whole app depends on.
export function txn(overrides = {}) {
  const { primary = '', detailed = '', ...rest } = overrides;
  return {
    transaction_id: 'txn_' + ++seq,
    name: 'Test Merchant',
    amount: 10,
    date: '2026-08-15',
    personal_finance_category: { primary, detailed },
    ...rest,
  };
}

// Every test starts from the same blank state, with all memoization dropped.
export function reset({ decisions = {}, budgetItems = [], allTransactions = [], prefs = null } = {}) {
  state.decisions = decisions;
  state.budgetItems = budgetItems;
  state.allTransactions = allTransactions;
  state.currentDays = 30;
  store.clear();
  if (prefs) store.set('lazyPrefs', JSON.stringify(prefs));
  clearDerivedCaches();
}

export { state };
