require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const fs = require('fs');
const path = require('path');
const { PlaidApi, PlaidEnvironments, Configuration } = require('plaid');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');

const app = express();

// ── Local-only hardening ────────────────────────────────────────────────────
// This server has no authentication: whatever can reach it can read every balance
// and transaction, and spend the Anthropic key. Three layers keep the reachable
// set down to "this machine, this app".
const PORT = process.env.PORT || 3000;

// 1. No CORS grant. The dashboard is served from this same origin, so it never
//    needs one — and without it, no other site can read a response off localhost.
//    (A wide-open cors() would let any page you visit read your bank data.)

// 2. Host allowlist. Binding to loopback does NOT stop DNS rebinding: an attacker
//    page can re-point its own domain at 127.0.0.1, after which the browser treats
//    the requests as same-origin and CORS is irrelevant. The Host header still
//    carries the attacker's name, so reject anything that isn't us.
const ALLOWED_HOSTS = new Set([
  `localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`,
  'localhost', '127.0.0.1', '[::1]',
]);
app.use((req, res, next) => {
  if (!ALLOWED_HOSTS.has(req.headers.host)) {
    return res.status(403).type('text/plain').send('Forbidden host');
  }
  next();
});

// 3. Loopback bind, at app.listen below — the app is not on the network at all.
app.use(express.json());
// Serve only the dashboard and the public/ asset tree. express.static(__dirname)
// would also expose budget.db over HTTP — it is a real file in this directory, not
// a dotfile — so the static mount is scoped to public/, which holds nothing secret.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use('/static', express.static(path.join(__dirname, 'public')));

const TOKEN_FILE = path.join(__dirname, '.tokens.json');

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

let tokens = loadTokens();

const plaidConfig = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(plaidConfig);

