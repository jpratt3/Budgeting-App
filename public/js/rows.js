// Shared row markup. The transactions page, the dashboard's recent list, the review
// queue, and the recurring list all render the same visual row — this is the one
// definition of it, so they can never drift apart.
import { classify, isRentTxn } from './classify.js';
import { cleanLabel, dayLabel, esc, fmt, initial } from './format.js';

// Plaid PFC primary → chip emoji. Anything unmapped falls back to a neutral dot.
const CAT_EMOJI = {
  FOOD_AND_DRINK: '🍽', GENERAL_MERCHANDISE: '🛍', TRANSPORTATION: '🚗',
  RENT_AND_UTILITIES: '🏠', ENTERTAINMENT: '🎬', MEDICAL: '⚕', PERSONAL_CARE: '✂',
  GENERAL_SERVICES: '🧾', TRAVEL: '✈', INCOME: '💰', LOAN_PAYMENTS: '🏦',
  TRANSFER_IN: '↘', TRANSFER_OUT: '↗', HOME_IMPROVEMENT: '🔧', GOVERNMENT_AND_NON_PROFIT: '🏛',
  BANK_FEES: '💳', INSURANCE: '🛡',
};

export function txnCategory(t) {
  if (isRentTxn(t)) return 'Rent';
  const pfc = t.personal_finance_category || {};
  return cleanLabel(pfc.detailed || pfc.primary || 'Other');
}

export function txnEmoji(t) {
  const p = t.personal_finance_category?.primary || '';
  return CAT_EMOJI[p] || '•';
}

// Merchant avatar: Plaid's logo when the item provides one, otherwise the initial.
export function logoHTML(t) {
  const name = t.merchant_name || t.name || '?';
  if (t.logo_url) return `<div class="row-logo"><img src="${esc(t.logo_url)}" alt=""></div>`;
  return `<div class="row-logo">${initial(name)}</div>`;
}

// Signed amount: Plaid credits are negative, so a negative amount is money coming in.
export function amountHTML(t) {
  const credit = t.amount < 0;
  const cls = credit ? 'row-amount green' : 'row-amount';
  return `<span class="${cls}">${credit ? '+' : ''}${fmt(t.amount)}</span>`;
}

export function chipHTML(t, typeOverride) {
  const type = typeOverride || classify(t);
  const cls = ['essential', 'extra', 'savings', 'income', 'balance'].includes(type) ? type : '';
  return `<span class="chip ${cls}">${txnEmoji(t)} ${esc(txnCategory(t))}</span>`;
}

// One transaction row. `extra` is appended before the amount (used by the review
// queue for its verdict buttons).
export function txnRow(t, { extra = '', cls = '' } = {}) {
  return `<div class="row ${cls}">
    ${logoHTML(t)}
    <div class="row-main">
      <div class="row-name">${esc(t.merchant_name || t.name)}</div>
      <div class="row-meta">${esc(dayLabel(t.date))}${t.pending ? ' · pending' : ''}</div>
    </div>
    ${chipHTML(t)}
    ${extra}
    ${amountHTML(t)}
  </div>`;
}

export function emptyRow(msg) {
  return `<div class="empty">${esc(msg)}</div>`;
}
