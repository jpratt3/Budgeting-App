# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

```bash
node server.js
```

The app runs on port 3000 (configurable via `PORT` in `.env`). There is no build step — start the server and open `http://localhost:3000`.

## Stack

- **Backend:** Node.js + Express 5 (`server.js`) — CommonJS modules
- **Frontend:** `index.html` (markup only) + vanilla-JS ES modules in `public/js/` + `public/styles.css` — no framework, no build step
- **Banking data:** Plaid SDK (production environment, credentials in `.env`)
- **Charts:** Chart.js via CDN
- **Persistence:**
  - `.tokens.json` — Plaid access tokens (file-based, in-memory cache + sync on write)
  - `budget.db` (SQLite via `better-sqlite3`, schema in `db.js`)

## Architecture

The backend is `server.js` plus a small DB module. The frontend is a sidebar-nav SPA:
`index.html` (markup only) over ES modules in `public/js/`, served at `/static`. Still no
build step — the browser loads the modules directly.

Nine pages, switched client-side by `nav.js`: Dashboard, Accounts, Transactions, Review,
Cash Flow, Budget, Recurring, Growth, Reports.

**`server.js`** — Express REST API:
- `POST /api/create-link-token` / `POST /api/exchange-token` — Plaid Link flow
- `GET /api/transactions?days=N` (or `?start=YYYY-MM-DD`) — all transactions across linked items, fully paginated
- `GET /api/live-balances` — live Plaid balances: depository accounts aggregated into `checking`/`savings`, credit cards into `credit` (amount owed). Persists a snapshot to SQLite on every successful read so the manual fallback stays fresh. Returns `ok:false` if every token errors (frontend then falls back to the stored snapshot).
- `GET/POST /api/balances` — stored snapshot (keys: `checking`, `savings`, `credit`)
- `GET/POST /api/decisions` — lazy spending verdicts
- `GET/POST/DELETE /api/budget` — budget items (`constant` fixed expenses / `variable` categories with `plaid_cats` prefix mappings)
- `GET/POST/DELETE /api/milestones` — savings goals
- `GET /api/accounts` — connected institution labels + logos

**`db.js`** — opens `budget.db`, creates tables on startup: `decisions`, `balances`, `budget_items`, `milestones` (seeds defaults when empty).

**`index.html`** — markup only: a fixed sidebar, a top bar, and nine `<section class="page">`
containers (only one carries `.active`). Interaction is wired through inline `on*`
attributes, which evaluate in global scope — `app.js` publishes every handler onto
`window` in one `Object.assign`, and that list is the app's public surface. Adding a
new inline handler means adding it there.

**`public/styles.css`** — the design system. Every colour is a token on `:root`
(`--bg`, `--card`, `--line`, `--accent`, `--income`, `--spend`…); `theme.js` mirrors the
same values for Chart.js. Change a colour in both or they drift.

**`public/js/`** — the frontend, one concern per module:

| module | holds |
| --- | --- |
| `state.js` | the shared mutable `state` object + `bumpGen()` |
| `config.js` | **everything a new user must review** — rent payees, bank transfer memos, essential categories, brokerages |
| `rules.js` | universal classification rules: Plaid taxonomy + national merchant brands |
| `health.js` | setup-health checks — surfaces a half-configured `config.js` on the Dashboard |
| `format.js` | `fmt`, `fmtSigned`, `fmtShort`, `esc`, `cleanLabel`, date labels |
| `theme.js` | chart palette `C` + shared Chart.js defaults and axis builders |
| `period.js` | `periodStart` — the one definition of where the selected period starts |
| `classify.js` | `classify()` and friends, plus the memo and `clearDerivedCaches()` |
| `rows.js` | the shared transaction-row markup every list renders |
| `nav.js` | `go(page)`, page titles, per-page on-enter render hooks |
| `data.js` | `loadAll()` (the transactions fetch), `loadConnectedAccounts()` |
| `overview.js` | `renderAll()` — the orchestrator every data change funnels through |
| `transactions.js` | the Transactions page + the dashboard's recent strip |
| `accounts.js` | balances, the Accounts page, manual-entry fallback |
| `lazy.js` | the Review queue, verdicts, pending-id migration |
| `budget.js` | budget matching + index, the Budget page, budget CRUD |
| `sankey.js` | the Cash Flow page — a hand-rolled SVG Sankey (no D3) |
| `recurring.js` | subscription/cadence detection, read-only |
| `growth.js` | compounding math, the projection, goal cards |
| `history.js` | the 365-day fetch, savings-history and net-worth charts |
| `charts.js` | the spending doughnut and the pace bar |
| `survey.js` | the first-run lazy-spending survey |
| `chat.js` | the Ask Claude panel and its context builder |
| `ui.js` | period buttons, Plaid Link |
| `app.js` | entry point: imports, `initApp()`, the `window` handler bindings |

