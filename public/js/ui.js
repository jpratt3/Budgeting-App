import { state } from './state.js';
import { loadAll } from './data.js';

export function setPeriod(key) {
  const now = new Date();
  if (key === 'mtd') {
    state.periodMode = 'mtd';
    state.currentDays = now.getDate();
  } else if (key === 'ytd') {
    state.periodMode = 'ytd';
    state.currentDays = Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / 86400000);
  } else {
    state.periodMode = 'rolling';
    state.currentDays = parseInt(key);
  }
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`.period-btn[data-key="${key}"]`).forEach(b => b.classList.add('active'));
  loadAll();
}

export async function connectBank() {
  try {
    // Relative URL: the app is served from whatever port PORT names, not always 3000.
    const res = await fetch('/api/create-link-token', { method: 'POST' });
    const data = await res.json();
    const handler = Plaid.create({
      token: data.link_token,
      onSuccess: async (public_token, metadata) => {
        const label = metadata.institution?.name || `account_${Date.now()}`;
        await fetch('/api/exchange-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token, account_label: label }),
        });
        loadAll();
      },
      onExit: (err) => { if (err) console.error(err); },
    });
    handler.open();
  } catch (err) { console.error(err); }
}
