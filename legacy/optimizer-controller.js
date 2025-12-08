/**
 * ETF Simulator - Optimizer Controller
 * Version 2.0
 * 
 * Steuert den Optimizer-Worker und bindet die Optimizer-UI
 */

import { getActiveScenario, scenarioToParams, scenarioToMcOptions, updateScenario, getActiveScenarioId } from './state.js';
import { readFormToScenario, writeScenarioToForm, showMessage } from './ui-form.js';
import { formatCurrency, formatPercent } from './ui-charts.js';

// ============ STATE ============

let worker = null;
let isOptimizing = false;
let abortRequested = false;

// ============ WORKER ============

/**
 * Erstellt Optimizer-Worker
 */
function createOptimizerWorker() {
  if (worker) {
    worker.terminate();
  }
  worker = new Worker('optimizer-worker.js');
  return worker;
}

/**
 * Beendet Worker
 */
function terminateWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

// ============ OPTIMIZATION ============

/**
 * Startet Optimierung
 * @param {string} mode - 'A' (Budget fix, Rente maximieren) oder 'B' (Rente fix, Budget minimieren)
 * @param {Object} gridConfig - Grid-Konfiguration
 * @returns {Promise<Object>} Optimierungsergebnis
 */
export function runOptimization(mode = 'A', gridConfig = {}) {
  return new Promise((resolve, reject) => {
    if (isOptimizing) {
      reject(new Error('Optimierung läuft bereits'));
      return;
    }
    
    isOptimizing = true;
    abortRequested = false;
    
    const scenario = readFormToScenario();
    const params = scenarioToParams(scenario);
    const mcOptions = scenarioToMcOptions(scenario);
    
    // Grid-Konfiguration mit Defaults
    const config = {
      maxBudget: (scenario.monthly_savings || 0) + (scenario.monthly_etf || 0),
      tgStep: gridConfig.tgStep || 50,
      rentStep: gridConfig.rentStep || 50,
      rentStepPercent: gridConfig.rentStepPercent || 0.25,
      rentRange: gridConfig.rentRange || 0.5,
      maxCombinations: gridConfig.maxCombinations || 60,
      targetSuccess: gridConfig.targetSuccess || 90,
      emergencyWeight: gridConfig.emergencyWeight || 4000,
      emergencyMaxYears: gridConfig.emergencyMaxYears || 10,
    };
    
    const seed = mcOptions.seed || Date.now();
    
    // Worker erstellen
    const w = createOptimizerWorker();
    
    w.onmessage = (e) => {
      const { type } = e.data;
      
      if (type === 'progress') {
        updateProgress(e.data.current, e.data.total, e.data.percent, e.data.currentCandidate);
      } else if (type === 'complete') {
        isOptimizing = false;
        terminateWorker();
        
        if (e.data.best) {
          resolve(e.data.best);
        } else {
          reject(new Error(e.data.message || 'Keine gültige Konfiguration gefunden'));
        }
      } else if (type === 'error') {
        isOptimizing = false;
        terminateWorker();
        reject(new Error(e.data.message));
      }
    };
    
    w.onerror = (err) => {
      isOptimizing = false;
      terminateWorker();
      reject(new Error(err.message || 'Worker-Fehler'));
    };
    
    // Optimierung starten
    w.postMessage({
      type: 'start',
      params,
      mcOptions: {
        iterations: Math.min(mcOptions.iterations, 1000), // Limit für Optimierung
        volatility: mcOptions.volatility,
        seed,
        successThreshold: mcOptions.successThreshold,
        ruinThresholdPercent: mcOptions.ruinThresholdPercent,
      },
      mode,
      gridConfig: config,
      seedBase: seed,
    });
  });
}

/**
 * Bricht Optimierung ab
 */
