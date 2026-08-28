// Hand-rolled SVG Sankey. No D3 — the graph here is a fixed three-column shape
// (Income → buckets → categories), so a general-purpose layout solver would be far
// more machinery than the problem needs.
import { state } from './state.js';
import { classify, isRentTxn } from './classify.js';
import { cleanLabel, esc, fmt, fmtShort, pct } from './format.js';
import { C, alpha } from './theme.js';

const NODE_W = 13;
const GAP = 9;           // vertical gap between nodes in a column
const MIN_H = 14;        // floor so a dominant node can't squash the rest to nothing
const PAD_T = 14;
const PAD_B = 14;
const LABEL_PAD = 8;
const MAX_CATS = 7;      // per bucket, before folding into "Other"

// Buckets the on-screen period into the flow graph. Mirrors renderAll()'s accounting
// so the Sankey totals match the dashboard KPIs exactly.
export function cashflowModel(txns = state.allTransactions) {
  let income = 0;
  const byBucket = { essential: {}, extra: {}, savings: {} };
  const totals = { essential: 0, extra: 0, savings: 0 };

  txns.forEach(t => {
    const type = classify(t);
    if (type === 'income') { income += -t.amount; return; }
    if (type !== 'essential' && type !== 'extra' && type !== 'savings') return;
    const label = isRentTxn(t) ? 'Rent'
      : type === 'savings' ? 'Savings Transfer'
      : cleanLabel(t.personal_finance_category?.detailed || t.personal_finance_category?.primary || 'Other');
    byBucket[type][label] = (byBucket[type][label] || 0) + t.amount;
    totals[type] += t.amount;
  });

  // Refunds can push an individual category negative; a negative ribbon has no
  // meaning in a flow diagram, so clamp at zero and let the bucket total absorb it.
  Object.keys(byBucket).forEach(b => {
    Object.keys(byBucket[b]).forEach(k => { if (byBucket[b][k] <= 0) delete byBucket[b][k]; });
  });
  Object.keys(totals).forEach(k => { totals[k] = Math.max(0, totals[k]); });

  const spent = totals.essential + totals.extra;
  const unspent = Math.max(0, income - spent - totals.savings);
  return { income, totals, byBucket, spent, unspent };
}

// Folds a bucket's categories down to MAX_CATS + "Other".
function topCats(map) {
  const rows = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (rows.length <= MAX_CATS) return rows;
  const head = rows.slice(0, MAX_CATS);
  const rest = rows.slice(MAX_CATS).reduce((s, r) => s + r[1], 0);
  if (rest > 0) head.push(['Other', rest]);
  return head;
}

