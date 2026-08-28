// Regression tests for classify().
//
// classify() is a ladder of early returns, so its ORDER is load-bearing: rent has to
// outrank the P2P skip or rent paid by Zelle disappears from spending; rideshare has
// to outrank ESSENTIAL_CATS or every Uber silently becomes a necessity. Those are the
// cases that are easy to break and impossible to notice, so they get the most tests.
//
// Tests that depend on values in config.js read those values rather than hardcoding
// them, so the suite stays true for whatever a given install is configured with.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { txn, reset, state } from './helpers.mjs';
import {
  classify, clearDerivedCaches, getEffectiveDecision, isCreditCardPayment, isLazy, isRentTxn,
} from '../public/js/classify.js';
import {
  ESSENTIAL_CATS, ESSENTIAL_MERCHANTS, INTERNAL_TRANSFER_MEMOS, RENT_MERCHANTS, SAVINGS_MERCHANTS,
} from '../public/js/config.js';
import { P2P_MERCHANTS, RIDESHARE_MERCHANTS, PHARMACY_MERCHANTS, LAZY_MERCHANTS } from '../public/js/rules.js';

describe('order: credit card payments outrank everything', () => {
  test('detailed LOAN_PAYMENTS_CREDIT_CARD_PAYMENT is skipped', () => {
    reset();
    assert.equal(classify(txn({ primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' })), 'skip');
  });

  test('LOAN_PAYMENTS with a payment-shaped memo is skipped', () => {
    reset();
    for (const memo of ['CARD ONLINE PAYMENT', 'EPAYMENT THANK YOU', 'CARD PMT AUTOPAY']) {
      assert.equal(classify(txn({ name: memo, primary: 'LOAN_PAYMENTS' })), 'skip', memo);
    }
  });

  test('a LOAN_PAYMENTS charge that is NOT a card payment stays essential', () => {
    // LOAN_PAYMENTS is in ESSENTIAL_CATS — a car loan should still count as spending.
    reset();
    assert.equal(isCreditCardPayment(txn({ name: 'AUTO LOAN', primary: 'LOAN_PAYMENTS' })), false);
    assert.equal(classify(txn({ name: 'AUTO LOAN', primary: 'LOAN_PAYMENTS' })), 'essential');
  });

  test('card payments outrank the essential category they live under', () => {
    reset();
    assert.equal(classify(txn({ name: 'CARD ONLINE PAYMENT', primary: 'LOAN_PAYMENTS' })), 'skip');
  });
});

describe('order: rent outranks the P2P and transfer skips', () => {
  test('rent tagged by Plaid is essential', () => {
    reset();
    assert.equal(classify(txn({ primary: 'RENT_AND_UTILITIES', detailed: 'RENT_AND_UTILITIES_RENT' })), 'essential');
  });

  test('rent paid through a P2P app is still essential, not skipped', () => {
    // The whole reason rent is checked first: without it, Zelle rent vanishes.
    reset();
    const t = txn({ name: `${P2P_MERCHANTS[0]} payment to landlord`, detailed: 'RENT_AND_UTILITIES_RENT' });
    assert.equal(classify(t), 'essential');
  });

  test('rent sent as a TRANSFER_OUT is still essential', () => {
    reset();
    const t = txn({ name: 'ACH TRANSFER', primary: 'TRANSFER_OUT', detailed: 'RENT_AND_UTILITIES_RENT' });
    assert.equal(classify(t), 'essential');
  });

  test('a configured rent payee is matched by name alone', (t) => {
    const payee = RENT_MERCHANTS[0];
    if (!payee) return t.skip('RENT_MERCHANTS is empty — see public/js/config.js');
    reset();
    assert.equal(isRentTxn(txn({ merchant_name: payee.toUpperCase() })), true);
  });

  test('with RENT_MERCHANTS empty, an untagged landlord is NOT rent', (t) => {
    if (RENT_MERCHANTS.length) return t.skip('RENT_MERCHANTS is configured');
    // This is precisely the silent gap health.js warns about.
    reset();
    assert.equal(isRentTxn(txn({ merchant_name: 'Acme Property Mgmt' })), false);
  });
});

describe('internal checking <-> savings transfers', () => {
  test('checking-side memos count as savings movement', (t) => {
    const memo = INTERNAL_TRANSFER_MEMOS.checkingSide[0];
    if (!memo) return t.skip('INTERNAL_TRANSFER_MEMOS.checkingSide is empty — see public/js/config.js');
    reset();
    assert.equal(classify(txn({ name: `ONLINE TRANSFER ${memo.toUpperCase()} 1234`, primary: 'TRANSFER_OUT' })), 'savings');
  });

  test('savings-side memos are skipped so the pair is not double counted', (t) => {
    const memo = INTERNAL_TRANSFER_MEMOS.savingsSide[0];
    if (!memo) return t.skip('INTERNAL_TRANSFER_MEMOS.savingsSide is empty — see public/js/config.js');
    reset();
    assert.equal(classify(txn({ name: `ONLINE TRANSFER ${memo.toUpperCase()} 1234`, primary: 'TRANSFER_IN' })), 'skip');
  });

  test('unconfigured memos leave transfers neutral rather than guessing', (t) => {
    if (INTERNAL_TRANSFER_MEMOS.checkingSide.length) return t.skip('memos are configured');
    reset();
    // Falls through to the generic TRANSFER_OUT rule: neutral, not savings.
    assert.equal(classify(txn({ name: 'ONLINE TRANSFER TO SAVINGS', primary: 'TRANSFER_OUT' })), 'skip');
  });
});

describe('transfers and P2P', () => {
  test('P2P cash apps are neutral, not spending', () => {
    reset();
    for (const m of P2P_MERCHANTS) {
      assert.equal(classify(txn({ name: `${m} to a friend` })), 'skip', m);
    }
  });

  test('TRANSFER_OUT to a configured brokerage counts as savings', () => {
    reset();
    for (const broker of SAVINGS_MERCHANTS.slice(0, 4)) {
      assert.equal(classify(txn({ name: `TRANSFER TO ${broker.toUpperCase()}`, primary: 'TRANSFER_OUT' })), 'savings', broker);
    }
  });

  test('TRANSFER_OUT to anything else is neutral, not spending', () => {
    reset();
    assert.equal(classify(txn({ name: 'TRANSFER TO UNKNOWN ACCT', primary: 'TRANSFER_OUT' })), 'skip');
  });
});

describe('income', () => {
  test('primary INCOME is income', () => {
    reset();
    assert.equal(classify(txn({ name: 'PAYROLL DEPOSIT', primary: 'INCOME', amount: -2000 })), 'income');
  });

  test('TRANSFER_IN is excluded, never mistaken for income', () => {
    reset();
    assert.equal(classify(txn({ name: 'DEPOSIT', primary: 'TRANSFER_IN', amount: -500 })), 'balance');
  });
});

describe('order: review queue outranks the essential categories', () => {
  test('rideshare is extra even though TRANSPORTATION is an essential category', () => {
    assert.ok(ESSENTIAL_CATS.includes('TRANSPORTATION'), 'precondition: TRANSPORTATION is essential');
    reset();
    const t = txn({ merchant_name: RIDESHARE_MERCHANTS[0], primary: 'TRANSPORTATION', detailed: 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES' });
    assert.equal(classify(t), 'extra');
  });

  test('pharmacy is extra even though MEDICAL is an essential category', () => {
    assert.ok(ESSENTIAL_CATS.includes('MEDICAL'), 'precondition: MEDICAL is essential');
    reset();
    const t = txn({ merchant_name: PHARMACY_MERCHANTS[0], primary: 'MEDICAL', detailed: 'MEDICAL_PHARMACIES_AND_SUPPLEMENTS' });
    assert.equal(classify(t), 'extra');
  });

  test('an Essential verdict promotes rideshare and pharmacy', () => {
    const ride = txn({ merchant_name: RIDESHARE_MERCHANTS[0], primary: 'TRANSPORTATION' });
    const rx = txn({ merchant_name: PHARMACY_MERCHANTS[0], primary: 'MEDICAL' });
    reset({ decisions: { [ride.transaction_id]: 'essential', [rx.transaction_id]: 'essential' } });
    assert.equal(classify(ride), 'essential');
    assert.equal(classify(rx), 'essential');
  });
});

describe('essentials and extras', () => {
  test('every configured essential category classifies as essential', () => {
    reset();
    for (const cat of ESSENTIAL_CATS) {
      assert.equal(classify(txn({ primary: cat })), 'essential', cat);
    }
  });

  test('configured essential merchants classify as essential', () => {
    reset();
    for (const m of ESSENTIAL_MERCHANTS) {
      assert.equal(classify(txn({ name: `${m.toUpperCase()} PREMIUM` })), 'essential', m);
    }
  });

  test('anything unmatched falls through to extra', () => {
    reset();
    assert.equal(classify(txn({ name: 'Some Shop', primary: 'GENERAL_MERCHANDISE' })), 'extra');
  });

  test('an Essential verdict promotes an ordinary extra', () => {
    const t = txn({ name: 'Some Shop', primary: 'GENERAL_MERCHANDISE' });
    reset({ decisions: { [t.transaction_id]: 'essential' } });
    assert.equal(classify(t), 'essential');
  });
});

describe('memoization', () => {
  test('repeated calls agree', () => {
    reset();
    const t = txn({ primary: 'GENERAL_MERCHANDISE' });
    assert.equal(classify(t), classify(t));
  });

  test('a verdict changes the result once caches are cleared', () => {
    const t = txn({ name: 'Some Shop', primary: 'GENERAL_MERCHANDISE' });
    reset();
    assert.equal(classify(t), 'extra');

    // This is the sequence decide() performs.
    state.decisions[t.transaction_id] = 'essential';
    clearDerivedCaches();
    assert.equal(classify(t), 'essential');
  });

  test('two transactions with the same id are not confused with different ones', () => {
    reset();
    const a = txn({ primary: 'GENERAL_MERCHANDISE' });
    const b = txn({ primary: 'RENT_AND_UTILITIES', detailed: 'RENT_AND_UTILITIES_RENT' });
    assert.equal(classify(a), 'extra');
    assert.equal(classify(b), 'essential');
    assert.equal(classify(a), 'extra');
  });
});

describe('review queue flagging', () => {
  test('food delivery is flagged for review by default', () => {
    reset();
    assert.equal(isLazy(txn({ merchant_name: LAZY_MERCHANTS[0], primary: 'FOOD_AND_DRINK' })), true);
  });

  test('groceries are not flagged', () => {
    reset();
    assert.equal(isLazy(txn({ merchant_name: 'Local Grocer', primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES' })), false);
  });

  test('an auto-approve survey preference stops the flagging', () => {
    reset({ prefs: { delivery: 'approve' } });
    assert.equal(isLazy(txn({ merchant_name: LAZY_MERCHANTS[0], primary: 'FOOD_AND_DRINK' })), false);
  });

  test('an auto-regret survey preference produces a verdict with no explicit decision', () => {
    reset({ prefs: { delivery: 'regret' } });
    assert.equal(getEffectiveDecision(txn({ merchant_name: LAZY_MERCHANTS[0], primary: 'FOOD_AND_DRINK' })), 'disapproved');
  });

  test('an explicit verdict beats the survey default', () => {
    const t = txn({ merchant_name: LAZY_MERCHANTS[0], primary: 'FOOD_AND_DRINK' });
    reset({ prefs: { delivery: 'regret' }, decisions: { [t.transaction_id]: 'approved' } });
    assert.equal(getEffectiveDecision(t), 'approved');
  });
});
