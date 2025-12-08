/**
 * ETF Simulator - UI Form Module
 * Version 2.0
 * 
 * Formularbindung, Validierung und Wizard
 */

import {
  DEFAULT_SCENARIO,
  SCENARIO_PRESETS,
  UI_MODE_SIMPLE,
  UI_MODE_EXPERT,
  EXPERT_ONLY_FIELDS,
  STRESS_SCENARIOS,
  SPARERPAUSCHBETRAG_SINGLE,
  SPARERPAUSCHBETRAG_VERHEIRATET,
} from './constants.js';

import {
  getActiveScenario,
  getActiveScenarioId,
  updateScenario,
  applyPreset,
  getUiMode,
  setUiMode,
  toggleUiMode,
  scenarioToParams,
  setActiveScenario,
  getAllScenarios,
  duplicateScenario,
  resetScenario,
} from './state.js';

// ============ FIELD MAPPINGS ============

// Mapping: Formular-ID -> Szenario-Feld
const FIELD_MAP = {
  start_savings: 'start_savings',
  start_etf: 'start_etf',
  start_etf_cost_basis: 'start_etf_cost_basis',
  savings_rate: 'savings_rate_pa',
  etf_rate: 'etf_rate_pa',
  etf_ter: 'etf_ter_pa',
  savings_target: 'savings_target',
  years_save: 'savings_years',
  monthly_savings: 'monthly_savings',
  monthly_etf: 'monthly_etf',
  annual_raise: 'annual_raise_percent',
  special_savings: 'special_payout_net_savings',
  special_savings_interval: 'special_interval_years_savings',
  years_withdraw: 'withdrawal_years',
  rent_eur: 'monthly_payout_net',
  rent_percent: 'monthly_payout_percent',
  withdrawal_min: 'withdrawal_min',
  withdrawal_max: 'withdrawal_max',
  special_withdraw: 'special_payout_net_withdrawal',
  special_withdraw_interval: 'special_interval_years_withdrawal',
  inflation_rate: 'inflation_rate_pa',
  sparerpauschbetrag: 'sparerpauschbetrag',
  basiszins: 'basiszins',
  capital_preservation_threshold: 'capital_preservation_threshold',
  capital_preservation_reduction: 'capital_preservation_reduction',
  capital_preservation_recovery: 'capital_preservation_recovery',
  loss_pot: 'loss_pot',
  mc_iterations: 'mc_iterations',
  mc_volatility: 'mc_volatility',
  mc_success_threshold: 'mc_success_threshold',
  mc_ruin_threshold: 'mc_ruin_threshold',
  mc_seed: 'mc_seed',
};

const CHECKBOX_MAP = {
  inflation_adjust_withdrawal: 'inflation_adjust_withdrawal',
  inflation_adjust_special_savings: 'inflation_adjust_special_savings',
  inflation_adjust_special_withdrawal: 'inflation_adjust_special_withdrawal',
  capital_preservation_enabled: 'capital_preservation_enabled',
  use_lifo: 'use_lifo',
  rent_is_gross: 'rent_is_gross',
  mc_show_individual: 'mc_show_individual',
  is_married: 'is_married',
};

const SELECT_MAP = {
  kirchensteuer: 'kirchensteuer',
  fondstyp: 'fondstyp',
};

// ============ FORM BINDING ============

/**
 * Liest numerischen Wert aus Formularfeld
 */
