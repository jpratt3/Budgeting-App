# Budget

A self-hosted personal budgeting dashboard. Links real bank accounts through
[Plaid](https://plaid.com), classifies every transaction, and tracks spend against
a budget you define. Runs entirely on your own machine — no hosted component,
no account, no data leaving your box except the calls to Plaid.

## What it does

- **Live balances** across checking, savings, and credit cards, with net worth as
  `checking + savings − credit`.
- **Automatic classification** of each transaction into essential / extra / savings /
  income, with internal transfers and credit-card bill payments netted out so they
  don't show up as spending.
- **Budget tracking** — fixed monthly constants plus variable categories mapped to
  Plaid category prefixes, matched longest-prefix-first so nothing double counts.
- **Lazy-spending review** — flags discretionary purchases and asks for a verdict
  (Essential / Worth it / Regret it), then charts what the regretted spend would
  have compounded to.
- **History charts** for savings rate and net worth, with partial months excluded.
- **Ask Claude** — an optional chat panel that answers questions against the
  dashboard's current data snapshot.

## Setup

Requires Node.js 18+.

```bash
npm install
cp .env.example .env   # then fill in your Plaid credentials
node server.js
```

Open <http://localhost:3000> and use the Connect button to link an account.

`PLAID_ENV=sandbox` works immediately with Plaid's test credentials. Linking real
banks requires production access, which Plaid grants per-account on request.

## Data and privacy

This app reads your bank transactions. A few things worth knowing before you run it:

- **Everything stays local.** Transactions are fetched from Plaid on demand and held
  in the browser. Only your budget definitions, savings goals, balance snapshots, and
  spending verdicts are persisted, to a local SQLite file (`budget.db`).
- **`budget.db`, `.env`, and `.tokens.json` are gitignored and must stay that way.**
  `.tokens.json` holds Plaid *access tokens* — long-lived read credentials for your
  linked accounts. If one ever leaks, revoke it with Plaid's `/item/remove`; rotating
  your API secret alone is not enough.
- **There is no authentication.** The server binds to `127.0.0.1` only and restricts
  CORS to localhost, so it is not reachable from other machines and other websites
  can't read it. Do not put it behind a public listener without adding auth first.
- **The Claude chat panel sends your data to Anthropic.** The snapshot the dashboard
  computed — balances, budget, and the transactions in the selected period — goes to
  the API with each question. Leave `ANTHROPIC_API_KEY` unset to disable the panel.

## Configuring it for your accounts

A few classification rules are institution-specific and need adjusting:

- **`RENT_MERCHANTS`** in `index.html` — rent paid by ACH or Zelle usually isn't
  tagged `RENT_AND_UTILITIES_RENT` by Plaid. Add your landlord or property manager
  as the name appears on your statement, or rent will be miscategorized.
- **Internal transfer memos** — the `to sv:` / `from sv:` matching in `classify()`
  is how one bank labels checking↔savings transfers. Check what yours uses.
- **`SAVINGS_MERCHANTS`** — brokerages and HYSAs treated as savings rather than spend.

## Architecture

Three files: `server.js` (Express API + Plaid), `db.js` (SQLite schema), and
`index.html` (the entire frontend — vanilla JS, no build step). See
[`CLAUDE.md`](CLAUDE.md) for a detailed walkthrough of the classification order,
the balance math, and the budget-matching rules.

## Status

A personal project, built for one person's accounts. No test suite, no CI. Expect
to adjust the classification rules before the numbers reconcile against your own
statements.