app.post('/api/create-link-token', async (req, res) => {
  try {
    const request = {
      user: { client_user_id: process.env.PLAID_USER_ID || 'budget-app-user' },
      client_name: process.env.APP_NAME || 'Budget App',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    };
    const response = await plaidClient.linkTokenCreate(request);
    res.json(response.data);
  } catch (err) {
    console.error(JSON.stringify(err.response?.data || err.message));
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/exchange-token', async (req, res) => {
  try {
    const { public_token, account_label } = req.body;
    const response = await plaidClient.itemPublicTokenExchange({ public_token });
    const label = account_label || `account_${Date.now()}`;
    tokens[label] = response.data.access_token;
    saveTokens(tokens);
    res.json({ success: true, label });
  } catch (err) {
    console.error(JSON.stringify(err.response?.data || err.message));
    res.status(500).json({ error: err.message });
  }
});

async function fetchAllTransactions(token, startDate, endDate) {
  let txns = [];
  let offset = 0;
  while (true) {
    const r = await plaidClient.transactionsGet({
      access_token: token,
      start_date: startDate,
      end_date: endDate,
      options: { count: 500, offset }
    });
    txns = txns.concat(r.data.transactions);
    if (txns.length >= r.data.total_transactions) break;
    offset = txns.length;
  }
  return txns;
}

app.get('/api/transactions', async (req, res) => {
  const allTokens = Object.values(tokens);
  if (!allTokens.length) return res.status(400).json({ error: 'No accounts connected.' });
  try {
    const days = parseInt(req.query.days) || 14;
    const now = new Date();
    const start = new Date();
    start.setDate(now.getDate() - days);
    const startDate = req.query.start || start.toISOString().split('T')[0];
    const endDate = now.toISOString().split('T')[0];

    const results = await Promise.all(
      allTokens.map(token => fetchAllTransactions(token, startDate, endDate))
    );

    const allTransactions = results.flat();
    res.json({ transactions: allTransactions });
  } catch (err) {
    console.error(JSON.stringify(err.response?.data || err.message));
    res.status(500).json({ error: err.message });
  }
});

// Live balances straight from Plaid — replaces the manual snapshot + drift estimate.
// Aggregates depository accounts into checking / savings and credit cards into `credit`
// (amount owed), so the frontend can show net worth = cash − card debt.
app.get('/api/live-balances', async (req, res) => {
  const entries = Object.entries(tokens);
  if (!entries.length) return res.json({ ok: false, checking: 0, savings: 0, credit: 0, accounts: [] });
  try {
    const perToken = await Promise.all(entries.map(async ([label, token]) => {
      try {
        const r = await plaidClient.accountsBalanceGet({ access_token: token });
        return { label, accounts: r.data.accounts };
      } catch (e) {
        return { label, accounts: [], error: e.response?.data?.error_code || e.message };
      }
    }));

    let checking = 0, savings = 0, credit = 0;
    const accounts = [];
    let okCount = 0, errCount = 0;
    perToken.forEach(({ label, accounts: accts, error }) => {
      if (error) { errCount++; accounts.push({ label, error }); return; }
      okCount++;
      accts.forEach(a => {
        const bal = a.balances?.current ?? a.balances?.available ?? 0;
        if (a.type === 'credit') {
          credit += bal; // current = outstanding owed
          accounts.push({ label, name: a.name, subtype: a.subtype, balance: bal, kind: 'credit' });
          return;
        }
        if (a.type !== 'depository') return; // skip loan/investment here
        if (a.subtype === 'checking') checking += bal;
        else savings += bal; // savings, money market, cd, hsa, prepaid…
        accounts.push({ label, name: a.name, subtype: a.subtype, balance: bal, kind: 'depository' });
      });
    });

    // Every token failed → tell the frontend so it falls back to the stored
    // snapshot instead of rendering $0 as if it were live.
    if (!okCount) return res.json({ ok: false, checking: 0, savings: 0, credit: 0, accounts, partial: true });

    // Refresh the manual-fallback snapshot on every successful live read.
    const now = new Date().toISOString();
    const up = db.prepare('INSERT OR REPLACE INTO balances (key, amount, updated_at) VALUES (?, ?, ?)');
    up.run('checking', checking, now);
    up.run('savings', savings, now);
    up.run('credit', credit, now);

    res.json({ ok: true, checking, savings, credit, accounts, partial: errCount > 0 });
  } catch (err) {
    console.error(JSON.stringify(err.response?.data || err.message));
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/balances', (req, res) => {
  const rows = db.prepare('SELECT key, amount, updated_at FROM balances').all();
  const result = { checking: 0, savings: 0, credit: 0, checking_updated_at: null, savings_updated_at: null };
  rows.forEach(r => { result[r.key] = r.amount; result[`${r.key}_updated_at`] = r.updated_at; });
  res.json(result);
});

app.post('/api/balances', (req, res) => {
  const { key, amount } = req.body;
  db.prepare('INSERT OR REPLACE INTO balances (key, amount, updated_at) VALUES (?, ?, ?)')
    .run(key, amount, new Date().toISOString());
  res.json({ ok: true });
});

app.get('/api/decisions', (req, res) => {
  const rows = db.prepare('SELECT transaction_id, verdict FROM decisions').all();
  const decisions = {};
  rows.forEach(r => { decisions[r.transaction_id] = r.verdict; });
  res.json({ decisions });
});

app.post('/api/decisions', (req, res) => {
  const { transaction_id, verdict } = req.body;
  db.prepare('INSERT OR REPLACE INTO decisions (transaction_id, verdict, updated_at) VALUES (?, ?, ?)')
    .run(transaction_id, verdict, new Date().toISOString());
  res.json({ ok: true });
});

app.get('/api/budget', (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM budget_items ORDER BY type DESC, id').all() });
});

app.post('/api/budget', (req, res) => {
  const { id, label, amount, type, plaid_cats } = req.body;
  if (id) {
    db.prepare('UPDATE budget_items SET label=?, amount=?, type=?, plaid_cats=? WHERE id=?')
      .run(label, amount, type, plaid_cats || '', id);
    return res.json({ ok: true, id });
  }
  const info = db.prepare('INSERT INTO budget_items (label, amount, type, plaid_cats) VALUES (?,?,?,?)')
    .run(label, amount, type, plaid_cats || '');
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.delete('/api/budget/:id', (req, res) => {
  db.prepare('DELETE FROM budget_items WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/milestones', (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM milestones ORDER BY target').all() });
});

app.post('/api/milestones', (req, res) => {
  const { id, label, target } = req.body;
  if (id) {
    db.prepare('UPDATE milestones SET label=?, target=? WHERE id=?').run(label, target, id);
    return res.json({ ok: true, id });
  }
  const info = db.prepare('INSERT INTO milestones (label, target) VALUES (?,?)').run(label, target);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.delete('/api/milestones/:id', (req, res) => {
  db.prepare('DELETE FROM milestones WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

const logoCache = {}; // label → base64 logo string

app.get('/api/accounts', async (req, res) => {
  const entries = Object.entries(tokens);
  const accounts = await Promise.all(entries.map(async ([label, token]) => {
    if (logoCache[label]) return { label, logo: logoCache[label] };
    try {
      const itemRes = await plaidClient.itemGet({ access_token: token });
      const instId = itemRes.data.item.institution_id;
      const instRes = await plaidClient.institutionsGetById({
        institution_id: instId,
        country_codes: ['US'],
        options: { include_optional_metadata: true }
      });
      const logo = instRes.data.institution.logo || null;
      logoCache[label] = logo;
      return { label, logo };
    } catch {
      return { label, logo: null };
    }
  }));
  res.json({ accounts });
});

// ── Claude chat ───────────────────────────────────────────────────────────────
// The API key stays server-side; the browser only ever posts a question plus the
// context blob it already computed for the dashboard (classification lives in
// index.html, so re-deriving it here would just be a second copy that drifts).

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const CHAT_SYSTEM = `You are the analyst built into a personal budgeting app.
You answer questions about the user's own bank data, supplied below as a snapshot.

Rules:
- Terse and direct. No preamble, no flattery, no "great question". Lead with the number.
- The snapshot is the only data you have. If a question needs a period or a detail that
  isn't in it, say exactly what's missing and what to switch the dashboard to — don't guess.
- Do the arithmetic from the listed figures. Never invent a transaction or a total.
- Amounts: positive = money out (spend), negative = money in (refund/credit).
  Income is already sign-flipped to positive in the totals.
- Categories come from the app's own classifier (essential / extra / savings / income).
  Use those words the way the app does; don't re-litigate them unless asked.
- Plain text with short bullets. Keep answers under ~150 words unless asked to go deep.`;

app.get('/api/chat/status', (req, res) => {
  res.json({ ok: !!anthropic });
});

app.post('/api/chat', async (req, res) => {
  if (!anthropic) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set in .env — add it and restart the server.' });
  }
  const { messages, context } = req.body;
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'No messages.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  // Abort on a real client disconnect only. `req`'s 'close' fires as soon as the
  // request body has been read, which would kill every call before it started —
  // `res` closing while unfinished is the actual "user navigated away" signal.
  let stream;
  res.on('close', () => { if (stream && !res.writableEnded) stream.abort(); });

  try {
    stream = anthropic.messages.stream({
      model: 'claude-opus-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      // medium keeps the bubble responsive; bump to 'high' if answers get sloppy.
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: CHAT_SYSTEM },
        // Cached: the snapshot is identical across every turn of a conversation,
        // so follow-up questions re-read it at ~10% of the input cost.
        { type: 'text', text: String(context || 'No data snapshot was supplied.'), cache_control: { type: 'ephemeral' } },
      ],
      messages: messages.slice(-20).map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || ''),
      })),
    });

    stream.on('text', t => send({ text: t }));
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') send({ error: 'Claude declined to answer that one.' });
    send({ done: true });
  } catch (err) {
    console.error('chat:', err.message);
    if (err instanceof Anthropic.AuthenticationError) send({ error: 'Anthropic rejected the API key — check ANTHROPIC_API_KEY in .env.' });
    else if (err instanceof Anthropic.RateLimitError) send({ error: 'Rate limited by Anthropic — try again in a moment.' });
    else if (err instanceof Anthropic.APIError) send({ error: `Anthropic API error ${err.status}: ${err.message}` });
    else send({ error: err.message });
  }
  res.end();
});

// Loopback only — this server has no authentication, so it must not be
// reachable from other machines on the network.
app.listen(PORT, '127.0.0.1', () => console.log(`Budget server running on http://localhost:${PORT}`));