export function readNumber(id, { min = null, max = null, allowZero = true } = {}) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Feld nicht gefunden: ${id}`);
  
  const label = el.previousElementSibling?.textContent || id;
  const val = parseFloat(String(el.value).replace(',', '.'));
  
  if (Number.isNaN(val)) {
    throw new Error(`Bitte Wert prüfen: ${label}`);
  }
  if (!allowZero && val === 0) {
    throw new Error(`${label} darf nicht 0 sein.`);
  }
  if (min !== null && val < min) {
    throw new Error(`${label} muss mindestens ${min} sein.`);
  }
  if (max !== null && val > max) {
    throw new Error(`${label} darf maximal ${max} sein.`);
  }
  return val;
}

/**
 * Liest alle Formularwerte und aktualisiert das aktive Szenario
 */
export function readFormToScenario() {
  const updates = {};
  
  // Numerische Felder
  for (const [inputId, scenarioKey] of Object.entries(FIELD_MAP)) {
    const el = document.getElementById(inputId);
    if (el) {
      const val = parseFloat(String(el.value).replace(',', '.'));
      if (!Number.isNaN(val)) {
        updates[scenarioKey] = val;
      }
    }
  }
  
  // Checkboxen
  for (const [inputId, scenarioKey] of Object.entries(CHECKBOX_MAP)) {
    const el = document.getElementById(inputId);
    if (el) {
      updates[scenarioKey] = el.checked;
    }
  }
  
  // Select-Felder
  for (const [inputId, scenarioKey] of Object.entries(SELECT_MAP)) {
    const el = document.getElementById(inputId);
    if (el) {
      updates[scenarioKey] = el.value;
    }
  }
  
  // Rent-Mode Radio
  const rentModeEur = document.querySelector('input[name="rent_mode"][value="eur"]');
  if (rentModeEur) {
    updates.rent_mode = rentModeEur.checked ? 'eur' : 'percent';
  }
  
  // Stress-Szenario (falls vorhanden)
  const stressSelect = document.getElementById('stress_scenario');
  if (stressSelect) {
    updates.stress_scenario = stressSelect.value;
  }
  
  updateScenario(getActiveScenarioId(), updates);
  
  return getActiveScenario();
}

/**
 * Schreibt Szenario-Werte ins Formular
 */
export function writeScenarioToForm(scenario) {
  if (!scenario) return;
  
  // Numerische Felder
  for (const [inputId, scenarioKey] of Object.entries(FIELD_MAP)) {
    const el = document.getElementById(inputId);
    if (el && scenario[scenarioKey] !== undefined) {
      el.value = scenario[scenarioKey];
    }
  }
  
  // Checkboxen
  for (const [inputId, scenarioKey] of Object.entries(CHECKBOX_MAP)) {
    const el = document.getElementById(inputId);
    if (el && scenario[scenarioKey] !== undefined) {
      el.checked = scenario[scenarioKey];
    }
  }
  
  // Select-Felder
  for (const [inputId, scenarioKey] of Object.entries(SELECT_MAP)) {
    const el = document.getElementById(inputId);
    if (el && scenario[scenarioKey] !== undefined) {
      el.value = scenario[scenarioKey];
    }
  }
  
  // Rent-Mode Radio
  const rentModeRadio = document.querySelector(`input[name="rent_mode"][value="${scenario.rent_mode}"]`);
  if (rentModeRadio) {
    rentModeRadio.checked = true;
  }
  
  // Stress-Szenario
  const stressSelect = document.getElementById('stress_scenario');
  if (stressSelect && scenario.stress_scenario) {
    stressSelect.value = scenario.stress_scenario;
  }
  
  // UI-Updates
  updateRentModeFields();
  updateCapitalPreservationFields();
}

/**
 * Aktualisiert Rent-Mode-bezogene Felder
 */
export function updateRentModeFields() {
  const rentModeEur = document.querySelector('input[name="rent_mode"][value="eur"]');
  const isEurMode = rentModeEur?.checked ?? true;
  
  const eurField = document.getElementById('rent_eur')?.closest('.field');
  const percentField = document.getElementById('rent_percent')?.closest('.field');
  const minField = document.getElementById('withdrawal_min')?.closest('.field');
  const maxField = document.getElementById('withdrawal_max')?.closest('.field');
  
  if (eurField) {
    eurField.classList.toggle('field--disabled', !isEurMode);
    const input = eurField.querySelector('input');
    if (input) input.disabled = !isEurMode;
  }
  
  if (percentField) {
    percentField.classList.toggle('field--disabled', isEurMode);
    const input = percentField.querySelector('input');
    if (input) input.disabled = isEurMode;
  }
  
  if (minField) {
    minField.classList.toggle('field--disabled', isEurMode);
    const input = minField.querySelector('input');
    if (input) input.disabled = isEurMode;
  }
  
  if (maxField) {
    maxField.classList.toggle('field--disabled', isEurMode);
    const input = maxField.querySelector('input');
    if (input) input.disabled = isEurMode;
  }
}

/**
 * Aktualisiert Sparerpauschbetrag basierend auf Verheiratet-Status
 */
export function updateMarriedFields() {
  const isMarried = document.getElementById('is_married')?.checked ?? false;
  const pauschbetragInput = document.getElementById('sparerpauschbetrag');
  
  if (pauschbetragInput) {
    pauschbetragInput.value = isMarried ? SPARERPAUSCHBETRAG_VERHEIRATET : SPARERPAUSCHBETRAG_SINGLE;
    // Auch im Szenario aktualisieren
    updateScenario(getActiveScenarioId(), { 
      sparerpauschbetrag: isMarried ? SPARERPAUSCHBETRAG_VERHEIRATET : SPARERPAUSCHBETRAG_SINGLE 
    });
  }
}

/**
 * Aktualisiert Kapitalerhalt-bezogene Felder
 */
export function updateCapitalPreservationFields() {
  const enabled = document.getElementById('capital_preservation_enabled')?.checked ?? false;
  
  const fields = [
    'capital_preservation_threshold',
    'capital_preservation_reduction',
    'capital_preservation_recovery',
  ];
  
  for (const fieldId of fields) {
    const fieldEl = document.getElementById(fieldId)?.closest('.field');
    if (fieldEl) {
      fieldEl.classList.toggle('field--disabled', !enabled);
      const input = fieldEl.querySelector('input');
      if (input) input.disabled = !enabled;
    }
  }
}

/**
 * Aktualisiert UI-Modus (Simple/Expert)
 */
export function updateUiModeFields() {
  const mode = getUiMode();
  const isSimple = mode === UI_MODE_SIMPLE;
  
  for (const fieldId of EXPERT_ONLY_FIELDS) {
    const fieldEl = document.getElementById(fieldId)?.closest('.field');
    if (fieldEl) {
      fieldEl.style.display = isSimple ? 'none' : '';
    }
  }
  
  // Toggle-Button aktualisieren
  const modeBtn = document.getElementById('btn-mode-toggle');
  if (modeBtn) {
    modeBtn.textContent = isSimple ? 'Expertenmodus' : 'Einfacher Modus';
  }
}

// ============ SZENARIO-TABS ============

/**
 * Initialisiert Szenario-Tabs
 */
export function initScenarioTabs() {
  const tabContainer = document.getElementById('scenario-tabs');
  if (!tabContainer) return;
  
  // Tabs rendern
  renderScenarioTabs();
  
  // Event-Listener für Tab-Klicks
  tabContainer.addEventListener('click', (e) => {
    const tab = e.target.closest('.scenario-tab');
    if (!tab) return;
    
    const action = tab.dataset.action;
    const scenarioId = tab.dataset.scenario;
    
    if (action === 'select' && scenarioId) {
      setActiveScenario(scenarioId);
      renderScenarioTabs();
      writeScenarioToForm(getActiveScenario());
    } else if (action === 'add') {
      // Neues Szenario aus dem aktiven duplizieren
      const scenarios = getAllScenarios();
      const nextId = !scenarios.B ? 'B' : (!scenarios.C ? 'C' : null);
      if (nextId) {
        duplicateScenario(getActiveScenarioId(), nextId);
        setActiveScenario(nextId);
        renderScenarioTabs();
        writeScenarioToForm(getActiveScenario());
      }
    }
  });
}

/**
 * Rendert Szenario-Tabs
 */
function renderScenarioTabs() {
  const container = document.getElementById('scenario-tabs');
  if (!container) return;
  
  const scenarios = getAllScenarios();
  const activeId = getActiveScenarioId();
  
  let html = '';
  
  for (const id of ['A', 'B', 'C']) {
    const scenario = scenarios[id];
    if (!scenario) continue;
    
    const isActive = id === activeId;
    html += `
      <button class="scenario-tab ${isActive ? 'scenario-tab--active' : ''}" 
              data-action="select" data-scenario="${id}">
        ${scenario.name}
      </button>
    `;
  }
  
  // Add-Button nur wenn weniger als 3 Szenarien
  const count = Object.values(scenarios).filter(Boolean).length;
  if (count < 3) {
    html += `
      <button class="scenario-tab scenario-tab--add" data-action="add">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
    `;
  }
  
  container.innerHTML = html;
}

// getActiveScenarioId wird aus state.js importiert

// ============ PRESETS ============

/**
 * Initialisiert Preset-Buttons
 */
export function initPresetButtons() {
  const container = document.getElementById('preset-buttons');
  if (!container) return;
  
  let html = '';
  
  for (const [key, preset] of Object.entries(SCENARIO_PRESETS)) {
    html += `
      <button class="preset-btn" data-preset="${key}" title="${preset.description}">
        ${preset.name}
      </button>
    `;
  }
  
  container.innerHTML = html;
  
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.preset-btn');
    if (!btn) return;
    
    const presetKey = btn.dataset.preset;
    if (applyPreset(presetKey)) {
      writeScenarioToForm(getActiveScenario());
      showMessage(`Vorlage "${SCENARIO_PRESETS[presetKey].name}" angewendet.`);
    }
  });
}

// ============ STRESS-TEST ============

/**
 * Initialisiert Stress-Test-Dropdown
 */
export function initStressTestSelect() {
  const select = document.getElementById('stress_scenario');
  if (!select) return;
  
  let html = '';
  for (const [key, scenario] of Object.entries(STRESS_SCENARIOS)) {
    html += `<option value="${key}">${scenario.name}</option>`;
  }
  select.innerHTML = html;
}

// ============ WIZARD ============

const WIZARD_STEPS = [
  {
    id: 'age',
    title: 'Wie alt bist du?',
    description: 'Dein aktuelles Alter hilft uns, die passende Anlagedauer zu bestimmen.',
    field: { type: 'number', min: 18, max: 80, default: 30 },
  },
  {
    id: 'retirement_age',
    title: 'Wann möchtest du in Rente gehen?',
    description: 'Das Alter, ab dem du von deinem Vermögen leben möchtest.',
    field: { type: 'number', min: 40, max: 90, default: 65 },
  },
  {
    id: 'monthly_budget',
    title: 'Wie viel kannst du monatlich sparen?',
    description: 'Dein verfügbares Budget für Tagesgeld und ETF-Sparplan.',
    field: { type: 'number', min: 50, max: 10000, default: 500 },
  },
  {
    id: 'risk_level',
    title: 'Wie risikobereit bist du?',
    description: 'Beeinflusst die Aufteilung zwischen Tagesgeld und ETF.',
    field: {
      type: 'select',
      options: [
        { value: 'conservative', label: 'Konservativ (mehr Sicherheit)' },
        { value: 'balanced', label: 'Ausgewogen' },
        { value: 'aggressive', label: 'Offensiv (mehr Rendite)' },
      ],
      default: 'balanced',
    },
  },
  {
    id: 'existing_wealth',
    title: 'Hast du bereits Vermögen?',
    description: 'Vorhandenes Tagesgeld und ETF-Depot.',
    field: { type: 'number', min: 0, max: 10000000, default: 0 },
  },
];

let wizardState = {
  step: 0,
  answers: {},
};

/**
 * Startet den Wizard
 */
export function startWizard() {
  wizardState = { step: 0, answers: {} };
  showWizardStep(0);
}

/**
 * Zeigt einen Wizard-Schritt
 */
function showWizardStep(stepIndex) {
  const modal = document.getElementById('wizard-modal');
  if (!modal) return;
  
  const step = WIZARD_STEPS[stepIndex];
  if (!step) {
    finishWizard();
    return;
  }
  
  let fieldHtml = '';
  if (step.field.type === 'number') {
    fieldHtml = `
      <input type="number" id="wizard-input" 
             min="${step.field.min}" max="${step.field.max}" 
             value="${wizardState.answers[step.id] || step.field.default}">
    `;
  } else if (step.field.type === 'select') {
    fieldHtml = `<select id="wizard-input">`;
    for (const opt of step.field.options) {
      const selected = (wizardState.answers[step.id] || step.field.default) === opt.value ? 'selected' : '';
      fieldHtml += `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
    }
    fieldHtml += `</select>`;
  }
  
  modal.innerHTML = `
    <div class="wizard-content">
      <div class="wizard-progress">
        <span>Schritt ${stepIndex + 1} von ${WIZARD_STEPS.length}</span>
        <div class="wizard-progress-bar">
          <div class="wizard-progress-fill" style="width: ${((stepIndex + 1) / WIZARD_STEPS.length) * 100}%"></div>
        </div>
      </div>
      <h3>${step.title}</h3>
      <p>${step.description}</p>
      <div class="wizard-field">${fieldHtml}</div>
      <div class="wizard-actions">
        ${stepIndex > 0 ? '<button class="btn btn--secondary" id="wizard-back">Zurück</button>' : ''}
        <button class="btn btn--primary" id="wizard-next">
          ${stepIndex === WIZARD_STEPS.length - 1 ? 'Fertig' : 'Weiter'}
        </button>
      </div>
      <button class="wizard-close" id="wizard-close">&times;</button>
    </div>
  `;
  
  modal.classList.add('active');
  
  // Event-Listener
  document.getElementById('wizard-next')?.addEventListener('click', () => {
    const input = document.getElementById('wizard-input');
    wizardState.answers[step.id] = input?.value;
    wizardState.step = stepIndex + 1;
    showWizardStep(stepIndex + 1);
  });
  
  document.getElementById('wizard-back')?.addEventListener('click', () => {
    wizardState.step = stepIndex - 1;
    showWizardStep(stepIndex - 1);
  });
  
  document.getElementById('wizard-close')?.addEventListener('click', () => {
    modal.classList.remove('active');
  });
}

