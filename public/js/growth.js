import { state } from './state.js';
import { esc, fmt, fmtMonths, fmtShort, pct } from './format.js';
import { classify, getEffectiveDecision } from './classify.js';
import { C, alpha, moneyScale, catScale } from './theme.js';

let growthChart = null;

export function computeGrowthAt(pv, pmt, annualRate, months) {
  const r = annualRate / 100 / 12;
  if (r === 0) return pv + pmt * months;
  return pv * Math.pow(1 + r, months) + pmt * (Math.pow(1 + r, months) - 1) / r;
}

export function monthsToReach(pv, pmt, annualRate, target) {
  if (pv >= target) return 0;
  if (pmt <= 0) return Infinity;
  const r = annualRate / 100 / 12;
  let v = pv;
  for (let m = 1; m <= 1200; m++) {
    v = r > 0 ? v * (1 + r) + pmt : v + pmt;
    if (v >= target) return m;
  }
  return Infinity;
}

// Auto-fill the inputs from the budget and live balances until the user types over
// them — dataset.manual is the latch that stops us clobbering their edits.
export function syncGrowthInputs() {
  const savingsEl = document.getElementById('growth-savings');
  const startEl   = document.getElementById('growth-start');
  if (!savingsEl || !startEl) return;

  if (!savingsEl.dataset.manual) {
    const constants = state.budgetItems.filter(i => i.type === 'constant');
    const variables = state.budgetItems.filter(i => i.type === 'variable');
    let periodIncome = 0;
    state.allTransactions.forEach(t => { if (classify(t) === 'income') periodIncome += -t.amount; });
    const monthly = state.currentDays > 0 ? periodIncome * (30 / state.currentDays) : 0;
    const proj = monthly - constants.reduce((s, i) => s + i.amount, 0) - variables.reduce((s, i) => s + i.amount, 0);
    savingsEl.value = Math.max(0, Math.round(proj));
  }
  if (!startEl.dataset.manual) {
    startEl.value = Math.round((state.balances.checking || 0) + (state.balances.savings || 0) - (state.balances.credit || 0));
  }
}

export function toggleLazyGrowth() {
  state.lazyGrowthOn = !state.lazyGrowthOn;
  const btn = document.getElementById('growth-lazy-btn');
  if (btn) {
    btn.textContent = state.lazyGrowthOn ? '✓ Excluding lazy spending' : '+ Include lazy savings';
    btn.className = state.lazyGrowthOn ? 'btn btn-primary' : 'btn';
  }
  renderGrowth();
}

export function renderGrowth() {
  syncGrowthInputs();
  const pmt        = parseFloat(document.getElementById('growth-savings')?.value) || 0;
  const annualRate = parseFloat(document.getElementById('growth-return')?.value)  || 7;
  const pv         = parseFloat(document.getElementById('growth-start')?.value)   || 0;

  // What the regretted spend would compound into if it were saved instead.
  const regrettedPeriod = state.allTransactions
    .filter(t => getEffectiveDecision(t) === 'disapproved' && t.amount > 0)
    .reduce((s, t) => s + t.amount, 0);
  const regrettedMonthly = state.currentDays > 0 ? regrettedPeriod * (30 / state.currentDays) : 0;
  const optimisticPmt = pmt + (state.lazyGrowthOn ? regrettedMonthly : 0);

  renderGrowthChart(pv, pmt, optimisticPmt, annualRate);
  renderMilestones(pv, pmt, optimisticPmt, annualRate);
}

function renderGrowthChart(pv, pmt, optimisticPmt, annualRate) {
  if (growthChart) { growthChart.destroy(); growthChart = null; }
  const canvas = document.getElementById('growth-chart');
  if (!canvas || canvas.offsetParent === null) return;

  const years = [0, 1, 2, 3, 5, 10, 15, 20, 25, 30];
  const labels = years.map(y => y === 0 ? 'Now' : y + 'yr');
  const baseData = years.map(y => Math.round(computeGrowthAt(pv, pmt, annualRate, y * 12)));
  const optData = state.lazyGrowthOn
    ? years.map(y => Math.round(computeGrowthAt(pv, optimisticPmt, annualRate, y * 12)))
    : null;

  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 300);
  grad.addColorStop(0, alpha(C.income, 0.22));
  grad.addColorStop(1, alpha(C.income, 0.01));

  const datasets = [{
    label: 'Projected', data: baseData,
    borderColor: C.income, backgroundColor: grad, borderWidth: 2,
    fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 4,
  }];
  if (optData) datasets.push({
    label: 'Without lazy spending', data: optData,
    borderColor: C.savings, backgroundColor: 'transparent', borderWidth: 2,
    borderDash: [6, 3], fill: false, tension: 0.35, pointRadius: 0, pointHoverRadius: 4,
  });

  growthChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'start' },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtShort(c.parsed.y)}` } },
      },
      scales: { y: moneyScale({ beginAtZero: true }), x: catScale() },
    },
  });
}

function renderMilestones(pv, pmt, optimisticPmt, annualRate) {
  const listEl = document.getElementById('milestones-list');
  if (!listEl) return;
  if (!state.milestones.length) {
    listEl.innerHTML = '<div class="empty">No goals set</div>';
    return;
  }

  listEl.innerHTML = state.milestones.map(m => {
    const base = monthsToReach(pv, pmt, annualRate, m.target);
    const opt  = state.lazyGrowthOn ? monthsToReach(pv, optimisticPmt, annualRate, m.target) : null;
    const progress = m.target > 0 ? Math.min(100, Math.max(0, pv / m.target * 100)) : 0;
    const optStr = (opt !== null && opt < base)
      ? `<span class="goal-eta win">${esc(fmtMonths(opt))} without lazy</span>` : '';
    return `<div class="goal">
      <div class="goal-icon">${progress >= 100 ? '✓' : '⚑'}</div>
      <div class="goal-main">
        <div class="goal-top">
          <span class="goal-name">${esc(m.label)}</span>
          <span class="goal-amount">${fmt(Math.min(pv, m.target))}</span>
        </div>
        <div class="goal-sub">
          <span class="goal-eta">${esc(fmtMonths(base))}</span>
          ${optStr}
          <span style="margin-left:auto">${fmt(m.target)} target · ${pct(progress)}</span>
        </div>
        <div class="goal-bar"><span style="width:${progress}%"></span></div>
      </div>
      <button class="budget-item-del" style="opacity:1" onclick="deleteMilestone(${m.id})">✕</button>
    </div>`;
  }).join('');
}

export async function loadGrowth() {
  const res = await fetch('/api/milestones');
  state.milestones = (await res.json()).items || [];
  renderGrowth();
}

export async function addMilestone() {
  const label = prompt('Goal name (e.g. Emergency Fund):');
  if (!label) return;
  const target = parseFloat(prompt('Target amount ($):') || '0') || 0;
  const res = await fetch('/api/milestones', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, target }),
  });
  const data = await res.json();
  state.milestones.push({ id: data.id, label, target });
  state.milestones.sort((a, b) => a.target - b.target);
  renderGrowth();
}

export async function deleteMilestone(id) {
  await fetch(`/api/milestones/${id}`, { method: 'DELETE' });
  state.milestones = state.milestones.filter(m => m.id !== id);
  renderGrowth();
}