*Shared state:* ES modules give importers a read-only view of a binding, so anything
**reassigned** across modules lives on the `state` object in `state.js`. State only one
module touches (Chart.js instances, chat history) stays a module-local `let`.

*Derived caches:* `classify()` is memoized by `transaction_id`, and `budget.js` keeps a
`transaction_id → budgetItemId` index. Both are invalidated by `state.gen`, which
`bumpGen()` increments. **Anything that changes classification or matching must call
`clearDerivedCaches()`** — a new fetch, a verdict, a survey save, a category assignment.
Measured on a 693-transaction YTD view the index roughly halves the matching work
(80ms → 36ms), but a full `renderAll` is ~420ms either way: the cost is DOM writes and
chart construction, not classification.

*Rendering:* `renderAll()` computes the period totals once and hands them to each page's
renderer. Charts are the exception — Chart.js measures its canvas at construction and a
canvas under a `display:none` parent measures zero, so every render guards on
`canvas.offsetParent !== null` and `nav.js` redraws a page's charts when it opens.
`grid-2`/`grid-3` children carry `min-width: 0`, without which a canvas widens its track
and scrolls the page sideways.

*Setup health (`health.js`):* the classification engine fails quietly by design — an
unrecognised transfer memo falls through to neutral, an unlisted landlord simply isn't
rent. That is the right behaviour for the engine — a wrong guess is worse than no guess —
but it means a half-configured install shows confident, wrong numbers.
`health.js` checks for exactly those gaps and renders them above the Dashboard KPIs.
Structural checks (rent, transfers) run against the 12-month history rather than the
selected period, or a 2-week window would report "no rent detected" every time. Each item
is dismissible to localStorage, with a way back.

*Escaping:* Plaid strings (merchant names, categories, error text) are third-party data
written into `innerHTML`. Everything user-visible goes through `esc()` from `format.js`.

*Local-only hardening (`server.js`, top of file):* the server has no authentication, so
whatever can reach it can read every balance and transaction and spend the Anthropic key.
Three layers, and all three are load-bearing — do not remove one because another looks
sufficient:
1. **No CORS grant.** The dashboard is same-origin, so it never needs one. A wide-open
   `cors()` would let any page you visit read your bank data off localhost.
2. **Host allowlist.** A loopback bind does NOT stop DNS rebinding — an attacker page can
   re-point its own domain at `127.0.0.1`, after which the browser treats the requests as
   same-origin and CORS is irrelevant. The `Host` header still names the attacker, so it
   is checked against `ALLOWED_HOSTS`.
3. **Loopback bind** (`app.listen(PORT, '127.0.0.1')`) — the app is not on the network.
   This means no phone/LAN access; that is deliberate.

*Static serving:* `server.js` mounts `public/` at `/static` and serves `index.html` from an
explicit `/` route. `express.static(__dirname)` would publish `budget.db`, `db.js`, and
`server.js` over HTTP — dotfiles are skipped by default but `budget.db` is not a dotfile.
Anything added to `public/` is world-readable to the browser.

*Classification (`classify()`)* maps each Plaid transaction to `'skip'`, `'balance'`, `'income'`, `'savings'`, `'essential'`, or `'extra'`. Order matters:
1. Credit card bill payments (`isCreditCardPayment()`) → `'skip'` (both legs: checking-side and card-side)
2. **Rent (`isRentTxn()`: PFC `RENT_AND_UTILITIES_RENT` or `RENT_MERCHANTS` name match) → `'essential'`** — checked before the transfer/P2P skips so rent paid by ACH or Zelle counts as real spend
3. Internal checking↔savings transfers (`INTERNAL_TRANSFER_MEMOS` in `config.js` — bank-specific, ships empty): checking-side legs → `'savings'` (this is what feeds "Transferred to Savings"); savings-side duplicates → `'skip'`. Unconfigured, both lists are empty and transfers fall through to rule 5 (neutral)
4. P2P cash apps (Zelle/Venmo/Cash App) → `'skip'` (neutral by design — deliberate June-2026 decision)
5. Other `TRANSFER_OUT` → `'savings'` if a known broker/HYSA (`SAVINGS_MERCHANTS`), else `'skip'`
6. Any `primary === 'INCOME'` → `'income'`; `TRANSFER_IN` → `'balance'` (excluded)
7. Rideshare and pharmacy → `'extra'` (review queue); `ESSENTIAL_CATS` or an `ESSENTIAL_MERCHANTS` name match → `'essential'`; else `'extra'`. A lazy decision of `'essential'` promotes to essentials.

