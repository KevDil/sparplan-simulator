/**
 * ETF Sparplan & Entnahme Simulator
 * Version 2.0
 * 
 * Haupteinstiegspunkt - initialisiert alle Module
 */

import { initState, getActiveScenario, getActiveScenarioId, getTheme, setTheme, addListener, scenarioToParams, scenarioToMcOptions, setResults, setMcResults, getMcResults, loadFromShareUrl, getAllScenarios } from './state.js';
import { initForm, initFormListeners, writeScenarioToForm, readFormToScenario, showMessage, updateUiModeFields } from './ui-form.js';
import { drawStandardChart, drawMonteCarloChart, drawComparisonChart, initChartTooltips, updateRiskWidget, formatCurrency, formatPercent } from './ui-charts.js';
import { simulate, analyzeHistory } from './simulation-core.js';
import { runMonteCarloSimulation, abortSimulation, isSimulationRunning } from './mc-controller.js';
import { initOptimizer } from './optimizer-controller.js';
import { exportStandardToCsv, exportYearlyToCsv, exportMonteCarloToCsv, openHtmlReportForPrint } from './export.js';
import { generateMcSummaryText } from './mc-analysis.js';

// ============ STATE ============

let currentHistory = null;
let currentMcResults = null;
let standardChartLogScale = false;
let mcChartLogScale = true;
let mcChartShowReal = false;

// ============ SIMULATION ============

/**
 * Führt Standard-Simulation durch
 */
function runSimulation() {
  const scenario = readFormToScenario();
  const params = scenarioToParams(scenario);
  const activeId = getActiveScenarioId();
  const stressScenario = scenario.stress_scenario || 'none';
  
  try {
    const history = simulate(params, 0, { stressScenario });
    currentHistory = history;
    setResults(activeId, history);
    
    // UI aktualisieren
    drawStandardChart(history, { logScale: standardChartLogScale });
    updateStandardStats(history, params);
    updateYearlyTable(history);
    
    showMessage('Simulation abgeschlossen.', 'success');
    
    // Zum Ergebnis-Tab wechseln
    switchTab('standard');
    
  } catch (err) {
    console.error('Simulation error:', err);
    showMessage(`Fehler: ${err.message}`, 'error');
  }
}

/**
 * Führt Monte-Carlo-Simulation durch
 */
async function runMonteCarlo() {
  if (isSimulationRunning()) {
    abortSimulation();
    updateMcButton(false);
    return;
  }
  
  const scenario = readFormToScenario();
  const params = scenarioToParams(scenario);
  const mcOptions = scenarioToMcOptions(scenario);
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  const workerCount = Math.min(Math.max(2, cores - 1), 8);
  const etaTracker = createEtaTracker({ minSamples: 3, minElapsedMs: 1500, alpha: 0.3 });
  let etaStarted = false;
  
  // UI für laufende Simulation
  updateMcButton(true);
  showMcProgress(0);
  showMessage('Monte-Carlo-Simulation läuft...', 'info');
  // Direkt zum Monte-Carlo-Tab wechseln und Ergebnisbereich für Fortschritt anzeigen
  switchTab('monte-carlo');
  showMcResults();
  // Nach oben scrollen, damit Erfolgs-Widget und Progress sichtbar sind
  window.scrollTo({ top: 0, behavior: 'smooth' });
  
  try {
    const results = await runMonteCarloSimulation(params, {
      iterations: mcOptions.iterations,
      volatility: mcOptions.volatility,
      seed: mcOptions.seed,
      successThreshold: mcOptions.successThreshold,
      ruinThresholdPercent: mcOptions.ruinThresholdPercent,
    }, (progress) => {
      if (!progress) {
        return;
      }
      if (!etaStarted && typeof progress.total === 'number' && progress.total > 0) {
        etaTracker.start(progress.total);
        etaStarted = true;
      }
      if (etaStarted && typeof progress.current === 'number') {
        etaTracker.update(progress.current);
      }
      showMcProgress(progress.percent);
      const textEl = document.getElementById('mc-progress-text');
      if (textEl && typeof progress.current === 'number' && typeof progress.total === 'number') {
        const eta = etaTracker.getEta();
        const etaText = eta && eta.formatted ? `, ETA ${eta.formatted}` : '';
        const pct = Math.round(progress.percent || 0);
        textEl.textContent = `${progress.current} / ${progress.total} (${pct}%) - ${workerCount} Worker${etaText}`;
      }
    });
    
    currentMcResults = results;
    setMcResults(getActiveScenarioId(), results);
    
    // UI aktualisieren
    const showPaths = document.getElementById('mc_show_individual')?.checked ?? false;
    const activeScenario = getActiveScenario();
    drawMonteCarloChart(results, {
      showReal: mcChartShowReal,
      logScale: mcChartLogScale,
      showIndividualPaths: showPaths,
      savingsYears: activeScenario?.savings_years,
    });
    updateMcStats(results, params);
    updateRiskWidget(currentHistory, results);
    
    showMessage(`Monte-Carlo abgeschlossen: ${results.iterations} Simulationen`, 'success');
    
    // Zum MC-Tab wechseln
    switchTab('monte-carlo');
    showMcResults();
    
  } catch (err) {
    console.error('MC error:', err);
    showMessage(`Monte-Carlo Fehler: ${err.message}`, 'error');
  } finally {
    etaTracker.stop();
    updateMcButton(false);
    hideMcProgress();
  }
}