/**
 * Beendet den Wizard und wendet die Einstellungen an
 */
function finishWizard() {
  const modal = document.getElementById('wizard-modal');
  if (modal) modal.classList.remove('active');
  
  const answers = wizardState.answers;
  const age = parseInt(answers.age) || 30;
  const retirementAge = parseInt(answers.retirement_age) || 65;
  const monthlyBudget = parseInt(answers.monthly_budget) || 500;
  const riskLevel = answers.risk_level || 'balanced';
  const existingWealth = parseInt(answers.existing_wealth) || 0;
  
  // Berechne Einstellungen
  const savingsYears = Math.max(1, retirementAge - age);
  const withdrawalYears = Math.max(10, 95 - retirementAge);
  
  let tgRatio = 0.3;
  if (riskLevel === 'conservative') tgRatio = 0.5;
  else if (riskLevel === 'aggressive') tgRatio = 0.15;
  
  const monthlySavings = Math.round(monthlyBudget * tgRatio);
  const monthlyEtf = monthlyBudget - monthlySavings;
  
  const updates = {
    savings_years: savingsYears,
    withdrawal_years: withdrawalYears,
    monthly_savings: monthlySavings,
    monthly_etf: monthlyEtf,
    start_savings: Math.round(existingWealth * tgRatio),
    start_etf: Math.round(existingWealth * (1 - tgRatio)),
    savings_target: Math.max(5000, monthlySavings * 12 * 3),
  };
  
  updateScenario(getActiveScenarioId(), updates);
  writeScenarioToForm(getActiveScenario());
  showMessage('Wizard abgeschlossen! Einstellungen wurden übernommen.');
}