*Income is netted, not filtered:* income sums use `+= -t.amount` so positive-amount INCOME reversals cancel their credit twin. One-off credits ≥ `ONE_OFF_INCOME_MIN` ($5k) are charted separately from the recurring savings rate.

*Balances / net worth:* the header "Net" card and the Net Worth chart anchor are `checking + savings − credit`. The NW chart back-walks monthly deltas (`income − essential/extra spend`) from that anchor; spend is counted at transaction time, consistent with carrying the card balance as a liability.

*History charts:* both history charts drop the earliest calendar month present in the data (`earliestDataMonth()`) because it is partial — Plaid's history for an item often starts mid-month. The in-progress current month is drawn faded and excluded from the average line.

*Budget matching:* each spend transaction is assigned to at most one variable budget item via longest-matching `plaid_cats` prefix (`budgetItemIdForTxn()`) — no double counting when a primary and a detailed prefix overlap. Rent transactions are excluded from "Uncategorized" (covered by the Rent constant); the Budget tab's actual-savings formula counts detected rent/utilities in `detectedFixed` so budgeted constants aren't double-subtracted.

*Cash flow (Sankey)* is built from the same `classify()` buckets the dashboard uses, so
its totals match the KPIs exactly. Ribbons are FILLED SVG paths — setting `fill` in CSS
makes them vanish. A minimum node height stops a dominant "Left over" from squashing
every category to nothing.

*Recurring detection* is heuristic and read-only: 3+ charges, a median gap inside a
cadence bucket, every gap within 40% of that median, and amounts within 35% of the
median. Monthly cost uses the cadence's canonical rate (monthly = 1×), not
`gap/30.44` — a calendar-monthly bill costs one charge a month whether the gap measured
28 days or 35. Streams silent for two cycles are marked stopped and excluded from totals.

*Lazy spending (`isLazy()`)* flags extras by merchant/category. Three-way decisions: **Essential** / **Worth it** / **Regret it**, persisted to SQLite keyed by `transaction_id`. `migratePendingDecisions()` carries verdicts forward when a pending transaction posts under a new id (via `pending_transaction_id`). All regret math (pie, stats, growth what-if) uses `getEffectiveDecision()` (explicit verdicts + survey auto-regret rules).

## Environment

`.env` holds `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, and optionally `PORT`, `ANTHROPIC_API_KEY`, `APP_NAME`, and `PLAID_USER_ID`. See `.env.example`. Do not delete `.tokens.json` without intending to re-link all bank accounts. `.gitignore` must keep `.env`, `.tokens.json`, and `budget.db` out of git.

## Tests

`npm test` runs Node's built-in runner (`node --test`) over `tests/`. No framework, no
build step, no devDependencies — `public/package.json` marks the frontend directory as
ESM so Node can import the browser modules directly, and `tests/helpers.mjs` stubs the
`localStorage` that `getLazyPref()` reads.

Coverage is deliberately narrow: the order-dependent money logic and the setup checks.
- `classify.test.mjs` — the early-return ladder. Rent must outrank the P2P skip or rent
  paid by Zelle disappears; rideshare must outrank `ESSENTIAL_CATS` or every Uber
  silently becomes a necessity. Also covers the memo cache and its invalidation.
- `budget.test.mjs` — longest-prefix matching, so one charge is claimed by exactly one
  budget item, plus the `state.gen` index invalidation.
- `health.test.mjs` — the setup-health arithmetic, above all that budget coverage divides
  by variable spend (rent excluded); the original divide-by-total-spend bug meant the
  warning almost never fired.

Tests that depend on `config.js` read the configured values rather than hardcoding
them, and `t.skip()` with a reason when a list ships empty — so the same suite is
stronger on a configured install than on a fresh clone. Both suites are mutation-checked:
reordering the rent rule below the P2P skip, and swapping longest-prefix for first-match,
each fail exactly one test.

`tests/wiring.test.mjs` catches the three failure modes a build-step-free frontend hides:
a module importing a name nothing exports, an inline `on*` handler never published to
`window`, and a `getElementById()` pointing at an id the markup no longer has. All three
have bitten this codebase.

CI (`.github/workflows/ci.yml`) runs `npm ci` then `npm test` on Node 20, 22, and 24.
`npm ci` is the meaningful half — it installs strictly from the lockfile and builds
`better-sqlite3` natively, which is the step most likely to fail for a new user.

There is no linter. Beyond the suite, verify changes by running the server and
reconciling displayed numbers against `/api/transactions`. A missing export is a
load-time error in the browser, so the console catches import mistakes immediately.