// ============ UI UPDATES ============

/**
 * Aktualisiert Standard-Statistiken
 */
function updateStandardStats(history, params) {
  if (!history?.length) return;
  
  const analysis = analyzeHistory(history, params);
  const lastRow = history[history.length - 1];
  const savingsMonths = params.savings_years * 12;
  const retirementRow = history[Math.min(savingsMonths - 1, history.length - 1)];
  
  // Stat-Cards aktualisieren (HTML-IDs: stat-end-nominal, stat-retirement-wealth-nominal, etc.)
  setStatValue('stat-end-nominal', formatCurrency(lastRow.total));
  setStatValue('stat-end-real', formatCurrency(lastRow.total_real));
  setStatValue('stat-retirement-wealth-nominal', formatCurrency(retirementRow?.total || 0));
  setStatValue('stat-total-invested', formatCurrency(analysis.totalInvested));
  setStatValue('stat-total-return', formatCurrency(analysis.totalReturn));
  setStatValue('stat-total-tax', formatCurrency(analysis.totalTax));
  
  if (analysis.avgWithdrawal > 0) {
    setStatValue('stat-avg-withdrawal', formatCurrency(analysis.avgWithdrawal));
    setStatValue('stat-total-withdrawals', formatCurrency(analysis.totalWithdrawals));
  }
  
  // Shortfall-Warnung
  if (analysis.hasShortfall) {
    showMessage(`Warnung: In ${analysis.shortfallMonths} Monaten konnte die gewünschte Entnahme nicht vollständig bedient werden.`, 'warning');
  }
}

/**
 * Aktualisiert Monte-Carlo-Statistiken
 */
