import { state } from './state.js';
import { CHAT_SUGGESTIONS, CHAT_TXN_CAP } from './constants.js';
import { cleanLabel } from './format.js';
import { classify, getEffectiveDecision, isRentTxn } from './classify.js';
import { periodDates } from './period.js';
import { actualForItem, uncategorizedTxns } from './budget.js';
import { earliestDataMonth, ensureHistory, renderSavingsHistory } from './history.js';

let chatMessages = [];   // {role, content} — the wire history
let chatBusy = false;
let chatKeyReady = null; // null = unchecked

export function chatScopeLabel() {
  const { start, end } = periodDates();
  const mode = state.periodMode === 'mtd' ? 'month to date' : state.periodMode === 'ytd' ? 'year to date' : `last ${state.currentDays}d`;
  return `${mode} · ${start} → ${end}`;
}

// Same monthly buckets the savings-history chart uses, but kept whole (no
// partial-month drop) — the model is told which month is partial instead.
export function monthlyRollupLines() {
  if (!state.historyTransactions || !state.historyTransactions.length) return [];
  const months = {};
  state.historyTransactions.forEach(t => {
    const ym = t.date.slice(0, 7);
    if (!months[ym]) months[ym] = { income: 0, essential: 0, extra: 0, savings: 0 };
    const type = classify(t);
    if (type === 'income') months[ym].income += -t.amount;
    else if (type === 'essential') months[ym].essential += t.amount;
    else if (type === 'extra') months[ym].extra += t.amount;
    else if (type === 'savings') months[ym].savings += t.amount;
  });
  const partial = earliestDataMonth(state.historyTransactions);
  const thisMonth = new Date().toISOString().slice(0, 7);
  return Object.keys(months).sort().map(ym => {
    const m = months[ym];
    const flag = ym === partial ? '  [PARTIAL — history starts mid-month]'
      : ym === thisMonth ? '  [in progress]' : '';
    return `${ym}  income ${m.income.toFixed(0)}  essential ${m.essential.toFixed(0)}  extra ${m.extra.toFixed(0)}  to-savings ${m.savings.toFixed(0)}${flag}`;
  });
}


export function buildChatContext() {
  const { start, end } = periodDates();
  const L = [];
  L.push(`Today: ${new Date().toISOString().slice(0, 10)}`);
  L.push(`Dashboard period on screen: ${chatScopeLabel()}`);
  L.push('');

  const ck = state.balances.checking || 0, sv = state.balances.savings || 0, cr = state.balances.credit || 0;
  L.push('== BALANCES ==');
  L.push(`checking ${ck.toFixed(2)} | savings ${sv.toFixed(2)} | credit card owed ${cr.toFixed(2)} | net worth ${(ck + sv - cr).toFixed(2)}`);
  L.push(state.balances.live ? '(live from Plaid)' : '(stored snapshot, not live)');
  L.push('');

  // Period totals + per-category buckets, mirroring renderAll().
  const buckets = { essential: {}, extra: {}, savings: {} };
  let spent = 0, saved = 0, income = 0;
  state.allTransactions.forEach(t => {
    const type = classify(t);
    if (type === 'skip' || type === 'balance') return;
    if (type === 'income') { income += -t.amount; return; }
    const label = isRentTxn(t) ? 'Rent'
      : type === 'savings' ? 'Savings Transfer'
      : cleanLabel(t.personal_finance_category?.detailed || t.personal_finance_category?.primary || 'Other');
    buckets[type][label] = (buckets[type][label] || 0) + t.amount;
    if (type === 'savings') saved += t.amount; else spent += t.amount;
  });
  const lazyTotal = state.allTransactions
    .filter(t => getEffectiveDecision(t) === 'disapproved' && t.amount > 0)
    .reduce((s, t) => s + t.amount, 0);

  L.push('== THIS PERIOD ==');
  L.push(`income ${income.toFixed(2)} | spent ${spent.toFixed(2)} | transferred to savings ${saved.toFixed(2)} | net kept ${(income - spent).toFixed(2)} | regretted "lazy" spend ${lazyTotal.toFixed(2)}`);
  ['essential', 'extra', 'savings'].forEach(type => {
    const rows = Object.entries(buckets[type]).sort((a, b) => b[1] - a[1]);
    if (!rows.length) return;
    L.push(`${type}:`);
    rows.forEach(([label, amt]) => L.push(`  ${label}: ${amt.toFixed(2)}`));
  });
  L.push('');

  if (state.budgetItems.length) {
    L.push('== BUDGET (monthly targets vs this period\'s actuals) ==');
    state.budgetItems.forEach(i => {
      const actual = i.type === 'variable' ? actualForItem(i) : null;
      L.push(`${i.label} [${i.type}] budget ${i.amount.toFixed(0)}` +
        (actual === null ? '' : ` | actual ${actual.toFixed(2)}` + (i.plaid_cats ? ` | cats ${i.plaid_cats}` : ' | no category mapping')));
    });
    const unc = uncategorizedTxns();
    if (unc.length) L.push(`uncategorized spend: ${unc.reduce((s, t) => s + t.amount, 0).toFixed(2)} across ${unc.length} txns`);
    L.push('');
  }

  if (state.milestones.length) {
    L.push('== SAVINGS GOALS ==');
    state.milestones.forEach(m => L.push(`${m.label}: target ${m.target.toFixed(0)}`));
    L.push('');
  }

  const rollup = monthlyRollupLines();
  if (rollup.length) {
    L.push('== MONTHLY HISTORY (last 12 months, all classified txns) ==');
    rollup.forEach(r => L.push(r));
    L.push('');
  }

  L.push(`== TRANSACTIONS ${start} → ${end} (positive = spend, negative = credit) ==`);
  L.push('date | merchant | amount | class | verdict');
  const rows = state.allTransactions
    .filter(t => classify(t) !== 'skip')
    .sort((a, b) => b.date.localeCompare(a.date));
  if (rows.length > CHAT_TXN_CAP) L.push(`(${rows.length} txns in period; showing the ${CHAT_TXN_CAP} most recent — totals above cover all of them)`);
  rows.slice(0, CHAT_TXN_CAP).forEach(t => {
    const v = getEffectiveDecision(t);
    L.push(`${t.date} | ${(t.merchant_name || t.name || '?').slice(0, 40)} | ${t.amount.toFixed(2)} | ${classify(t)}${v ? ` | ${v === 'disapproved' ? 'regret' : v === 'approved' ? 'worth it' : v}` : ''}`);
  });

  return L.join('\n');
}

