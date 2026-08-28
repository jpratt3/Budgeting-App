// Regression tests for budget matching.
//
// The rule that matters: each spend transaction belongs to AT MOST ONE budget item,
// chosen by longest matching category prefix. Without that, an item mapping
// ENTERTAINMENT and another mapping ENTERTAINMENT_TV_AND_MOVIES would both claim the
// same charge and the budget page would overstate spending.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { txn, reset, state } from './helpers.mjs';
import { bumpGen } from '../public/js/state.js';
import {
  actualForItem, budgetItemIdForTxn, isEssentialItem, txnsForItem, uncategorizedTxns,
} from '../public/js/budget.js';

const item = (id, label, plaid_cats, type = 'variable', amount = 100) =>
  ({ id, label, plaid_cats, type, amount });

// Seeds state with fixture transactions and budget items, then invalidates the
// transaction -> item index so the next lookup rebuilds against them.
function setup(items, txns) {
  reset({ budgetItems: items, allTransactions: txns });
  bumpGen();
}

describe('longest prefix wins', () => {
  test('a detailed mapping beats a primary mapping for the same charge', () => {
    const broad = item(1, 'Fun', 'ENTERTAINMENT');
    const exact = item(2, 'Streaming', 'ENTERTAINMENT_TV_AND_MOVIES');
    const t = txn({ primary: 'ENTERTAINMENT', detailed: 'ENTERTAINMENT_TV_AND_MOVIES' });
    setup([broad, exact], [t]);
    assert.equal(budgetItemIdForTxn(t), exact.id);
  });

  test('order of the items does not change the winner', () => {
    const broad = item(1, 'Fun', 'ENTERTAINMENT');
    const exact = item(2, 'Streaming', 'ENTERTAINMENT_TV_AND_MOVIES');
    const t = txn({ primary: 'ENTERTAINMENT', detailed: 'ENTERTAINMENT_TV_AND_MOVIES' });
    setup([exact, broad], [t]);
    assert.equal(budgetItemIdForTxn(t), exact.id);
  });

  test('the broad item still catches charges the detailed one does not', () => {
    const broad = item(1, 'Fun', 'ENTERTAINMENT');
    const exact = item(2, 'Streaming', 'ENTERTAINMENT_TV_AND_MOVIES');
    const t = txn({ primary: 'ENTERTAINMENT', detailed: 'ENTERTAINMENT_CASINOS_AND_GAMBLING' });
    setup([broad, exact], [t]);
    assert.equal(budgetItemIdForTxn(t), broad.id);
  });
});

