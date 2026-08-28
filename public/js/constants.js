export const LAZY_MERCHANTS = ['ubereats','uber eats','doordash','door dash','grubhub','postmates','instacart','seamless','caviar','gopuff'];
export const PHARMACY_MERCHANTS = ['walgreens','cvs'];
export const LAZY_SURVEY_CATS = [
  { key: 'delivery',      label: 'Food delivery',          hint: 'UberEats, DoorDash, GrubHub…',
    match: t => LAZY_MERCHANTS.some(m => (t.merchant_name||t.name||'').toLowerCase().includes(m)) },
  { key: 'rideshare',     label: 'Rideshare',              hint: 'Uber, Lyft',
    match: t => RIDESHARE_MERCHANTS.some(m => (t.merchant_name||t.name||'').toLowerCase().includes(m)) },
  { key: 'restaurants',   label: 'Restaurants & dining',   hint: '',
    match: t => (t.personal_finance_category?.detailed||'').includes('RESTAURANT') },
  { key: 'fastfood',      label: 'Fast food',              hint: '',
    match: t => (t.personal_finance_category?.detailed||'').includes('FAST_FOOD') },
  { key: 'coffee',        label: 'Coffee shops',           hint: '',
    match: t => (t.personal_finance_category?.detailed||'').includes('COFFEE') },
  { key: 'bars',          label: 'Bars & alcohol',         hint: '',
    match: t => { const d = t.personal_finance_category?.detailed||''; return d.includes('ALCOHOL')||d.includes('BAR'); } },
  { key: 'convenience',   label: 'Convenience stores',     hint: '',
    match: t => (t.personal_finance_category?.detailed||'').includes('CONVENIENCE') },
  { key: 'shopping',      label: 'Shopping / merchandise', hint: 'Amazon, Target…',
    match: t => (t.personal_finance_category?.primary||'').startsWith('GENERAL_MERCHANDISE') },
  { key: 'entertainment', label: 'Entertainment',          hint: 'Movies, concerts, streaming…',
    match: t => (t.personal_finance_category?.primary||'').startsWith('ENTERTAINMENT') },
  { key: 'gambling',      label: 'Gambling',               hint: '',
    match: t => (t.personal_finance_category?.detailed||'').includes('GAMBLING') },
  { key: 'pharmacy',      label: 'Pharmacy / drugstore',   hint: 'Walgreens, CVS — medicine vs. personal items',
    match: t => {
      const n = (t.merchant_name||t.name||'').toLowerCase();
      return PHARMACY_MERCHANTS.some(m => n.includes(m)) || (t.personal_finance_category?.detailed||'').includes('MEDICAL_PHARMACIES');
    } },
];
export const RIDESHARE_MERCHANTS = ['uber','lyft'];
export const REVIEW_CATS_PRIMARY = ['FOOD_AND_DRINK','GENERAL_MERCHANDISE','ENTERTAINMENT'];
export const REVIEW_CATS_DETAILED = ['FOOD_AND_DRINK_FAST_FOOD','FOOD_AND_DRINK_RESTAURANTS','FOOD_AND_DRINK_COFFEE','FOOD_AND_DRINK_ALCOHOL_AND_BARS','GENERAL_MERCHANDISE_CONVENIENCE_STORES','GAMBLING','MEDICAL_PHARMACIES_AND_SUPPLEMENTS'];
export const ESSENTIAL_CATS = ['FOOD_AND_DRINK_GROCERIES','TRANSPORTATION','RENT_AND_UTILITIES','MEDICAL','HEALTHCARE','HOME_IMPROVEMENT','INSURANCE','LOAN_PAYMENTS'];
export const SAVINGS_CATS = ['SAVINGS','INVESTMENT'];
export const SAVINGS_MERCHANTS = ['robinhood','schwab','charles schwab','fidelity','vanguard','ally','marcus','sofi','betterment','wealthfront','acorns','wealthsimple','stash','m1 finance','webull','etrade','e*trade','ameritrade','td ameritrade'];
export const INCOME_CATS = ['INCOME','TRANSFER_IN'];
// Peer-to-peer cash apps — account-to-account moves, not purchases.
export const P2P_MERCHANTS = ['zelle','venmo','cash app','cashapp','apple cash'];
// Rent payees, lowercase substring match. Add your landlord / property manager as
// it appears on the statement — rent paid by ACH or Zelle often isn't tagged
// RENT_AND_UTILITIES_RENT by Plaid, and this list is checked before the P2P and
// transfer skips so that rent still counts as real spend.
// e.g. const RENT_MERCHANTS = ['acme property mgmt'];
export const RENT_MERCHANTS = [];

// An income credit at/above this is treated as a one-off lump (e.g. asset sale),
// charted separately so it doesn't distort the recurring monthly savings rate.
export const ONE_OFF_INCOME_MIN = 5000;

export const CHAT_TXN_CAP = 800;

export const CHAT_SUGGESTIONS = [
  "What's driving my extras?",
  'Am I on pace vs budget?',
  'Where can I cut $200/mo?',
  'How did last month compare?',
];