export function abortOptimization() {
  if (!isOptimizing) return;
  
  abortRequested = true;
  isOptimizing = false;
  terminateWorker();

  const progressEl = document.getElementById('optimization-progress');
  const barEl = document.getElementById('optimize-progress-bar');
  const textEl = document.getElementById('optimize-progress-text');
  if (progressEl) progressEl.style.display = 'none';
  if (barEl) barEl.value = 0;
  if (textEl) textEl.textContent = '';
}

/**
 * Prüft ob Optimierung läuft
 */
export function isOptimizationRunning() {
  return isOptimizing;
}

// ============ UI ============

/**
 * Aktualisiert Fortschrittsanzeige
 */
function updateProgress(current, total, percent, candidate) {
  const progressEl = document.getElementById('optimization-progress');
  const barEl = document.getElementById('optimize-progress-bar');
  const textEl = document.getElementById('optimize-progress-text');
  
  if (progressEl) progressEl.style.display = 'block';
  if (barEl) barEl.value = percent;
  if (textEl) {
    let text = `${current}/${total} (${percent}%)`;
    if (candidate) {
      if (candidate.rent_mode === 'percent' && candidate.monthly_payout_percent) {
        text += ` - TG: ${candidate.monthly_savings}€, ETF: ${candidate.monthly_etf}€, Entnahme: ${candidate.monthly_payout_percent}%`;
      } else {
        text += ` - TG: ${candidate.monthly_savings}€, ETF: ${candidate.monthly_etf}€, Rente: ${candidate.monthly_payout_net}€`;
      }
    }
    textEl.textContent = text;
  }
}

/**
 * Zeigt Optimierungsergebnis
 */
export function showOptimizationResult(result) {
  const resultPanel = document.getElementById('optimization-result-panel');
  const progressEl = document.getElementById('optimization-progress');
  const errorEl = document.getElementById('optimization-error');
  
  if (progressEl) progressEl.style.display = 'none';
  if (errorEl) errorEl.style.display = 'none';
  if (resultPanel) resultPanel.style.display = 'block';
  
  // Parameter
  setOptValue('opt-monthly-savings', formatCurrency(result.params.monthly_savings || 0));
  setOptValue('opt-monthly-etf', formatCurrency(result.params.monthly_etf || 0));
  
  if (result.params.rent_mode === 'percent' && result.params.monthly_payout_percent) {
    setOptValue('opt-rent-eur', `${result.params.monthly_payout_percent}% p.a.`);
  } else {
    setOptValue('opt-rent-eur', formatCurrency(result.params.monthly_payout_net || 0));
  }
  
  const totalBudget = (result.params.monthly_savings || 0) + (result.params.monthly_etf || 0);
  setOptValue('opt-total-budget', formatCurrency(totalBudget));
  
  // Kennzahlen
  setOptValue('opt-success-rate', formatPercent(result.results.successRate));
  setOptValue('opt-ruin-probability', formatPercent(result.results.ruinProbability));
  setOptValue('opt-median-end-real', formatCurrency(result.results.medianEndReal || 0));
  setOptValue('opt-retirement-median', formatCurrency(result.results.retirementMedian || 0));
  setOptValue('opt-capital-preservation', formatPercent(result.results.capitalPreservationRateReal || result.results.capitalPreservationRate));
  
  if (result.results.p10EndReal != null && result.results.p90EndReal != null) {
    setOptValue('opt-range-end', `${formatCurrency(result.results.p10EndReal)} – ${formatCurrency(result.results.p90EndReal)}`);
  }
  
  // Notgroschen
  setOptValue('opt-emergency-fill-prob', formatPercent(result.results.emergencyFillProbability || 0));
  if (result.results.emergencyMedianFillYears != null) {
    setOptValue('opt-emergency-fill-years', `${result.results.emergencyMedianFillYears.toFixed(1)} Jahre`);
  } else {
    setOptValue('opt-emergency-fill-years', '–');
  }
}

/**
 * Zeigt Optimierungsfehler
 */
