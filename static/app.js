const form = document.querySelector('#symptom-form');
const symptomsInput = document.querySelector('#symptoms');
const counter = document.querySelector('#character-count');
const errorBox = document.querySelector('#form-error');
const submitButton = document.querySelector('#submit-button');
const submitLabel = document.querySelector('#submit-label');
const emptyState = document.querySelector('#empty-state');
const loadingState = document.querySelector('#loading-state');
const results = document.querySelector('#results');
const panel = document.querySelector('.insight-panel');
const sampleButton = document.querySelector('#sample-button');
let currentReport = null;

function updateCounter() {
  const length = Array.from(symptomsInput.value).length;
  counter.textContent = `${length} / 200`;
  counter.classList.toggle('over-limit', length > 200);
  symptomsInput.removeAttribute('aria-invalid');
  errorBox.hidden = true;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function renderReport(report) {
  currentReport = report;
  emptyState.hidden = true;
  results.hidden = false;
  document.querySelector('#reported-symptoms').textContent = report.symptoms;
  document.querySelector('#result-label').textContent = report.sample ? 'SAMPLE REPORT' : report.cached ? 'CACHED AI RESPONSE' : 'AI-GENERATED';
  document.querySelector('#urgent-alert').hidden = !report.assessment.urgent;
  document.querySelector('#next-steps').textContent = report.assessment.next_steps;
  const conditions = document.querySelector('#conditions');
  conditions.replaceChildren();
  report.assessment.conditions.forEach((condition, index) => {
    const article = document.createElement('article');
    article.className = 'condition';
    const number = document.createElement('span');
    number.className = 'condition-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const copy = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = condition.name;
    const explanation = document.createElement('p');
    explanation.textContent = condition.explanation;
    copy.append(title, explanation);
    article.append(number, copy);
    conditions.append(article);
  });
  document.querySelector('#save-status').textContent = 'Downloads as a text file';
}

symptomsInput.addEventListener('input', updateCounter);
document.querySelectorAll('[data-example]').forEach(button => {
  button.addEventListener('click', () => {
    symptomsInput.value = button.dataset.example;
    updateCounter();
    symptomsInput.focus();
  });
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  errorBox.hidden = true;
  const symptoms = symptomsInput.value;
  if (!symptoms.trim() || Array.from(symptoms).length > 200) {
    showError(!symptoms.trim() ? 'Please describe your symptoms.' : 'Please keep your symptoms to 200 characters or fewer.');
    symptomsInput.setAttribute('aria-invalid', 'true');
    symptomsInput.focus();
    return;
  }
  if (!document.querySelector('#consent').checked) {
    showError('Please consent to sending your symptoms to the AI provider.');
    document.querySelector('#consent').focus();
    return;
  }
  submitButton.disabled = true;
  sampleButton.disabled = true;
  submitLabel.textContent = 'Considering your symptoms...';
  emptyState.hidden = true;
  results.hidden = true;
  loadingState.hidden = false;
  panel.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symptoms, consent: true }),
      signal: AbortSignal.timeout(65000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The assessment could not be completed. Please try again.');
    renderReport({ ...data, created_at: new Date().toISOString(), sample: false });
    results.setAttribute('tabindex', '-1');
    results.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 700px)').matches) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    const networkError = error instanceof TypeError || error.name === 'TimeoutError';
    showError(networkError ? 'Unable to reach the assessment service. Check your connection and try again. Do not delay urgent care.' : error.message);
    emptyState.hidden = currentReport !== null;
    results.hidden = currentReport === null;
  } finally {
    loadingState.hidden = true;
    panel.setAttribute('aria-busy', 'false');
    submitButton.disabled = false;
    sampleButton.disabled = false;
    submitLabel.textContent = 'Explore possible causes';
  }
});

sampleButton.addEventListener('click', () => {
  renderReport({
    symptoms: "I've had a sore throat and runny nose for two days.",
    sample: true,
    cached: false,
    created_at: new Date().toISOString(),
    assessment: {
      urgent: false,
      conditions: [
        { name: 'Common cold', explanation: 'A viral upper respiratory infection can cause a runny nose and sore throat. These symptoms alone cannot confirm a cold.' },
        { name: 'Seasonal allergies', explanation: 'Airborne allergens can cause a runny nose, while postnasal drip may irritate the throat. Itchy eyes or a seasonal pattern may be relevant.' },
        { name: 'COVID-19 or another respiratory infection', explanation: 'Respiratory infections can have overlapping symptoms. A clinician can help decide whether testing is appropriate.' },
      ],
      next_steps: 'This is a fixed example, not an assessment of your symptoms. For real concerns, speak with a qualified clinician. Seek urgent care for difficulty breathing, chest pain, or severe or rapidly worsening symptoms.',
    },
  });
});

document.querySelector('#save-button').addEventListener('click', () => {
  if (!currentReport) return;
  const report = currentReport;
  const text = [
    'HealthAI | Symptom report',
    report.sample ? 'SAMPLE REPORT - fixed illustrative content, not a personal assessment.' : 'AI-GENERATED - educational information, not a diagnosis.',
    `Created: ${report.created_at}`,
    `Cached response: ${report.cached ? 'Yes' : 'No'}`,
    '', 'SYMPTOMS', report.symptoms, '', 'POSSIBLE CONDITIONS (not ranked)',
    ...report.assessment.conditions.map((condition, index) => `${index + 1}. ${condition.name}\n${condition.explanation}\n`),
    'NEXT STEPS', report.assessment.next_steps,
    ...(report.assessment.urgent ? ['', 'URGENT: Seek immediate medical attention.'] : []),
    '', 'This report is not medical advice. Consult a qualified clinician. For severe symptoms, contact emergency services.',
    'This file contains sensitive health information. Store and share it carefully.',
  ].join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `healthai-${report.sample ? 'sample-' : ''}${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  document.querySelector('#save-status').textContent = 'Download requested. Keep your report private.';
});