export function chatMd(text) {
  const esc = text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return esc
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^[-*]\s+(.*)$/gm, '<span class="bul">• $1</span>');
}

export function renderChat() {
  const log = document.getElementById('chat-log');
  document.getElementById('chat-scope').textContent = chatScopeLabel();

  if (!chatMessages.length) {
    log.innerHTML = `<div class="chat-empty">
      Ask anything about the data on this dashboard — it sees your ${chatKeyReady === false ? '' : 'balances, budget, and every transaction in the selected period'}.
      ${chatKeyReady === false ? '<b>No API key yet.</b> Add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> and restart the server.' : ''}
      <div style="margin-top:10px">${CHAT_SUGGESTIONS.map(s => `<span class="chat-chip" onclick="askSuggestion(this)">${s}</span>`).join('')}</div>
    </div>`;
    return;
  }

  log.innerHTML = chatMessages.map(m => {
    const cls = m.role === 'user' ? 'user' : m.error ? 'err' : 'bot';
    const body = m.role === 'user' ? chatMd(m.content)
      : m.content ? chatMd(m.content)
      : '<span class="chat-dots"><span></span><span></span><span></span></span>';
    return `<div class="chat-msg ${cls}">${body}</div>`;
  }).join('');
  log.scrollTop = log.scrollHeight;
}

export function toggleChat() {
  const panel = document.getElementById('chat-panel');
  const open = panel.classList.toggle('open');
  if (!open) return;
  if (chatKeyReady === null) {
    fetch('/api/chat/status').then(r => r.json()).then(d => { chatKeyReady = !!d.ok; renderChat(); }).catch(() => {});
  }
  // The 12-month rollup makes month-over-month questions answerable even on a 2W view.
  ensureHistoryForChat();
  renderChat();
  document.getElementById('chat-input').focus();
}

// The 12-month rollup makes month-over-month questions answerable even on a 2W view.
// Shares the one history fetch with Reports/Recurring rather than racing its own.
export async function ensureHistoryForChat() {
  await ensureHistory();
  if (state.page === 'reports') renderSavingsHistory();
}

export function resetChat() {
  chatMessages = [];
  renderChat();
}

export function chatGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 96) + 'px';
}

export function chatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
}

export function askSuggestion(el) {
  document.getElementById('chat-input').value = el.textContent.trim();
  sendChat();
}

export async function sendChat() {
  if (chatBusy) return;
  const input = document.getElementById('chat-input');
  const q = input.value.trim();
  if (!q) return;

  input.value = '';
  chatGrow(input);
  chatBusy = true;
  document.getElementById('chat-send').disabled = true;

  chatMessages.push({ role: 'user', content: q });
  const reply = { role: 'assistant', content: '' };
  chatMessages.push(reply);
  renderChat();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: buildChatContext(),
        // Drop failed turns — an error string is not an answer the model should
        // treat as its own prior reply.
        messages: chatMessages.slice(0, -1)
          .filter(m => !m.error)
          .map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        const line = part.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        const evt = JSON.parse(line.slice(6));
        if (evt.text) { reply.content += evt.text; renderChat(); }
        else if (evt.error) { reply.content = evt.error; reply.error = true; renderChat(); }
      }
    }
    if (!reply.content) { reply.content = 'No response returned.'; reply.error = true; }
  } catch (err) {
    reply.content = err.message;
    reply.error = true;
  }

  chatBusy = false;
  document.getElementById('chat-send').disabled = false;
  renderChat();
  document.getElementById('chat-input').focus();
}