export function showOptimizationError(message) {
  const resultPanel = document.getElementById('optimization-result-panel');
  const progressEl = document.getElementById('optimization-progress');
  const errorEl = document.getElementById('optimization-error');
  const errorText = document.getElementById('optimization-error-text');
  
  if (progressEl) progressEl.style.display = 'none';
  if (resultPanel) resultPanel.style.display = 'none';
  if (errorEl) errorEl.style.display = 'block';
  if (errorText) errorText.textContent = message;
}

/**
 * Setzt Optimierungs-Ergebniswert
 */
function setOptValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/**
 * Wendet Optimierungsergebnis auf aktives Szenario an
 */
export function applyOptimizationResult(result) {
  if (!result?.params) return;
  
  const updates = {
    monthly_savings: result.params.monthly_savings,
    monthly_etf: result.params.monthly_etf,
  };
  
  if (result.params.rent_mode === 'percent' && result.params.monthly_payout_percent) {
    updates.monthly_payout_percent = result.params.monthly_payout_percent;
    updates.rent_mode = 'percent';
  } else if (result.params.monthly_payout_net) {
    updates.monthly_payout_net = result.params.monthly_payout_net;
    updates.rent_mode = 'eur';
  }
  
  updateScenario(getActiveScenarioId(), updates);
  writeScenarioToForm(getActiveScenario());
  showMessage('Optimierte Werte übernommen.');
}

// ============ INIT ============

/**
 * Initialisiert Optimizer-UI
 */
export function initOptimizer(onMonteCarloRun) {
  const btnOptimize = document.getElementById('btn-optimize');
  const btnCancel = document.getElementById('btn-cancel-optimize');
  const btnApply = document.getElementById('btn-apply-optimization');
  const btnApplyAndRun = document.getElementById('btn-apply-and-run');
  const resultsContainer = document.getElementById('optimization-results');
  
  let lastResult = null;
  
  // Optimize-Button aktivieren wenn MC-Ergebnisse vorhanden
  // (In v2.0 kann Optimizer auch ohne vorherige MC-Simulation starten)
  if (btnOptimize) {
    btnOptimize.disabled = false;
    btnOptimize.title = 'Parameter optimieren';
    
    btnOptimize.addEventListener('click', async () => {
      if (isOptimizing) {
        abortOptimization();
        btnOptimize.textContent = 'Parameter optimieren';
        return;
      }
      
      btnOptimize.textContent = 'Abbrechen';
      if (resultsContainer) resultsContainer.style.display = 'block';
      
      const progressEl = document.getElementById('optimization-progress');
      const resultPanel = document.getElementById('optimization-result-panel');
      const errorEl = document.getElementById('optimization-error');
      
      if (progressEl) progressEl.style.display = 'block';
      if (resultPanel) resultPanel.style.display = 'none';
      if (errorEl) errorEl.style.display = 'none';
      
      try {
        const result = await runOptimization('A');
        lastResult = result;
        showOptimizationResult(result);
        showMessage('Optimierung abgeschlossen.', 'success');
      } catch (err) {
        showOptimizationError(err.message);
        showMessage(`Optimierung fehlgeschlagen: ${err.message}`, 'error');
      } finally {
        btnOptimize.textContent = 'Parameter optimieren';
      }
    });
  }
  
  // Cancel-Button
  if (btnCancel) {
    btnCancel.addEventListener('click', () => {
      abortOptimization();
      if (btnOptimize) btnOptimize.textContent = 'Parameter optimieren';
      showMessage('Optimierung abgebrochen.');
    });
  }
  
  // Apply-Button
  if (btnApply) {
    btnApply.addEventListener('click', () => {
      if (lastResult) {
        applyOptimizationResult(lastResult);
      }
    });
  }
  
  // Apply and Run MC
  if (btnApplyAndRun) {
    btnApplyAndRun.addEventListener('click', () => {
      if (lastResult) {
        applyOptimizationResult(lastResult);
        onMonteCarloRun?.();
      }
    });
  }
}