// ============ HELPERS ============

/**
 * Zeigt eine Nachricht an
 */
export function showMessage(text, type = 'info') {
  const el = document.getElementById('message');
  if (el) {
    el.textContent = text;
    el.className = `message message--${type}`;
    el.onclick = () => {
      el.textContent = '';
      el.className = 'message';
      el.onclick = null;
    };
  }
}

/**
 * Initialisiert Form-Event-Listener
 */
export function initFormListeners(onSimulate, onMonteCarlo) {
  const form = document.getElementById('sim-form');
  if (!form) return;
  
  // Form-Submit
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      readFormToScenario();
      onSimulate?.();
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });
  
  // Rent-Mode-Änderung
  const rentModeRadios = form.querySelectorAll('input[name="rent_mode"]');
  for (const radio of rentModeRadios) {
    radio.addEventListener('change', updateRentModeFields);
  }
  
  // Kapitalerhalt-Toggle
  const cpEnabled = document.getElementById('capital_preservation_enabled');
  cpEnabled?.addEventListener('change', updateCapitalPreservationFields);
  
  // Verheiratet-Toggle: Sparer-Pauschbetrag automatisch anpassen
  const marriedCheckbox = document.getElementById('is_married');
  marriedCheckbox?.addEventListener('change', updateMarriedFields);
  
  // Reset-Button
  document.getElementById('btn-reset')?.addEventListener('click', () => {
    resetScenario(getActiveScenarioId());
    writeScenarioToForm(getActiveScenario());
    showMessage('Standardwerte wiederhergestellt.');
  });
  
  // Monte-Carlo-Button
  document.getElementById('btn-monte-carlo')?.addEventListener('click', () => {
    try {
      readFormToScenario();
      onMonteCarlo?.();
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });
  
  // Mode-Toggle
  document.getElementById('btn-mode-toggle')?.addEventListener('click', () => {
    toggleUiMode();
    updateUiModeFields();
  });
  
  // Wizard-Button
  document.getElementById('btn-wizard')?.addEventListener('click', startWizard);
  
  // Initiale UI-Updates
  updateRentModeFields();
  updateCapitalPreservationFields();
  updateUiModeFields();
}

/**
 * Initialisiert das Formular mit gespeichertem Szenario
 */
export function initForm() {
  const scenario = getActiveScenario();
  if (scenario) {
    writeScenarioToForm(scenario);
  }
  
  initPresetButtons();
  initStressTestSelect();
  initScenarioTabs();
}
