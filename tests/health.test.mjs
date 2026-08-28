// Tests for the setup-health checks.
//
// These exist mainly because the coverage check shipped with a real bug: it divided
// uncategorized spend (which excludes rent) by TOTAL spend (which includes it), so a
// large rent payment counted as "covered" and inflated the figure. Rent is the biggest
// line in most months, so the warning almost never fired.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { txn, reset, state } from './helpers.mjs';
import { bumpGen } from '../public/js/state.js';
import { healthChecks } from '../public/js/health.js';

const find = id => healthChecks().find(c => c.id === id);

function setup({ txns = [], budgetItems = [], balances = { live: true } } = {}) {
  reset({ allTransactions: txns, budgetItems });
  state.balances = balances;
  bumpGen();
}

const RENT = () => txn({ amount: 2000, primary: 'RENT_AND_UTILITIES', detailed: 'RENT_AND_UTILITIES_RENT' });
const PAY = () => txn({ amount: -4000, primary: 'INCOME', detailed: 'INCOME_WAGES' });

describe('budget coverage', () => {
  test('rent is excluded from the denominator', () => {
    // 2000 rent (fixed line) + 100 mapped + 400 unmapped.
    // Wrong maths: 1 - 400/2500 = 84% and no warning.
    // Right maths: 1 - 400/500  = 20% and a warning.
    setup({
      txns: [PAY(), RENT(),
        txn({ amount: 100, primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES' }),
        txn({ amount: 400, primary: 'GENERAL_MERCHANDISE' })],
      budgetItems: [{ id: 1, label: 'Groceries', amount: 300, type: 'variable', plaid_cats: 'FOOD_AND_DRINK_GROCERIES' }],
    });
    const c = find('coverage');
    assert.ok(c, 'expected a coverage warning');
    assert.match(c.title, /20%/);
  });

  test('no warning when nearly everything is mapped', () => {
    setup({
      txns: [PAY(), RENT(), txn({ amount: 400, primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES' })],
      budgetItems: [{ id: 1, label: 'Groceries', amount: 300, type: 'variable', plaid_cats: 'FOOD_AND_DRINK_GROCERIES' }],
    });
    assert.equal(find('coverage'), undefined);
  });

  test('silent when no variable budgets exist at all', () => {
    setup({
      txns: [PAY(), txn({ amount: 400, primary: 'GENERAL_MERCHANDISE' })],
      budgetItems: [{ id: 1, label: 'Rent', amount: 2000, type: 'constant', plaid_cats: '' }],
    });
    assert.equal(find('coverage'), undefined);
  });
});

describe('rent detection', () => {
  test('warns when nothing in the window looks like rent', () => {
    setup({ txns: [PAY(), txn({ amount: 50, primary: 'FOOD_AND_DRINK' })] });
    assert.ok(find('rent'));
  });

  test('silent once rent is present', () => {
    setup({ txns: [PAY(), RENT()] });
    assert.equal(find('rent'), undefined);
  });
});

describe('income', () => {
  test('warns when the period has no income', () => {
    setup({ txns: [RENT()] });
    assert.ok(find('income'));
  });

  test('silent when a paycheck landed', () => {
    setup({ txns: [PAY(), RENT()] });
    assert.equal(find('income'), undefined);
  });
});

describe('balances', () => {
  test('warns on a stored snapshot', () => {
    setup({ txns: [PAY()], balances: { live: false } });
    assert.ok(find('balances'));
  });

  test('flags a partial read as info, not a warning', () => {
    setup({ txns: [PAY()], balances: { live: true, partial: true } });
    assert.equal(find('balances'), undefined);
    assert.equal(find('balances-partial').severity, 'info');
  });
});

describe('no data', () => {
  test('reports nothing at all rather than every check at once', () => {
    setup({ txns: [] });
    assert.deepEqual(healthChecks(), []);
  });
});
