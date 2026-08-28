// ═══════════════════════════════════════════════════════════════════════════
//  YOUR CONFIGURATION — read all of this once before trusting the numbers.
//
//  Everything here describes YOUR bank and YOUR judgment calls. Where a wrong
//  guess would silently produce wrong numbers, the default is empty rather than
//  somebody else's value — an obviously missing feature beats a confidently
//  wrong dashboard.
//
//  Nothing here is secret, so this file is committed. The rules that apply to
//  everyone (Plaid's category taxonomy, national merchant brands) live in
//  rules.js and should rarely need editing.
// ═══════════════════════════════════════════════════════════════════════════


// ── Rent ───────────────────────────────────────────────────────────────────
// Plaid tags most rent as RENT_AND_UTILITIES_RENT, and that case is handled for
// you. But rent paid by ACH or Zelle arrives as a bare payee name, and the P2P
// and transfer rules would otherwise skip it — so your largest monthly expense
// would silently vanish from your spending.
//
// Add your landlord or property manager as it appears on the statement,
// lowercase. Substring match.
//   e.g. ['acme property mgmt', 'jane landlord']
export const RENT_MERCHANTS = [];


// ── Internal checking ↔ savings transfers ──────────────────────────────────
// A transfer between your own accounts appears TWICE — once per account. Left
// alone that double counts it. Banks label the two legs differently and there
// is no standard, so this has to be set per bank.
//
// Find a real transfer on the Transactions page and read the memo on each leg:
//
//   checkingSide — the leg on the CHECKING account. Counted as savings
//                  movement; this is what feeds "Transferred to savings".
//   savingsSide  — the mirror leg on the SAVINGS account. Skipped, so the pair
//                  is only counted once.
//
// One bank's format, as an example:
//   { checkingSide: ['to sv:', 'from sv:'], savingsSide: ['from ck:', 'to ck:'] }
//
// Leaving these empty is SAFE but lossy: transfers fall through to the generic
// transfer rule and are treated as neutral, so "Transferred to savings" reads
// zero. Getting them backwards is NOT safe — you would count the savings-side
// leg and skip the checking-side one.
export const INTERNAL_TRANSFER_MEMOS = {
  checkingSide: [],
  savingsSide: [],
};


// ── Merchants you consider essential ───────────────────────────────────────
// Substring match on the merchant name, applied after the Plaid category rules.
// Insurance carriers rarely have "insurance" in the descriptor, so add yours.
//   e.g. ['insurance', 'geico', 'state farm']
export const ESSENTIAL_MERCHANTS = ['insurance'];


// ── Brokerages and high-yield savings ──────────────────────────────────────
// A transfer OUT to one of these counts as savings rather than spending. Any
// other transfer out is treated as neutral. Add wherever you actually invest.
export const SAVINGS_MERCHANTS = [
  'robinhood', 'schwab', 'charles schwab', 'fidelity', 'vanguard', 'ally',
  'marcus', 'sofi', 'betterment', 'wealthfront', 'acorns', 'wealthsimple',
  'stash', 'm1 finance', 'webull', 'etrade', 'e*trade', 'ameritrade',
  'td ameritrade',
];


// ── What counts as essential ───────────────────────────────────────────────
// Plaid category prefixes (primary or detailed) that are needs rather than
// wants. This is a judgment call, not a fact: TRANSPORTATION is essential if
// you commute by car and discretionary if you mostly take rideshares for fun.
// Rideshare and pharmacy are deliberately NOT here — they go to the review
// queue so you decide per transaction.
export const ESSENTIAL_CATS = [
  'FOOD_AND_DRINK_GROCERIES', 'TRANSPORTATION', 'RENT_AND_UTILITIES',
  'MEDICAL', 'HEALTHCARE', 'HOME_IMPROVEMENT', 'INSURANCE', 'LOAN_PAYMENTS',
];


// ── One-off income threshold ───────────────────────────────────────────────
// An income credit at or above this is treated as a lump (asset sale, bonus,
// tax refund) and charted separately, so it doesn't distort your recurring
// monthly savings rate. Set it above a normal paycheck.
export const ONE_OFF_INCOME_MIN = 5000;
