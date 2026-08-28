import { state } from './state.js';
import { LAZY_SURVEY_CATS } from './constants.js';
import { clearDerivedCaches } from './classify.js';
import { renderAll } from './overview.js';
import { esc } from './format.js';

export function showLazySurvey() {
  const prefs = JSON.parse(localStorage.getItem('lazyPrefs') || '{}');
  document.getElementById('survey-grid').innerHTML = LAZY_SURVEY_CATS.map(cat => {
    const cur = prefs[cat.key] || 'review';
    const opts = ['approve', 'review', 'regret'];
    const labels = { approve: 'Auto-approve', review: 'Review', regret: 'Auto-regret' };
    return `<div class="survey-row">
      <div class="survey-cat-label">${esc(cat.label)}${cat.hint ? `<span class="survey-hint">${esc(cat.hint)}</span>` : ''}</div>
      <div class="survey-options">
        ${opts.map(o => `<label class="survey-opt ${o}${cur===o?' active':''}">
          <input type="radio" name="lsp-${cat.key}" value="${o}" ${cur===o?'checked':''} onchange="surveyOptChange(this)">
          ${labels[o]}
        </label>`).join('')}
      </div>
    </div>`;
  }).join('');
  document.getElementById('lazy-survey-overlay').style.display = 'flex';
}

export function surveyOptChange(input) {
  input.closest('.survey-options').querySelectorAll('label').forEach(l => l.classList.remove('active'));
  input.closest('label').classList.add('active');
}

export function saveLazySurvey() {
  const prefs = {};
  LAZY_SURVEY_CATS.forEach(cat => {
    const el = document.querySelector(`input[name="lsp-${cat.key}"]:checked`);
    if (el) prefs[cat.key] = el.value;
  });
  localStorage.setItem('lazyPrefs', JSON.stringify(prefs));
  localStorage.setItem('lazySurveyDone', '1');
  document.getElementById('lazy-survey-overlay').style.display = 'none';
  // The prefs feed getLazyPref(), which auto-regret rules read — drop the memo first.
  clearDerivedCaches();
  if (state.allTransactions.length) renderAll(state.allTransactions);
}

export function resetLazySurvey() {
  localStorage.removeItem('lazySurveyDone');
  showLazySurvey();
}