function updateMcStats(results, params = null) {
  if (!results) return;
  
  // Textuelle Zusammenfassung
  if (params) {
    const summaryText = generateMcSummaryText(results, params);
    const summaryEl = document.getElementById('mc-summary-text');
    if (summaryEl) {
      summaryEl.innerHTML = summaryText;
    }
  }
  
  // Erfolgswahrscheinlichkeit (Highlight-Box)
  const successRate = results.successRate || 0;
  const softSuccessRate = results.softSuccessRate ?? successRate;

  setStatValue('mc-success-rate', formatPercent(successRate));
  setStatValue('mc-success-rate-soft', formatPercent(softSuccessRate));

  const successRateEl = document.getElementById('mc-success-rate');
  const softSuccessRateEl = document.getElementById('mc-success-rate-soft');

  const applySuccessClass = (el, rate) => {
    if (!el) return;
    el.classList.remove('success-high', 'success-medium', 'success-low');
    if (rate >= 95) {
      el.classList.add('success-high');
    } else if (rate >= 80) {
      el.classList.add('success-medium');
    } else {
      el.classList.add('success-low');
    }
  };

  applySuccessClass(successRateEl, successRate);
  applySuccessClass(softSuccessRateEl, softSuccessRate);

  const iterationsEl = document.getElementById('mc-iterations-done');
  if (iterationsEl) iterationsEl.textContent = results.iterations;
  
  // Endvermögen
  setStatValue('mc-median-end', formatCurrency(results.medianEnd));
  setStatValue('mc-range-end', `${formatCurrency(results.p10End)} – ${formatCurrency(results.p90End)}`);
  setStatValue('mc-worst-case', formatCurrency(results.p25End));
  setStatValue('mc-best-case', formatCurrency(results.p75End));
  setStatValue('mc-mean-end', formatCurrency(results.meanEnd || results.medianEnd));
  
  // Endvermögen (real)
  setStatValue('mc-median-end-real', formatCurrency(results.medianEndReal));
  setStatValue('mc-range-end-real', `${formatCurrency(results.p10EndReal || results.p10End)} – ${formatCurrency(results.p90EndReal || results.p90End)}`);
  setStatValue('mc-worst-case-real', formatCurrency(results.p25EndReal || results.p25End));
  setStatValue('mc-best-case-real', formatCurrency(results.p75EndReal || results.p75End));
  
  // Entnahmen
  const avgMonthlyWithdrawal = results.medianAvgWithdrawalNet
    ?? results.medianAvgWithdrawalNetReal
    ?? 0;
  const totalWithdrawals = (results.medianTotalWithdrawalNet
    ?? results.medianTotalWithdrawalGross
    ?? 0);

  setStatValue('mc-avg-monthly-withdrawal', formatCurrency(avgMonthlyWithdrawal));
  setStatValue('mc-total-withdrawals', formatCurrency(totalWithdrawals));
  setStatValue('mc-retirement-wealth', formatCurrency(results.retirementMedian || 0));
  
  // Risikokennzahlen
  setStatValue('mc-capital-preservation', formatPercent(results.capitalPreservationRate));
  setStatValue('mc-ruin-probability', formatPercent(results.ruinProbability));
  const shortfallRate = results.entnahmeShortfallRate
    ?? results.ansparShortfallRate
    ?? 0;
  setStatValue('mc-shortfall-rate', formatPercent(shortfallRate));
  setStatValue('mc-ruin-probability-real', formatPercent(results.ruinProbability));
  setStatValue('mc-capital-preservation-real', formatPercent(results.capitalPreservationRateReal || results.capitalPreservationRate));
  
  // Notgroschen
  setStatValue('mc-emergency-fill-prob', formatPercent(results.emergencyFillProbability || 0));
  setStatValue('mc-emergency-fill-years', results.emergencyMedianFillYears !== null ? `${results.emergencyMedianFillYears.toFixed(1)} Jahre` : '–');

  // MC real (inflationsbereinigt) Entnahmen & Rente
  const avgMonthlyWithdrawalReal = results.medianAvgWithdrawalNetReal
    ?? results.medianAvgWithdrawalGrossReal
    ?? 0;
  const totalWithdrawalsReal = results.medianTotalWithdrawalNetReal
    ?? results.medianTotalWithdrawalGrossReal
    ?? 0;
  const retirementWealthReal = results.retirementMedianReal ?? 0;
  const purchasingPowerLoss = Math.max(0, (results.medianEnd || 0) - (results.medianEndReal || 0));

  setStatValue('mc-avg-monthly-withdrawal-real', formatCurrency(avgMonthlyWithdrawalReal));
  setStatValue('mc-total-withdrawals-real', formatCurrency(totalWithdrawalsReal));
  setStatValue('mc-retirement-wealth-real', formatCurrency(retirementWealthReal));
  setStatValue('mc-purchasing-power-loss', formatCurrency(purchasingPowerLoss));
  
  // SoRR
  if (results.sorr) {
    const explEl = document.getElementById('mc-sorr-explanation-text');
    if (explEl) {
      const windowYears = results.sorr.vulnerabilityWindow || 5;
      explEl.textContent = `Die SoRR-Auswertung betrachtet die ersten ${windowYears} Jahre der Entnahmephase und vergleicht frühe Crash- vs. Boom-Szenarien. Hohe Werte bedeuten, dass die Reihenfolge der Renditen einen starken Einfluss auf das Endvermögen hat.`;
    }

    setStatValue('mc-sorr-score', formatPercent(results.sorr.sorRiskScore || 0));
    setStatValue('mc-sorr-correlation', formatPercent(Math.abs(results.sorr.correlationEarlyReturns || 0) * 100));
    setStatValue('mc-sorr-early-bad', formatCurrency(results.sorr.worstSequenceEnd || 0));
    setStatValue('mc-sorr-early-good', formatCurrency(results.sorr.bestSequenceEnd || 0));
    setStatValue('mc-sorr-worst-seq', formatCurrency(results.sorr.worstSequenceEnd || 0));
    setStatValue('mc-sorr-best-seq', formatCurrency(results.sorr.bestSequenceEnd || 0));
    setStatValue('mc-sorr-vulnerability', results.sorr.vulnerabilityWindow || 'Jahr 1–5');
  }
}

