# Budget

[![CI](https://github.com/jpratt3/Budgeting-App/actions/workflows/ci.yml/badge.svg)](https://github.com/jpratt3/Budgeting-App/actions/workflows/ci.yml)

This is a locally hosted budgeting app for people who want a customizable view of real
bank activity. It links accounts through [Plaid](https://plaid.com), classifies
transactions, and tracks spending against the budget you set. It runs entirely on your
own machine: nothing leaves your box except the calls to Plaid, and — only if you enable
the optional Ask Claude panel — the dashboard snapshot that panel sends to Anthropic.

![Dashboard](docs/dashboard.png)

All screenshots use fictional financial data. Setup Health shows an intentionally
under-configured state. Dashboard, Cash Flow, Budget, and chat show the month before
review. Review and Recurring show it after six decisions, with 11 purchases left.

## Architecture

```mermaid
flowchart TB
  Plaid["Plaid API<br/>balances · 12 months of transactions"]

  subgraph server ["server.js · Express"]
    Routes["REST routes"]
    Guard["Loopback bind · Host allowlist · no CORS grant"]
  end

  subgraph ladder ["Classification ladder — the order is load-bearing"]
    Net["Net out internal transfers + card bill payments"]
    Rent["RENT_MERCHANTS &nbsp;<b>outranks</b>&nbsp; the P2P skip"]
    Ride["Rideshare &nbsp;<b>outranks</b>&nbsp; ESSENTIAL_CATS"]
    Cats["Plaid taxonomy · longest prefix wins"]
    Out(["essential · extra · savings · income"])
  end

  subgraph views ["Dashboard · public/js"]
    Dash["Balances + net worth<br/>checking + savings − credit"]
    Flow["Cash flow Sankey"]
    Budget["Budget categories"]
    Recur["Recurring detection<br/>3+ charges · stable cadence · 2-cycle timeout"]
    Review["Review queue<br/>Essential / Worth it / Regret it"]
    Chat["Ask Claude panel <i>(optional)</i><br/>sends snapshot to Anthropic"]
  end

  subgraph persist ["Persistence"]
    DB[("<i>db.js</i> · SQLite<br/>budgets · goals · snapshots · verdicts")]
    Growth["Goal projection<br/>regret compounding what-if"]
  end

  Health["<i>health.js</i> · setup checks<br/>flags config that would silently produce wrong numbers"]

  Plaid --> Routes
  Guard -.-> Routes
  Routes --> Net
  Net --> Rent --> Ride --> Cats --> Out
  Out --> Dash & Flow & Budget & Recur & Review & Chat
  Review -->|verdicts persist| DB
  DB --> Growth
  Health -.->|audits| Cats

  classDef extC fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e
  classDef srvC fill:#ede9fe,stroke:#6d28d9,color:#4c1d95
  classDef ladC fill:#fef3c7,stroke:#b45309,color:#78350f
  classDef viewC fill:#dcfce7,stroke:#15803d,color:#14532d
  classDef persC fill:#e0e7ff,stroke:#4338ca,color:#312e81
  classDef healthC fill:#ffe4e6,stroke:#be123c,color:#881337
  classDef grp fill:#f8fafc,stroke:#cbd5e1,color:#475569
  class Plaid extC
  class Routes,Guard srvC
  class Net,Rent,Ride,Cats,Out ladC
  class Dash,Flow,Budget,Recur,Review,Chat viewC
  class DB,Growth persC
  class Health healthC
  class server,ladder,views,persist grp
```

Classification is a ladder, not a lookup, and the rung order is the part that matters.
Plaid does not tag Zelle rent as `RENT_AND_UTILITIES_RENT`, so if the P2P skip ran first
the largest monthly expense would vanish from spending entirely. Rideshare has to outrank
`ESSENTIAL_CATS` or every Uber becomes a necessity. The tests cover the ordering rather
than the arithmetic, because the arithmetic is not where this breaks.

## What it does

- Live balances across checking, savings, and credit cards. Net worth is
  `checking + savings − credit`, with a month-over-month delta.
- Classifies every transaction as essential, extra, savings, or income. Internal
  transfers and credit-card bill payments are netted out, so they do not appear as
  spending.
- Shows cash flow as a Sankey: income on the left, categories on the right.
- Tracks fixed monthly constants and variable categories mapped to Plaid category
  prefixes. Longest-prefix-first matching prevents double counting. Click any populated
  variable category to inspect the transactions behind its actual.
- Detects recurring charges from 12 months of history. See cadence, amount, next expected
  date, and monthly cost.
- Flags discretionary purchases for review. Mark each one Essential, Worth it, or Regret
  it, then see what regretted spending would have compounded to.
- Projects growth toward savings goals and estimates time to target.
- Includes an optional Ask Claude panel for questions against the dashboard's current data
  snapshot.

### Ask Claude

Set `ANTHROPIC_API_KEY` in `.env` and restart the server to enable the embedded chat
panel. Ask about balances, budget targets, transactions in the selected period, or monthly
history. The key stays server-side, but the dashboard snapshot is sent to Anthropic when
you ask a question.

![Ask Claude with mocked data](docs/ask-claude.png)

*Example shown with mocked financial data.*

### Expand a budget category

Click any variable budget row with matched transactions to see the merchant, date, and
amount behind its actual.

![Expanded budget category with mocked data](docs/budget-category.png)

*Example shown with mocked financial data.*

### Cash flow

Cash-flow buckets use the same calculations as the rest of the dashboard, so the totals
agree.

![Cash flow](docs/cash-flow.png)

### The review queue

Not all purchases are equal - two trips to CVS can mean different things: were you
purchasing cold medication or the junk food you are trying to avoid? Choose **Essential**
to promote a purchase out of discretionary spending, **Worth it**, or **Regret it**.
Verdicts persist - the pie, stats, and growth what-if all use them.

![Review queue](docs/review.png)

*Six decisions are complete: one Essential, two Worth it, and three Regret it. Eleven
remain.*

### Recurring charges

A merchant needs three or more charges at a consistent interval with stable amounts.
Streams quiet for two cycles are marked stopped and excluded from totals.

![Recurring](docs/recurring.png)

## Setup

Requires **Node.js 20+** (`better-sqlite3` is a native module and does not build on 18).

```bash
npm install
cp .env.example .env    # then fill in your Plaid credentials
npm start
```

Open <http://localhost:3000> and use **Connect account** to link an account.

`PLAID_ENV=sandbox` works immediately with Plaid's test credentials. Linking real banks
requires production access, which Plaid grants per-account on request.

## Configure your accounts first

Edit **`public/js/config.js`**. Defaults are deliberately empty when a wrong guess would
silently produce wrong numbers, so a fresh clone is under-configured on purpose. The
dashboard reports what is missing.

![Setup health](docs/setup-health.png)

*This is an intentionally under-configured example. Its totals differ from the configured
screenshots above.*

Start with these two settings:

- **`RENT_MERCHANTS`**: rent paid by ACH or Zelle usually is not tagged
  `RENT_AND_UTILITIES_RENT` by Plaid, and P2P rules would otherwise skip it. Leave it
  empty and your largest monthly expense can vanish from spending entirely.
- **`INTERNAL_TRANSFER_MEMOS`**: a transfer between your own accounts appears twice, once
  per account. Banks label the two legs differently and there is no standard. Leaving it
  empty is safe but lossy: "Transferred to savings" reads zero. Getting `checkingSide`
  and `savingsSide` **backwards is not safe**. You would count the wrong leg.

Review `ESSENTIAL_CATS` (which Plaid categories you consider needs),
`SAVINGS_MERCHANTS` (your brokerages), `ESSENTIAL_MERCHANTS` (your insurer), and
`ONE_OFF_INCOME_MIN`. Rules that apply to everyone live in `public/js/rules.js` and
should rarely need editing.

## Data and privacy

Transactions are fetched from Plaid on demand and held in the browser. Only budget
definitions, savings goals, balance snapshots, and spending verdicts persist in the local
SQLite file (`budget.db`).

- Keep `budget.db`, `.env`, and `.tokens.json` gitignored. `.tokens.json` holds Plaid
  *access tokens*, long-lived read credentials for linked accounts. If one leaks, revoke
  it with Plaid's `/item/remove`; rotating your API secret alone is not enough.
- There is no authentication. Three controls make that workable locally:
  1. **No CORS grant.** The dashboard is same-origin, so it does not need one. Without it,
     other sites you visit cannot read data from localhost.
  2. **A `Host` allowlist.** Binding to loopback does not stop DNS rebinding, where an
     attacker's page repoints its own domain at `127.0.0.1` and the browser then treats
     requests as same-origin.
  3. **A loopback-only bind.** The server is not reachable from your network. No phone or
     LAN access is deliberate.

  Do not put this behind a public listener without adding real authentication.
- The Claude chat panel sends data to Anthropic. Each question sends the dashboard's
  computed snapshot: balances, budget, and transactions in the selected period. Leave
  `ANTHROPIC_API_KEY` unset to disable the panel.

## Architecture

`server.js` is an Express API over Plaid and SQLite. `db.js` owns the schema. The frontend
is `index.html` (markup only) over ES modules in `public/js/`, served at `/static`. There
is no build step. The browser loads the modules directly.

```
public/js/
  config.js      everything you must review: rent payees, transfer memos, brokerages
  rules.js       universal rules: Plaid taxonomy, national merchant brands
  classify.js    the classification ladder — order is load-bearing
  health.js      the setup checks behind the banner above
  nav.js         sidebar routing; each page redraws its charts on entry
  …one module per page and per concern
```

[`CLAUDE.md`](CLAUDE.md) has the detailed walkthrough: classification order, balance math,
budget matching, and caching rules.

## Tests

```bash
npm test
```

Tests use Node's built-in runner with no framework or devDependencies. Coverage focuses on
order-dependent money logic, where a silent reordering can produce convincing but wrong
numbers. Rent must outrank the P2P skip or Zelle rent disappears. Rideshare must outrank
`ESSENTIAL_CATS` or every Uber becomes a necessity.

Tests that depend on `config.js` read configured values rather than hardcoding them. When a
list is empty, they skip with a reason, so the suite gets stronger once you configure it.

## Status

This is a personal project published because the classification approach might be useful to
someone else. Adjust `config.js` before the numbers reconcile against your statements. The
setup banner tells you when they will not.
