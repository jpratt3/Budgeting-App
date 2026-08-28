// Chart palette + shared Chart.js defaults. Kept in one place so every canvas in the
// app reads as one system and matches the CSS tokens in styles.css.

export const C = {
  text:   '#1c1b19',
  muted:  '#6b6862',
  faint:  '#9b968e',
  line:   '#eceae7',
  card:   '#ffffff',

  accent:  '#f2542d',
  income:  '#1b9e5a',
  spend:   '#e5484d',
  savings: '#2f8f83',
  lazy:    '#e08a1e',

  // Categorical ramp for the pie / Sankey. Warm-to-cool, distinguishable in order.
  cat: ['#1b9e5a', '#e08a1e', '#e5484d', '#2f8f83', '#7b61c4', '#c2569b', '#4a80c9', '#8a8f3f'],
};

export function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Called once at startup.
export function applyChartDefaults() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.font.family = "Inter, 'Segoe UI', -apple-system, sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = C.muted;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.pointStyle = 'circle';
  Chart.defaults.plugins.legend.labels.boxWidth = 7;
  Chart.defaults.plugins.legend.labels.boxHeight = 7;
  Chart.defaults.plugins.legend.labels.padding = 14;
  Chart.defaults.plugins.tooltip.backgroundColor = '#1c1b19';
  Chart.defaults.plugins.tooltip.padding = 9;
  Chart.defaults.plugins.tooltip.cornerRadius = 7;
  Chart.defaults.plugins.tooltip.titleFont = { size: 11, weight: '600' };
  Chart.defaults.plugins.tooltip.bodyFont = { size: 11 };
  Chart.defaults.plugins.tooltip.displayColors = false;
}

// Standard money axis — used by every $-valued scale so tick formatting stays uniform.
export function moneyScale(extra = {}) {
  return {
    ticks: { color: C.faint, callback: v => '$' + Math.round(v).toLocaleString() },
    grid: { color: C.line, drawTicks: false },
    border: { display: false },
    ...extra,
  };
}

export function catScale(extra = {}) {
  return {
    ticks: { color: C.muted },
    grid: { display: false },
    border: { display: false },
    ...extra,
  };
}