export function renderSankey() {
  const wrap = document.getElementById('sankey-wrap');
  if (!wrap) return;

  const m = cashflowModel();
  renderCashflowKpis(m);

  if (m.income <= 0 && m.spent <= 0) {
    wrap.innerHTML = '<div class="empty">No income or spending in this period</div>';
    return;
  }

  // ── Build nodes/links ────────────────────────────────────────────────────
  const nodes = [];
  const links = [];
  const add = (id, label, value, col, color) => { nodes.push({ id, label, value, col, color }); return id; };

  const total = Math.max(m.income, m.spent + m.totals.savings + m.unspent);
  add('income', 'Income', total, 0, C.income);

  const buckets = [
    { id: 'essential', label: 'Essentials', value: m.totals.essential, color: C.savings },
    { id: 'extra',     label: 'Extras',     value: m.totals.extra,     color: C.lazy },
    { id: 'savings',   label: 'Savings',    value: m.totals.savings,   color: C.income },
    { id: 'unspent',   label: 'Left over',  value: m.unspent,          color: alpha(C.income, 0.55) },
  ].filter(b => b.value > 0);

  buckets.forEach(b => {
    add(b.id, b.label, b.value, 1, b.color);
    links.push({ source: 'income', target: b.id, value: b.value, color: b.color });
  });

  // Column 2 — categories inside Essentials and Extras only. Savings and Left over
  // are terminal: breaking them down adds no information.
  ['essential', 'extra'].forEach(bucketId => {
    const bucket = buckets.find(b => b.id === bucketId);
    if (!bucket) return;
    topCats(m.byBucket[bucketId]).forEach(([label, value], i) => {
      const id = `${bucketId}:${label}`;
      const color = C.cat[i % C.cat.length];
      add(id, label, value, 2, color);
      links.push({ source: bucketId, target: id, value, color });
    });
  });

  // ── Layout ───────────────────────────────────────────────────────────────
  const cols = [0, 1, 2].map(c => nodes.filter(n => n.col === c));
  const usedCols = cols.filter(c => c.length);

  // Column x positions are asymmetric on purpose: the left column labels outward,
  // the right column needs room for long category names.
  const W = 1000;
  const COL_X = [120, 470, 700];
  const LABEL_MAX = 30;

  // A dominant node (a big "Left over") compresses everything else toward zero
  // height, so enforce a floor. Ribbons then taper between the true proportion at
  // the source and the clamped height at the target rather than going invisible.
  const gapsIn = col => Math.max(0, col.length - 1) * GAP;
  const colTotal = col => Math.max(1, col.reduce((s, n) => s + n.value, 0));

  const rows = Math.max(...usedCols.map(c => c.length));
  const H = Math.max(320, rows * (MIN_H + GAP) + PAD_T + PAD_B);
  const usable = H - PAD_T - PAD_B;

  // Pixels per dollar, sized so the fullest column fits once its floors are paid for.
  const scale = Math.min(...usedCols.map(col => {
    const floored = col.filter(n => n.value * (usable / colTotal(col)) < MIN_H).length;
    return (usable - gapsIn(col) - floored * MIN_H) / Math.max(1, colTotal(col));
  }));

  const pos = {};
  cols.forEach((col, c) => {
    const heights = col.map(n => Math.max(MIN_H, n.value * scale));
    const stack = heights.reduce((s, h) => s + h, 0) + gapsIn(col);
    let y = PAD_T + Math.max(0, (usable - stack) / 2); // center each column vertically
    col.forEach((n, i) => {
      pos[n.id] = { x: COL_X[c], y, h: heights[i], col: c, node: n };
      y += heights[i] + GAP;
    });
  });

  // Each node here has exactly one parent, so a ribbon lands at its target's full
  // height and leaves its source at that target's proportional share.
  const outOff = {};
  const ribbons = links.map(l => {
    const s = pos[l.source], t = pos[l.target];
    if (!s || !t) return '';
    const siblings = links.filter(x => x.source === l.source);
    const sibTotal = siblings.reduce((sum, x) => sum + x.value, 0) || 1;
    const sTh = Math.max(1, s.h * (l.value / sibTotal));
    const tTh = t.h;
    const sy = s.y + (outOff[l.source] || 0); outOff[l.source] = (outOff[l.source] || 0) + sTh;
    const ty = t.y;
    const x0 = s.x + NODE_W, x1 = t.x, xm = (x0 + x1) / 2;
    const d = `M${x0},${sy} C${xm},${sy} ${xm},${ty} ${x1},${ty}`
            + ` L${x1},${ty + tTh} C${xm},${ty + tTh} ${xm},${sy + sTh} ${x0},${sy + sTh} Z`;
    const share = m.income > 0 ? ` (${pct(l.value / m.income * 100)})` : '';
    return `<path class="sankey-link" d="${d}" fill="${l.color}">`
         + `<title>${esc(t.node.label)}: ${fmt(l.value)}${share}</title></path>`;
  }).join('');

  const clip = s => s.length > LABEL_MAX ? s.slice(0, LABEL_MAX - 1) + '…' : s;

  const rects = nodes.map(n => {
    const p = pos[n.id];
    const labelRight = n.col === 2;
    const tx = labelRight ? p.x + NODE_W + LABEL_PAD : p.x - LABEL_PAD;
    const anchor = labelRight ? 'start' : 'end';
    const mid = p.y + p.h / 2;
    // Two stacked lines need ~22px of vertical room. Thin nodes collapse to a single
    // "Label $value" line so neighbouring labels can't overlap.
    const text = p.h >= 22
      ? `<text class="sankey-label" x="${tx}" y="${mid - 1}" text-anchor="${anchor}">${esc(clip(n.label))}</text>
         <text class="sankey-value" x="${tx}" y="${mid + 11}" text-anchor="${anchor}">${fmtShort(n.value)}</text>`
      : `<text class="sankey-label" x="${tx}" y="${mid + 4}" text-anchor="${anchor}">${esc(clip(n.label))}
           <tspan class="sankey-value" dx="5">${fmtShort(n.value)}</tspan></text>`;
    return `<g class="sankey-node">
      <rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${p.h}" fill="${n.color}"></rect>
      ${text}
      <title>${esc(n.label)}: ${fmt(n.value)}</title>
    </g>`;
  }).join('');

  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img"
    aria-label="Cash flow from income to spending categories">${ribbons}${rects}</svg>`;
}

function renderCashflowKpis(m) {
  const set = (id, text, cls) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (cls !== undefined) el.className = 'kpi-value ' + cls;
  };
  const net = m.income - m.spent;
  const rate = m.income > 0 ? (net / m.income) * 100 : 0;
  set('cf-income', m.income > 0 ? fmt(m.income) : '—', 'green');
  set('cf-expenses', fmt(m.spent), 'red');
  set('cf-net', m.income > 0 ? (net < 0 ? '−' : '') + fmt(net) : '—', net >= 0 ? 'green' : 'red');
  set('cf-rate', m.income > 0 ? pct(rate) : '—', rate >= 0 ? '' : 'red');
}