/**
 * Aktualisiert Jahresübersicht
 */
function updateYearlyTable(history) {
  const tbody = document.querySelector('#year-table tbody');
  if (!tbody || !history?.length) return;
  
  // Nach Jahren gruppieren
  const years = {};
  for (const row of history) {
    if (!years[row.year]) {
      years[row.year] = {
        year: row.year,
        phase: row.phase,
        savings: 0,
        etf: 0,
        total: 0,
        total_real: 0,
        deposits: 0,
        withdrawals: 0,
        taxes: 0,
      };
    }
    const y = years[row.year];
    y.savings = row.savings;
    y.etf = row.etf;
    y.total = row.total;
    y.total_real = row.total_real;
    y.deposits += (row.savings_contrib || 0) + (row.etf_contrib || 0);
    y.withdrawals += row.withdrawal || 0;
    y.taxes += row.tax_paid || 0;
    y.phase = row.phase;
  }
  
  let html = '';
  for (const y of Object.values(years)) {
    html += `
      <tr>
        <td>${y.year}</td>
        <td><span class="phase-badge phase-badge--${y.phase.toLowerCase()}">${y.phase}</span></td>
        <td>${formatCurrency(y.savings)}</td>
        <td>${formatCurrency(y.etf)}</td>
        <td>${formatCurrency(y.total)}</td>
        <td>${formatCurrency(y.total_real)}</td>
        <td>${formatCurrency(y.deposits)}</td>
        <td>${formatCurrency(y.withdrawals)}</td>
        <td>${formatCurrency(y.taxes)}</td>
      </tr>
    `;
  }
  
  tbody.innerHTML = html;
}

/**
 * Setzt Stat-Card-Wert
 */
function setStatValue(id, value) {
  const el = document.getElementById(id);
  if (el) {
    const valueEl = el.querySelector('.stat-value') || el;
    valueEl.textContent = value;
  }
}

/**
 * MC-Button-Status
 */
function updateMcButton(isRunning) {
  const btn = document.getElementById('btn-monte-carlo');
  if (btn) {
    btn.textContent = isRunning ? 'Abbrechen' : 'Monte-Carlo starten';
    btn.classList.toggle('btn--danger', isRunning);
  }
}

/**
 * MC-Fortschritt anzeigen
 */
