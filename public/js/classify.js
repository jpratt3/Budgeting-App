import { state, bumpGen } from './state.js';
import {
  ESSENTIAL_CATS, INCOME_CATS, LAZY_MERCHANTS, LAZY_SURVEY_CATS, P2P_MERCHANTS,
  PHARMACY_MERCHANTS, RENT_MERCHANTS, REVIEW_CATS_DETAILED, REVIEW_CATS_PRIMARY,
  RIDESHARE_MERCHANTS, SAVINGS_CATS, SAVINGS_MERCHANTS,
} from './constants.js';

export function isRentTxn(txn) {
  if ((txn.personal_finance_category?.detailed || '') === 'RENT_AND_UTILITIES_RENT') return true;
  const name = (txn.merchant_name || txn.name || '').toLowerCase();
  return RENT_MERCHANTS.some(m => name.includes(m));
}

export function isCreditCardPayment(txn) {
  const name = (txn.name || '').toLowerCase();
  const pfc = txn.personal_finance_category?.detailed || '';
  const primary = txn.personal_finance_category?.primary || '';
  if (pfc.startsWith('LOAN_PAYMENTS_CREDIT_CARD_PAYMENT')) return true;
  return primary.startsWith('LOAN_PAYMENTS') &&
    (name.includes('card online payment') || name.includes('epayment') || name.includes('card pmt'));
}

// ── Derived caches ──────────────────────────────────────────────────────────
// classify() is called on every transaction by nearly every render path, and the
// budget page calls it once per item per transaction. Memoize per transaction_id
// and drop the whole cache whenever an input changes — a new fetch, a verdict, or
// a survey edit. Cheap to invalidate, and correctness never depends on staleness.
const classCache = new Map();
let prefsCache = null;

export function clearDerivedCaches() {
  classCache.clear();
  prefsCache = null;
  bumpGen(); // budget.js rebuilds its txn→item index off the same signal
}

function lazyPrefs() {
  if (!prefsCache) prefsCache = JSON.parse(localStorage.getItem('lazyPrefs') || '{}');
  return prefsCache;
}

export function classify(txn) {
  const key = txn.transaction_id;
  if (key !== undefined) {
    const hit = classCache.get(key);
    if (hit !== undefined) return hit;
    const val = classifyTxn(txn);
    classCache.set(key, val);
    return val;
  }
  return classifyTxn(txn);
}

function classifyTxn(txn) {
  const pfc = txn.personal_finance_category?.detailed || '';
  const primary = txn.personal_finance_category?.primary || '';
  const name = (txn.merchant_name || txn.name || '').toLowerCase();

  if (isCreditCardPayment(txn)) return 'skip';

  // Rent is real spending — must outrank the P2P and transfer skips below.
  if (isRentTxn(txn)) return 'essential';

  // Internal checking↔savings transfers appear as a pair (one leg per account).
  // The 'to sv:' / 'from sv:' memo format is bank-specific — adjust for yours.
  // Count only the checking-side legs ('to sv:' out, 'from sv:' back) as savings
  // movement; skip the savings-side duplicates so the pair isn't double counted.
  if (name.includes('to sv:') || name.includes('from sv:')) return 'savings';
  if (name.includes('from ck:') || name.includes('to ck:')) return 'skip';

  // P2P cash apps are account-to-account moves, not spending — stay neutral.
  if (P2P_MERCHANTS.some(m => name.includes(m))) return 'skip';

  // Transfers out: a known broker/HYSA is savings; any other transfer is a neutral
  // move (to a person or unlinked account), not discretionary spend.
  if (primary.startsWith('TRANSFER_OUT')) {
    return SAVINGS_MERCHANTS.some(m => name.includes(m)) ? 'savings' : 'skip';
  }

  // Real income — wages, dividends, interest, refunds.
  if (primary === 'INCOME') return 'income';
  // TRANSFER_IN (internal deposits) stays excluded so it isn't mistaken for income.
  if (INCOME_CATS.some(c => primary.startsWith(c))) return 'balance';
  if (SAVINGS_CATS.some(c => primary.startsWith(c))) return 'savings';

  // Rideshare goes to review queue, not essentials
  if (RIDESHARE_MERCHANTS.some(m => name.includes(m))) {
    const dec = state.decisions[txn.transaction_id];
    if (dec === 'essential') return 'essential';
    return 'extra';
  }

  const isPharmacy = PHARMACY_MERCHANTS.some(m => name.includes(m)) || pfc.includes('MEDICAL_PHARMACIES');
  if (isPharmacy) {
    if (state.decisions[txn.transaction_id] === 'essential') return 'essential';
    return 'extra';
  }
  if (ESSENTIAL_CATS.some(c => pfc.startsWith(c) || primary.startsWith(c))) return 'essential';
  if (name.includes('insurance')) return 'essential';

  // Check decision for anything heading to 'extra'
  const dec = state.decisions[txn.transaction_id];
  if (dec === 'essential') return 'essential';
  return 'extra';
}

export function getLazyPref(txn) {
  const prefs = lazyPrefs();
  for (const cat of LAZY_SURVEY_CATS) {
    if (cat.match(txn)) return prefs[cat.key] || 'review';
  }
  return 'review';
}

export function getEffectiveDecision(txn) {
  const explicit = state.decisions[txn.transaction_id];
  if (explicit) return explicit;
  if (getLazyPref(txn) === 'regret') return 'disapproved';
  return null;
}

export function isLazy(txn) {
  if (classify(txn) !== 'extra') return false;
  const name = (txn.merchant_name || txn.name || '').toLowerCase();
  const pfc = txn.personal_finance_category?.detailed || '';
  const primary = txn.personal_finance_category?.primary || '';
  const matches = LAZY_MERCHANTS.some(m => name.includes(m))
    || RIDESHARE_MERCHANTS.some(m => name.includes(m))
    || PHARMACY_MERCHANTS.some(m => name.includes(m))
    || REVIEW_CATS_DETAILED.some(c => pfc.includes(c))
    || REVIEW_CATS_PRIMARY.some(c => primary.startsWith(c));
  if (!matches) return false;
  return getLazyPref(txn) !== 'approve';
}

export function lazyReason(txn) {
  const name = (txn.merchant_name || txn.name || '').toLowerCase();
  const pfc = txn.personal_finance_category?.detailed || '';
  const primary = txn.personal_finance_category?.primary || '';
  if (LAZY_MERCHANTS.some(m => name.includes(m))) return 'Food delivery — could have cooked';
  if (RIDESHARE_MERCHANTS.some(m => name.includes(m))) return 'Rideshare — could have walked or taken transit';
  if (PHARMACY_MERCHANTS.some(m => name.includes(m))) return 'Pharmacy — mark as Essential if it was medicine';
  if (pfc.includes('FAST_FOOD')) return 'Fast food';
  if (pfc.includes('COFFEE')) return 'Coffee shop';
  if (pfc.includes('ALCOHOL') || pfc.includes('BAR')) return 'Bar / alcohol';
  if (pfc.includes('CONVENIENCE')) return 'Convenience store markup';
  if (pfc.includes('GAMBLING')) return 'Gambling';
  if (pfc.includes('RESTAURANT')) return 'Dining out';
  if (primary.startsWith('ENTERTAINMENT')) return 'Entertainment spend';
  if (primary.startsWith('GENERAL_MERCHANDISE')) return 'Shopping — mark as Essential if it was a necessity';
  if (primary.startsWith('FOOD_AND_DRINK')) return 'Dining out';
  return 'Discretionary spend';
}
