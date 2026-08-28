// Balances + the Accounts page. Owns everything derived from /api/live-balances:
// the header net-worth figures, the per-account rows, and the manual-entry fallback.
import { state } from './state.js';
import { esc, fmt, fmtSigned, initial, pct } from './format.js';
import { netWorthSeries } from './history.js';

// Pull live balances from Plaid; fall back to the manual store only if Plaid is down.
export async function loadBalances() {
  try {
    const live = await (await fetch('/api/live-balances')).json();
    if (live.ok && live.accounts && live.accounts.length) {
      state.balances.checking = live.checking;
      state.balances.savings  = live.savings;
      state.balances.credit   = live.credit || 0;
      state.balances.live     = true;
      state.balances.partial  = live.partial;
      state.balances.accounts = live.accounts;
      renderBalances();
      return;
    }
  } catch (e) { /* fall through to manual */ }
  const stored = await (await fetch('/api/balances')).json();
  state.balances = { ...stored, live: false };
  renderBalances();
}

export function netWorth() {
  const b = state.balances;
  return (b.checking || 0) + (b.savings || 0) - (b.credit || 0);
}

export function renderBalances() {
  const nw = netWorth();
  const text = fmtSigned(nw);

  const nwEl = document.getElementById('nw-value');
  if (nwEl) nwEl.textContent = text;
  const dashNw = document.getElementById('dash-nw-value');
  if (dashNw) dashNw.textContent = text;

  const src = document.getElementById('bal-source');
  if (src) src.textContent = state.balances.live
    ? (state.balances.partial ? 'live · partial' : 'live · Plaid')
    : 'manual — click a row to edit';

  const note = document.getElementById('nw-note');
  if (note) {
    const cr = state.balances.credit || 0;
    note.textContent = cr > 0 ? `cash − ${fmt(cr)} owed on cards` : 'cash − credit card balances';
  }

  renderNwDelta();
  renderAccountRows();
}

// Month-over-month change, read off the back-walked net worth series. Absent until
// the 365-day history has loaded.
function renderNwDelta() {
  const el = document.getElementById('nw-delta');
  if (!el) return;
  const series = netWorthSeries();
  if (!series || series.values.length < 2) { el.innerHTML = ''; return; }
  const prev = series.values[series.values.length - 2];
  const diff = series.current - prev;
  if (!prev) { el.innerHTML = ''; return; }
  const up = diff >= 0;
  el.innerHTML = `<span class="delta ${up ? 'up' : 'down'}">${up ? '↑' : '↓'} ${fmt(diff)} `
    + `(${pct(Math.abs(diff / prev) * 100)})</span>`;
}

const GROUPS = [
  { key: 'checking', label: 'Cash',         match: a => a.kind === 'depository' && a.subtype === 'checking' },
  { key: 'savings',  label: 'Savings',      match: a => a.kind === 'depository' && a.subtype !== 'checking' },
  { key: 'credit',   label: 'Credit cards', match: a => a.kind === 'credit' },
];

function renderAccountRows() {
  const list = document.getElementById('accounts-list');
  if (!list) return;

  const accts = (state.balances.accounts || []).filter(a => !a.error);
  const errors = (state.balances.accounts || []).filter(a => a.error);

  // Manual mode: no per-account detail exists, so show the three editable totals.
  if (!accts.length) {
    list.innerHTML = ['checking', 'savings', 'credit'].map(key => {
      const label = key === 'credit' ? 'Credit cards' : key[0].toUpperCase() + key.slice(1);
      const amt = state.balances[key] || 0;
      return `<div class="acct" onclick="editBalance('${key}')" style="cursor:pointer">
        <div class="row-logo">${label[0]}</div>
        <div style="flex:1"><div class="acct-name">${label}</div><div class="acct-sub">click to edit</div></div>
        <span class="acct-balance" id="bal-${key}">${key === 'credit' && amt > 0 ? '−' : ''}${fmt(amt)}</span>
      </div>`;
    }).join('');
    return;
  }

  let html = '';
  GROUPS.forEach(g => {
    const rows = accts.filter(g.match);
    if (!rows.length) return;
    const total = rows.reduce((s, a) => s + a.balance, 0);
    html += `<div class="row-group-head">${g.label} · ${g.key === 'credit' ? '−' : ''}${fmt(total)}</div>`;
    html += rows.map(a => `<div class="acct">
      <div class="row-logo">${initial(a.label)}</div>
      <div style="flex:1;min-width:0">
        <div class="acct-name">${esc(a.name)}</div>
        <div class="acct-sub">${esc(a.label)}${a.subtype ? ' · ' + esc(a.subtype) : ''}</div>
      </div>
      <span class="acct-balance ${g.key === 'credit' ? 'red' : ''}">${g.key === 'credit' ? '−' : ''}${fmt(a.balance)}</span>
    </div>`).join('');
  });

  if (errors.length) {
    html += `<div class="row-group-head">Not reachable</div>`
      + errors.map(a => `<div class="acct">
          <div class="row-logo">!</div>
          <div style="flex:1"><div class="acct-name">${esc(a.label)}</div>
          <div class="acct-sub">${esc(a.error)} — may need re-linking</div></div>
        </div>`).join('');
  }

  list.innerHTML = html || '<div class="empty">No accounts returned</div>';
}

// Manual-mode inline edit. In live mode the row click refreshes instead.
export function editBalance(key) {
  if (state.balances.live) { loadBalances(); return; }
  const el = document.getElementById('bal-' + key);
  if (!el || el.querySelector('input')) return;
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.01';
  input.value = (state.balances[key] || 0).toFixed(2);
  input.className = 'bal-input';
  input.onclick = e => e.stopPropagation();
  input.onblur = () => {
    state.balances[key] = parseFloat(input.value) || 0;
    state.balances[`${key}_updated_at`] = new Date().toISOString();
    fetch('/api/balances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, amount: state.balances[key] }),
    });
    renderBalances();
  };
  input.onkeydown = e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') renderBalances();
  };
  el.textContent = '';
  el.appendChild(input);
  input.focus();
  input.select();
}