function showMcProgress(percent) {
  const bar = document.getElementById('mc-progress-bar');
  const progressEl = document.getElementById('mc-progress');
  const text = document.getElementById('mc-progress-text');
  
  if (bar) bar.style.display = 'block';
  if (progressEl) progressEl.value = percent;
  if (text) text.textContent = `${Math.round(percent)}%`;
}

function hideMcProgress() {
  const bar = document.getElementById('mc-progress-bar');
  const progressEl = document.getElementById('mc-progress');
  const text = document.getElementById('mc-progress-text');
  if (bar) bar.style.display = 'none';
  if (progressEl) progressEl.value = 0;
  if (text) text.textContent = '';
}

/**
 * MC-Ergebnisse anzeigen
 */
function showMcResults() {
  const empty = document.getElementById('mc-empty-state');
  const results = document.getElementById('mc-results');
  
  if (empty) empty.style.display = 'none';
  if (results) results.style.display = 'block';
}

function createEtaTracker(options) {
  const minSamples = options && typeof options.minSamples === 'number' ? options.minSamples : 3;
  const minElapsedMs = options && typeof options.minElapsedMs === 'number' ? options.minElapsedMs : 1500;
  const alpha = options && typeof options.alpha === 'number' ? options.alpha : 0.3;
  let totalWork = 0;
  let startTime = 0;
  let lastUpdateTime = 0;
  let lastCompleted = 0;
  let smoothedThroughput = 0;
  let sampleCount = 0;
  let stopped = false;

  function now() {
    return Date.now();
  }

  function formatEta(etaSeconds) {
    if (!isFinite(etaSeconds) || etaSeconds < 0) return '';
    if (etaSeconds < 1) return '< 1 s';
    if (etaSeconds < 60) {
      return String(Math.round(etaSeconds)) + ' s';
    }
    const minutes = Math.floor(etaSeconds / 60);
    const seconds = Math.round(etaSeconds % 60);
    if (minutes < 60) {
      const mm = String(minutes);
      const ss = String(seconds).padStart(2, '0');
      return mm + ':' + ss + ' min';
    }
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    const mm = String(remMinutes).padStart(2, '0');
    return String(hours) + ':' + mm + ' h';
  }

  return {
    start(total) {
      totalWork = typeof total === 'number' ? total : 0;
      startTime = now();
      lastUpdateTime = startTime;
      lastCompleted = 0;
      smoothedThroughput = 0;
      sampleCount = 0;
      stopped = false;
    },
    update(completed) {
      if (stopped) return;
      const t = now();
      if (!startTime) {
        startTime = t;
        lastUpdateTime = t;
      }
      const deltaCompleted = completed - lastCompleted;
      const deltaTime = t - lastUpdateTime;
      if (deltaCompleted <= 0 || deltaTime < 200) {
        lastCompleted = completed;
        lastUpdateTime = t;
        return;
      }
      const instantThroughput = deltaCompleted / (deltaTime / 1000);
      if (smoothedThroughput === 0) {
        smoothedThroughput = instantThroughput;
      } else {
        smoothedThroughput = alpha * instantThroughput + (1 - alpha) * smoothedThroughput;
      }
      lastCompleted = completed;
      lastUpdateTime = t;
      sampleCount += 1;
    },
    getEta() {
      if (stopped || !startTime || totalWork <= 0 || smoothedThroughput <= 0) {
        return { seconds: null, formatted: '' };
      }
      const elapsed = now() - startTime;
      if (sampleCount < minSamples || elapsed < minElapsedMs) {
        return { seconds: null, formatted: '' };
      }
      const remaining = Math.max(0, totalWork - lastCompleted);
      if (remaining <= 0) {
        return { seconds: 0, formatted: '< 1 s' };
      }
      const etaSeconds = remaining / smoothedThroughput;
      return { seconds: etaSeconds, formatted: formatEta(etaSeconds) };
    },
    stop() {
      stopped = true;
    },
  };
}

// ============ TABS ============

