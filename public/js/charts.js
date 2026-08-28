import { state } from './state.js';
import { actualForItem } from './budget.js';
import { fmt, fmtShort, pct } from './format.js';
import { C, moneyScale, catScale } from './theme.js';

let pieChart = null;
let paceChart = null;

export function renderPie(ess, ext, sav, lazy) {
  // Lazy spend is carved out of Extras so the two slices don't double count.
  const cleanExt = Math.max(0, ext - lazy);
  // Empty slices are dropped rather than hidden — a hidden Chart.js legend entry
  // renders struck through, which reads as "disabled" instead of "none this period".
  const slices = [
    { label: 'Essentials', value: ess,      color: C.savings },
    { label: 'Extras',     value: cleanExt, color: C.lazy },
    { label: 'Regretted',  value: lazy,     color: C.spend },
    { label: 'Savings',    value: sav,      color: C.income },
  ].filter(s => s.value > 0);

  if (pieChart) { pieChart.destroy(); pieChart = null; }
  const canvas = document.getElementById('spend-pie');
  if (!canvas || canvas.offsetParent === null || !slices.length) return;

  const labels = slices.map(s => s.label);
  const data   = slices.map(s => s.value);
  const colors = slices.map(s => s.color);
  const total  = data.reduce((s, v) => s + v, 0);

  pieChart = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: C.card, cutout: '62%' }] },
    options: {
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: C.muted, padding: 12,
            generateLabels: chart => chart.data.labels.map((l, i) => ({
              text: `${l}  ${fmtShort(data[i])}`,
              fillStyle: colors[i], strokeStyle: colors[i], lineWidth: 0,
              pointStyle: 'circle', index: i,
            })),
          },
        },
        tooltip: {
          callbacks: {
            label: c => ` ${fmt(c.parsed)}${total > 0 ? ` · ${pct(c.parsed / total * 100)}` : ''}`,
          },
        },
      },
    },
  });
}

export function renderPaceChart() {
  const variables = state.budgetItems.filter(i => i.type === 'variable');
  const totalBudget = variables.reduce((s, i) => s + i.amount * (state.currentDays / 30), 0);
  const totalActual = variables.reduce((s, i) => s + actualForItem(i), 0);
  const timePct  = Math.round(Math.min(100, state.currentDays / 30 * 100));
  const spendPct = totalBudget > 0 ? Math.round(Math.min(150, totalActual / totalBudget * 100)) : 0;
  const onPace   = spendPct <= timePct;

  const note = document.getElementById('pace-note');
  if (note) {
    note.textContent = totalBudget > 0
      ? `${fmt(totalActual)} of ${fmt(totalBudget)} · ${onPace ? 'on pace' : 'running hot'}`
      : 'no variable budgets set';
    note.className = 'card-sub ' + (totalBudget > 0 && !onPace ? 'red' : '');
  }

  if (paceChart) { paceChart.destroy(); paceChart = null; }
  const canvas = document.getElementById('pace-chart');
  if (!canvas || canvas.offsetParent === null) return;

  paceChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ['Time elapsed', 'Budget used'],
      datasets: [{
        data: [timePct, spendPct],
        backgroundColor: ['#d8d5d0', onPace ? C.income : C.spend],
        borderRadius: 5,
        barThickness: 26,
      }],
    },
    options: {
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.parsed.x}%` } },
      },
      scales: {
        x: moneyScale({ min: 0, max: Math.max(100, spendPct + 10), ticks: { color: C.faint, callback: v => v + '%' } }),
        y: catScale(),
      },
    },
  });
}
