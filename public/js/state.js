// Shared mutable app state.
//
// ES modules give importers a read-only view of a binding, so anything that is
// REASSIGNED across module boundaries (not just mutated) has to live on an object.
// Everything here is written by one module and read by several; state that only one
// module touches (chart instances, chat history) stays local to that module.
export const state = {
  currentDays: 14,
  periodMode: 'rolling',   // 'rolling' | 'mtd' | 'ytd'
  allTransactions: [],
  decisions: {},
  balances: { checking: 0, savings: 0 },
  historyTransactions: null,
  historyMonths: 12,
  budgetItems: [],
  milestones: [],
  lazyGrowthOn: false,
  page: 'dashboard',       // which sidebar page is showing
  txnFilter: 'all',        // Transactions page class filter
  gen: 0,                  // bumped whenever derived caches must be rebuilt
};

// Anything that changes how a transaction is classified or matched to a budget item
// bumps the generation: a new fetch, a verdict, a survey edit, a budget-category edit.
// Modules holding derived caches compare against state.gen and rebuild on a mismatch,
// which avoids a pub-sub layer (and the import cycles one would create).
export function bumpGen() { state.gen++; }