/**
 * Wechselt Tab
 */
function switchTab(tabId) {
  const tabs = document.querySelectorAll('.tab');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach((t) => {
    const isActive = t.dataset.tab === tabId;
    t.classList.toggle('tab--active', isActive);
    if (isActive) {
      t.setAttribute('aria-selected', 'true');
    } else {
      t.setAttribute('aria-selected', 'false');
    }
  });

  contents.forEach((c) => {
    const isActive = c.id === `tab-${tabId}`;
    c.classList.toggle('tab-content--active', isActive);
  });
}

/**
 * Initialisiert Tabs
 */
function initTabs() {
  const tabContainer = document.querySelector('.tabs');
  if (!tabContainer) return;
  
  tabContainer.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) {
      switchTab(tab.dataset.tab);
    }
  });
}

// ============ THEME ============

/**
 * Wendet Theme an
 */
function applyTheme(theme) {
  document.body.classList.toggle('theme-light', theme === 'light');
  
  const icon = document.getElementById('theme-icon');
  if (icon) {
    icon.textContent = theme === 'light' ? '🌙' : '☀️';
  }
}

/**
 * Initialisiert Theme-Toggle
 */
function initThemeToggle() {
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      const current = getTheme();
      const newTheme = current === 'dark' ? 'light' : 'dark';
      setTheme(newTheme);
      applyTheme(newTheme);
    });
  }
  
  // Initiales Theme anwenden
  applyTheme(getTheme());
}

// ============ EXPORT ============

/**
 * Initialisiert Export-Buttons
 */
function initExportButtons() {
  // Export-Dropdown Toggle
  const exportToggle = document.getElementById('btn-export-toggle');
  const exportMenu = document.getElementById('export-menu');
  
  if (exportToggle && exportMenu) {
    exportToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMenu.classList.toggle('active');
    });
    
    // Schließen bei Klick außerhalb
    document.addEventListener('click', () => {
      exportMenu.classList.remove('active');
    });
  }
  
  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    try {
      exportStandardToCsv(currentHistory, getActiveScenario());
      showMessage('CSV exportiert.', 'success');
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });
  
  document.getElementById('btn-export-yearly-csv')?.addEventListener('click', () => {
    try {
      exportYearlyToCsv(currentHistory, getActiveScenario());
      showMessage('Jahresübersicht exportiert.', 'success');
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });
  
  document.getElementById('btn-export-mc-csv')?.addEventListener('click', () => {
    try {
      exportMonteCarloToCsv(currentMcResults, getActiveScenario());
      showMessage('Monte-Carlo CSV exportiert.', 'success');
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });
  
  document.getElementById('btn-export-pdf')?.addEventListener('click', () => {
    try {
      openHtmlReportForPrint(currentHistory, currentMcResults, getActiveScenario());
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });
  
  document.getElementById('btn-export-mc-pdf')?.addEventListener('click', () => {
    try {
      openHtmlReportForPrint(currentHistory, currentMcResults, getActiveScenario());
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });
}

// ============ MODALS ============

/**
 * Initialisiert Modale
 */
function initModals() {
  // Info-Modal
  document.getElementById('btn-info')?.addEventListener('click', () => {
    document.getElementById('info-modal')?.classList.add('active');
  });
  
  // Formel-Modal
  document.getElementById('btn-formula')?.addEventListener('click', () => {
    document.getElementById('formula-modal')?.classList.add('active');
  });
  
  // Modal schließen
  document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
    el.addEventListener('click', (e) => {
      // Für Close-Buttons: umgebende Overlay finden
      let overlay = null;
      if (el.classList.contains('modal-close')) {
        overlay = el.closest('.modal-overlay');
      } else if (el.classList.contains('modal-overlay') && e.target === el) {
        overlay = el;
      }
      if (overlay) {
        overlay.classList.remove('active');
      }
    });
  });
  
  // ESC zum Schließen
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    }
  });
}