describe('no double counting', () => {
  test('a charge is claimed by exactly one item', () => {
    const items = [
      item(1, 'Fun', 'ENTERTAINMENT'),
      item(2, 'Streaming', 'ENTERTAINMENT_TV_AND_MOVIES'),
      item(3, 'Everything', 'ENTERTAINMENT,GENERAL_MERCHANDISE'),
    ];
    const t = txn({ amount: 40, primary: 'ENTERTAINMENT', detailed: 'ENTERTAINMENT_TV_AND_MOVIES' });
    setup(items, [t]);
    const claimed = items.filter(i => txnsForItem(i).length);
    assert.equal(claimed.length, 1);
    assert.equal(items.reduce((s, i) => s + actualForItem(i), 0), 40);
  });

  test('actuals sum to total spend when every charge is mapped', () => {
    const items = [item(1, 'Food', 'FOOD_AND_DRINK'), item(2, 'Shopping', 'GENERAL_MERCHANDISE')];
    const txns = [
      txn({ amount: 10, primary: 'FOOD_AND_DRINK' }),
      txn({ amount: 25, primary: 'GENERAL_MERCHANDISE' }),
      txn({ amount: 5, primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE' }),
    ];
    setup(items, txns);
    assert.equal(items.reduce((s, i) => s + actualForItem(i), 0), 40);
    assert.equal(uncategorizedTxns().length, 0);
  });
});

describe('what never matches', () => {
  test('constant items are not matched against transactions', () => {
    const rent = item(1, 'Rent', 'RENT_AND_UTILITIES', 'constant', 1600);
    const t = txn({ primary: 'RENT_AND_UTILITIES' });
    setup([rent], [t]);
    assert.equal(budgetItemIdForTxn(t), null);
    assert.deepEqual(txnsForItem(rent), []);
  });

  test('items with no category mapping match nothing', () => {
    const unmapped = item(1, 'Misc', '');
    const t = txn({ primary: 'GENERAL_MERCHANDISE' });
    setup([unmapped], [t]);
    assert.equal(budgetItemIdForTxn(t), null);
    assert.deepEqual(txnsForItem(unmapped), []);
  });

  test('income, savings, and skipped transfers are not budget spend', () => {
    const catchAll = item(1, 'Everything', 'INCOME,TRANSFER_OUT,TRANSFER_IN');
    const txns = [
      txn({ name: 'PAYROLL', primary: 'INCOME', amount: -2000 }),
      txn({ name: 'TRANSFER TO UNKNOWN', primary: 'TRANSFER_OUT' }),
      txn({ name: 'DEPOSIT', primary: 'TRANSFER_IN', amount: -50 }),
    ];
    setup([catchAll], txns);
    for (const t of txns) assert.equal(budgetItemIdForTxn(t), null);
  });
});

describe('uncategorized', () => {
  test('unmapped spend shows up as uncategorized', () => {
    const items = [item(1, 'Food', 'FOOD_AND_DRINK')];
    const txns = [txn({ amount: 10, primary: 'FOOD_AND_DRINK' }), txn({ amount: 30, primary: 'TRAVEL' })];
    setup(items, txns);
    const uncat = uncategorizedTxns();
    assert.equal(uncat.length, 1);
    assert.equal(uncat[0].amount, 30);
  });

  test('rent is excluded — it is covered by the fixed line, not a variable bucket', () => {
    const t = txn({ amount: 1600, primary: 'RENT_AND_UTILITIES', detailed: 'RENT_AND_UTILITIES_RENT' });
    setup([item(1, 'Food', 'FOOD_AND_DRINK')], [t]);
    assert.deepEqual(uncategorizedTxns(), []);
  });

  test('refunds and credits are excluded', () => {
    const t = txn({ amount: -20, primary: 'TRAVEL' });
    setup([item(1, 'Food', 'FOOD_AND_DRINK')], [t]);
    assert.deepEqual(uncategorizedTxns(), []);
  });
});

describe('index invalidation', () => {
  test('editing a mapping changes the match once the generation is bumped', () => {
    const it = item(1, 'Fun', 'ENTERTAINMENT');
    const t = txn({ primary: 'TRAVEL' });
    setup([it], [t]);
    assert.equal(budgetItemIdForTxn(t), null);
    assert.equal(txnsForItem(it).length, 0);

    // This is the sequence assignCategory() performs.
    it.plaid_cats = 'ENTERTAINMENT,TRAVEL';
    bumpGen();
    assert.equal(txnsForItem(it).length, 1);
  });

  test('adding a transaction rebuilds the index', () => {
    const it = item(1, 'Food', 'FOOD_AND_DRINK');
    setup([it], [txn({ amount: 10, primary: 'FOOD_AND_DRINK' })]);
    assert.equal(actualForItem(it), 10);

    state.allTransactions = [...state.allTransactions, txn({ amount: 15, primary: 'FOOD_AND_DRINK' })];
    bumpGen();
    assert.equal(actualForItem(it), 25);
  });
});

describe('essential vs discretionary grouping', () => {
  test('a groceries mapping is essential', () => {
    assert.equal(isEssentialItem(item(1, 'Groceries', 'FOOD_AND_DRINK_GROCERIES')), true);
  });

  test('rideshare is discretionary even though it sits under TRANSPORTATION', () => {
    assert.equal(isEssentialItem(item(1, 'Rideshare', 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES')), false);
  });

  test('general merchandise is discretionary', () => {
    assert.equal(isEssentialItem(item(1, 'Shopping', 'GENERAL_MERCHANDISE')), false);
  });

  test('an unmapped item is not essential', () => {
    assert.equal(isEssentialItem(item(1, 'Misc', '')), false);
  });
});
