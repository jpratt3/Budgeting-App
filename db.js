const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'budget.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS decisions (
    transaction_id TEXT PRIMARY KEY,
    verdict        TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS balances (
    key        TEXT PRIMARY KEY,
    amount     REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS budget_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    label      TEXT NOT NULL,
    amount     REAL NOT NULL DEFAULT 0,
    type       TEXT NOT NULL DEFAULT 'variable',
    plaid_cats TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS milestones (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    label  TEXT NOT NULL,
    target REAL NOT NULL DEFAULT 0
  );
`);

const seedCount = db.prepare('SELECT COUNT(*) as n FROM budget_items').get().n;
if (seedCount === 0) {
  const insert = db.prepare('INSERT INTO budget_items (label, amount, type, plaid_cats) VALUES (?, ?, ?, ?)');
  const seeds = [
    ['Rent',           1500, 'constant', ''],
    ['Utilities',       150, 'constant', ''],
    ['Groceries',       400, 'variable', 'FOOD_AND_DRINK_GROCERIES'],
    ['Dining & Coffee', 200, 'variable', 'FOOD_AND_DRINK_RESTAURANTS,FOOD_AND_DRINK_FAST_FOOD,FOOD_AND_DRINK_COFFEE'],
    ['Bars & Alcohol',   80, 'variable', 'FOOD_AND_DRINK_ALCOHOL_AND_BARS'],
    ['Transport',       100, 'variable', 'TRANSPORTATION'],
    ['Shopping',        150, 'variable', 'GENERAL_MERCHANDISE'],
    ['Entertainment',    60, 'variable', 'ENTERTAINMENT'],
  ];
  seeds.forEach(s => insert.run(...s));
}

const milestoneCount = db.prepare('SELECT COUNT(*) as n FROM milestones').get().n;
if (milestoneCount === 0) {
  const ins = db.prepare('INSERT INTO milestones (label, target) VALUES (?,?)');
  [['Emergency Fund', 10000], ['Down Payment', 50000]].forEach(s => ins.run(...s));
}

module.exports = db;