// ============ RESPONSIVE ============

/**
 * Initialisiert Responsive-Handling
 */
function initResponsive() {
  // Canvas-Resize
  const resizeObserver = new ResizeObserver(() => {
    if (currentHistory) {
      drawStandardChart(currentHistory, { logScale: standardChartLogScale });
    }
    if (currentMcResults) {
      const showPaths = document.getElementById('mc_show_individual')?.checked ?? false;
      drawMonteCarloChart(currentMcResults, {
        showReal: mcChartShowReal,
        logScale: mcChartLogScale,
        showIndividualPaths: showPaths,
      });
    }
  });
  
  const graphCanvas = document.getElementById('graph');
  const mcCanvas = document.getElementById('mc-graph');
  
  if (graphCanvas) resizeObserver.observe(graphCanvas.parentElement);
  if (mcCanvas) resizeObserver.observe(mcCanvas.parentElement);
}

// ============ KEYBOARD SHORTCUTS ============

/**
 * Initialisiert Tastaturkürzel
 */
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+Enter: Simulation starten
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      runSimulation();
    }
    
    // Ctrl+M: Monte-Carlo
    if (e.ctrlKey && e.key === 'm') {
      e.preventDefault();
      runMonteCarlo();
    }
    
    // Ctrl+S: CSV Export
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      if (currentHistory) {
        exportStandardToCsv(currentHistory, getActiveScenario());
      }
    }
  });
}

// ============ MC CHART OPTIONS ============

/**
 * Initialisiert MC-Chart-Optionen
 */
function initMcChartOptions() {
  const stdLogBtn = document.getElementById('btn-std-log');
  const stdLinearBtn = document.getElementById('btn-std-linear');

  function updateStandardChartScale(isLog) {
    standardChartLogScale = isLog;
    stdLogBtn?.classList.toggle('btn-scale--active', isLog);
    stdLinearBtn?.classList.toggle('btn-scale--active', !isLog);
    if (currentHistory) {
      drawStandardChart(currentHistory, { logScale: standardChartLogScale });
    }
  }

  stdLogBtn?.addEventListener('click', () => updateStandardChartScale(true));
  stdLinearBtn?.addEventListener('click', () => updateStandardChartScale(false));

  const statsNominalBtn = document.getElementById('btn-stats-nominal');
  const statsRealBtn = document.getElementById('btn-stats-real');
  const statsNominalSection = document.getElementById('stats-section-nominal');
  const statsRealSection = document.getElementById('stats-section-real');

  statsNominalBtn?.addEventListener('click', () => {
    statsNominalBtn.classList.add('stats-toggle-btn--active');
    statsRealBtn?.classList.remove('stats-toggle-btn--active');
    statsNominalSection?.classList.remove('stats-section--hidden');
    statsRealSection?.classList.add('stats-section--hidden');
  });

  statsRealBtn?.addEventListener('click', () => {
    statsRealBtn.classList.add('stats-toggle-btn--active');
    statsNominalBtn?.classList.remove('stats-toggle-btn--active');
    statsRealSection?.classList.remove('stats-section--hidden');
    statsNominalSection?.classList.add('stats-section--hidden');
  });

  const mcLogBtn = document.getElementById('btn-mc-log');
  const mcLinearBtn = document.getElementById('btn-mc-linear');

  function updateMcChartScale(isLog) {
    mcChartLogScale = isLog;
    mcLogBtn?.classList.toggle('btn-scale--active', isLog);
    mcLinearBtn?.classList.toggle('btn-scale--active', !isLog);
    if (currentMcResults) {
      const showPaths = document.getElementById('mc_show_individual')?.checked ?? false;
      drawMonteCarloChart(currentMcResults, {
        showReal: mcChartShowReal,
        logScale: mcChartLogScale,
        showIndividualPaths: showPaths,
      });
    }
  }

  mcLogBtn?.addEventListener('click', () => updateMcChartScale(true));
  mcLinearBtn?.addEventListener('click', () => updateMcChartScale(false));

  const mcStatsNominalBtn = document.getElementById('btn-mc-stats-nominal');
  const mcStatsRealBtn = document.getElementById('btn-mc-stats-real');
  const mcStatsNominalSection = document.getElementById('mc-stats-section-nominal');
  const mcStatsRealSection = document.getElementById('mc-stats-section-real');

  mcStatsNominalBtn?.addEventListener('click', () => {
    mcChartShowReal = false;
    mcStatsNominalBtn.classList.add('stats-toggle-btn--active');
    mcStatsRealBtn?.classList.remove('stats-toggle-btn--active');
    mcStatsNominalSection?.classList.remove('stats-section--hidden');
    mcStatsRealSection?.classList.add('stats-section--hidden');
    if (currentMcResults) {
      const showPaths = document.getElementById('mc_show_individual')?.checked ?? false;
      drawMonteCarloChart(currentMcResults, {
        showReal: mcChartShowReal,
        logScale: mcChartLogScale,
        showIndividualPaths: showPaths,
      });
    }
  });

  mcStatsRealBtn?.addEventListener('click', () => {
    mcChartShowReal = true;
    mcStatsRealBtn.classList.add('stats-toggle-btn--active');
    mcStatsNominalBtn?.classList.remove('stats-toggle-btn--active');
    mcStatsRealSection?.classList.remove('stats-section--hidden');
    mcStatsNominalSection?.classList.add('stats-section--hidden');
    if (currentMcResults) {
      const showPaths = document.getElementById('mc_show_individual')?.checked ?? false;
      drawMonteCarloChart(currentMcResults, {
        showReal: mcChartShowReal,
        logScale: mcChartLogScale,
        showIndividualPaths: showPaths,
      });
    }
  });

  const mcShowPathsCheckbox = document.getElementById('mc_show_individual');
  mcShowPathsCheckbox?.addEventListener('change', () => {
    if (!currentMcResults) return;
    const showPaths = mcShowPathsCheckbox.checked;
    drawMonteCarloChart(currentMcResults, {
      showReal: mcChartShowReal,
      logScale: mcChartLogScale,
      showIndividualPaths: showPaths,
    });
  });
}

// ============ INIT ============

/**
 * Hauptinitialisierung
 */
function init() {
  console.log('ETF Simulator v2.0 initializing...');
  
  // State initialisieren
  initState();
  
  // Share-URL prüfen
  loadFromShareUrl();
  
  // UI initialisieren
  initForm();
  initFormListeners(runSimulation, runMonteCarlo);
  initTabs();
  initThemeToggle();
  initExportButtons();
  initModals();
  initChartTooltips();
  initResponsive();
  initKeyboardShortcuts();
  initMcChartOptions();
  initOptimizer(runMonteCarlo);
  
  // State-Listener
  addListener((event, data) => {
    if (event === 'themeChanged') {
      applyTheme(data.theme);
    } else if (event === 'activeScenarioChanged') {
      const scenario = getActiveScenario();
      writeScenarioToForm(scenario);
      
      // Gespeicherte Ergebnisse für dieses Szenario laden
      const results = getMcResults(data.id);
      if (results) {
        currentMcResults = results;
        const showPaths = document.getElementById('mc_show_individual')?.checked ?? false;
        drawMonteCarloChart(results, {
          showReal: mcChartShowReal,
          logScale: mcChartLogScale,
          showIndividualPaths: showPaths,
        });
        updateMcStats(results);
      }
    }
  });
  
  // Initiale Simulation
  setTimeout(() => {
    try {
      runSimulation();
    } catch (e) {
      console.error('Initial simulation failed:', e);
    }
  }, 100);
  
  console.log('ETF Simulator v2.0 ready.');
}

// DOM Ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Globale Exports für Debug
window.ETFSimulator = {
  runSimulation,
  runMonteCarlo,
  getActiveScenario,
  simulate,
};
