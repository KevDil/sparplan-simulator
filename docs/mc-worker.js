/**
 * ETF Sparplan Simulator - Monte-Carlo Web Worker
 * 
 * Führt Monte-Carlo-Simulationen im Hintergrund durch.
 * Unterstützt sowohl Einzel-Worker als auch Pool-Modus (Chunk-basiert).
 * 
 * MESSAGE PROTOKOLL:
 * 
 * LEGACY (Einzel-Worker, vollständige Analyse):
 * - Main → Worker: { type: 'start', params, iterations, volatility, mcOptions }
 * - Worker → Main: { type: 'progress', current, total, percent }
 * - Worker → Main: { type: 'complete', results }
 * 
 * POOL-MODUS (Chunk-basiert, Rohdaten-Rückgabe):
 * - Main → Worker: { type: 'run-chunk', params, volatility, mcOptions, 
 *                    startIdx, count, totalIterations, workerId, baseSeed }
 * - Worker → Main: { type: 'chunk-progress', workerId, currentGlobal, totalIterations }
 * - Worker → Main: { type: 'chunk-complete', workerId, rawData, samplePaths }
 * 
 * - Worker → Main: { type: 'error', message }
 */

// Importiere Simulationskern
importScripts('simulation-core.js');

// ============ KONSTANTEN ============

const PROGRESS_THROTTLE_MS = 100; // Max 10 Progress-Updates pro Sekunde
const MAX_SAMPLE_PATHS = 10;      // Sample-Pfade pro Worker für UI

// ============ MONTE-CARLO SIMULATION (LEGACY) ============

/**
 * Führt Monte-Carlo-Simulation durch (Legacy-Modus, vollständige Analyse)
 */
function runMonteCarloSimulationWorker(params, iterations, volatility, mcOptions = {}) {
  const allHistories = [];
  const batchSize = 50;
  
  // Seeded RNG falls angegeben
  if (mcOptions.seed != null) {
    currentRng = createSeededRandom(mcOptions.seed);
  } else {
    currentRng = createSeededRandom(Date.now() + Math.random() * 1000000);
  }
  
  for (let i = 0; i < iterations; i += batchSize) {
    const batchEnd = Math.min(i + batchSize, iterations);
    
    for (let j = i; j < batchEnd; j++) {
      const history = simulate(params, volatility);
      allHistories.push(history);
    }
    
    const progress = Math.round((batchEnd / iterations) * 100);
    self.postMessage({
      type: 'progress',
      current: batchEnd,
      total: iterations,
      percent: progress
    });
  }
  
  const results = analyzeMonteCarloResults(allHistories, params, mcOptions);
  results.volatility = volatility;
  results.allHistories = allHistories.slice(0, 50);
  results.mcOptions = mcOptions;
  
  return results;
}

// ============ CHUNK-BASIERTE SIMULATION (POOL-MODUS) ============

/**
 * Führt einen Chunk der Monte-Carlo-Simulation durch.
 * Gibt Rohdaten zurück, die im Main-Thread aggregiert werden.
 * 
 * @param {Object} params - Simulationsparameter
 * @param {number} volatility - Volatilität
 * @param {Object} mcOptions - MC-Optionen
 * @param {number} startIdx - Globaler Start-Index dieses Chunks
 * @param {number} count - Anzahl Iterationen in diesem Chunk
 * @param {number} totalIterations - Gesamtzahl aller Iterationen (für Progress)
 * @param {number} workerId - ID dieses Workers (für Progress-Tracking)
 * @param {number} baseSeed - Basis-Seed für deterministische Ergebnisse
 */
function runChunk(params, volatility, mcOptions, startIdx, count, totalIterations, workerId, baseSeed) {
  const batchSize = 50;
  let lastProgressTime = 0;
  
  // Rohdaten für Aggregation sammeln
  const rawData = {
    finalTotals: [],
    finalTotalsReal: [],
    finalLossPot: [],
    finalYearlyFreibetrag: [],
    retirementTotals: [],
    retirementTotalsReal: [],
    // Für Success/Shortfall/Ruin-Berechnung
    simResults: [],
    // Für SoRR
    sorrData: [],
    // Per-Monat-Daten für korrekte Perzentile (alle Pfade, nicht nur Samples)
    monthlyTotals: [],      // Array of Arrays: [month][iteration]
    monthlyTotalsReal: [],  // Array of Arrays: [month][iteration]
  };
  
  const samplePaths = [];
  const savingsMonths = params.savings_years * 12;
  const numMonths = (params.savings_years + params.withdrawal_years) * 12;
  const savingsTarget = params.savings_target ?? 0;
  
  // Initialisiere Per-Monat-Arrays
  for (let m = 0; m < numMonths; m++) {
    rawData.monthlyTotals.push([]);
    rawData.monthlyTotalsReal.push([]);
  }
  
  for (let i = 0; i < count; i++) {
    const globalIdx = startIdx + i;
    
    // Deterministisches Seeding: seed = baseSeed + globalIndex
    currentRng = createSeededRandom(baseSeed + globalIdx);
    
    const history = simulate(params, volatility);
    
    // Rohdaten extrahieren
    const lastRow = history[history.length - 1];
    const retirementIdx = Math.min(savingsMonths - 1, numMonths - 1);
    const retirementRow = history[retirementIdx];
    
    rawData.finalTotals.push(lastRow?.total || 0);
    rawData.finalTotalsReal.push(lastRow?.total_real || 0);
    rawData.finalLossPot.push(lastRow?.loss_pot || 0);
    rawData.finalYearlyFreibetrag.push(lastRow?.yearly_used_freibetrag || 0);
    rawData.retirementTotals.push(retirementRow?.total || 0);
    rawData.retirementTotalsReal.push(retirementRow?.total_real || 0);
    
    // Per-Monat-Daten sammeln für korrekte Perzentile
    for (let m = 0; m < numMonths && m < history.length; m++) {
      rawData.monthlyTotals[m].push(history[m]?.total || 0);
      rawData.monthlyTotalsReal[m].push(history[m]?.total_real || 0);
    }
    
    // Sim-spezifische Ergebnisse für Success/Shortfall/Ruin
    rawData.simResults.push(extractSimResult(history, params, mcOptions, savingsMonths, numMonths, savingsTarget));
    
    // SoRR-Daten
    rawData.sorrData.push(extractSorrData(history, params, savingsMonths, numMonths));
    
    // Sample-Pfade für UI (begrenzt)
    if (samplePaths.length < MAX_SAMPLE_PATHS) {
      samplePaths.push(history);
    }
    
    // Progress melden (gedrosselt)
    // KORRIGIERT: Melde lokalen Fortschritt (Anzahl fertige Pfade), nicht globalen Index
    if ((i + 1) % batchSize === 0 || i === count - 1) {
      const now = Date.now();
      if (now - lastProgressTime >= PROGRESS_THROTTLE_MS || i === count - 1) {
        lastProgressTime = now;
        self.postMessage({
          type: 'chunk-progress',
          workerId,
          completedInChunk: i + 1,  // Anzahl fertige Pfade in diesem Chunk
          chunkSize: count,
          totalIterations
        });
      }
    }
  }
  
  return { rawData, samplePaths };
}

/**
 * Extrahiert Sim-Ergebnisse für Success/Shortfall/Ruin-Berechnung
 */
function extractSimResult(history, params, mcOptions, savingsMonths, numMonths, savingsTarget) {
  const SUCCESS_THRESHOLD_REAL = mcOptions.successThreshold ?? 100;
  const RUIN_THRESHOLD_PERCENT = (mcOptions.ruinThresholdPercent ?? 10) / 100;
  const SHORTFALL_TOLERANCE_PERCENT = 0.01;
  const SHORTFALL_TOLERANCE_ABS = 50;
  
  const lastRow = history[history.length - 1];
  const endWealth = lastRow?.total || 0;
  const endInflation = lastRow?.cumulative_inflation || 1;
  const successThresholdNominal = SUCCESS_THRESHOLD_REAL * endInflation;
  const hasPositiveEnd = endWealth > successThresholdNominal;
  
  // Emergency-Fill-Tracking
  let firstFillMonth = null;
  if (savingsTarget <= 0) {
    firstFillMonth = 0;
  } else {
    for (let m = 0; m < Math.min(numMonths, history.length); m++) {
      if ((history[m]?.savings || 0) >= savingsTarget) {
        firstFillMonth = history[m]?.month ?? (m + 1);
        break;
      }
    }
  }
  
  // Shortfall-Tracking
  let hasAnsparShortfall = false;
  let hasEntnahmeShortfall = false;
  
  for (let m = 0; m < savingsMonths && m < numMonths; m++) {
    if ((history[m]?.shortfall || 0) > SHORTFALL_TOLERANCE_ABS || 
        (history[m]?.tax_shortfall || 0) > SHORTFALL_TOLERANCE_ABS) {
      hasAnsparShortfall = true;
      break;
    }
  }
  
  for (let m = savingsMonths; m < numMonths; m++) {
    const requested = history[m]?.withdrawal_requested || 0;
    const shortfall = history[m]?.shortfall || 0;
    const taxShortfall = history[m]?.tax_shortfall || 0;
    const tolerance = Math.max(SHORTFALL_TOLERANCE_ABS, requested * SHORTFALL_TOLERANCE_PERCENT);
    
    if (shortfall > tolerance || taxShortfall > tolerance) {
      hasEntnahmeShortfall = true;
      break;
    }
  }
  
  // Ruin-Tracking
  let isRuin = false;
  const retirementIdx = Math.min(savingsMonths - 1, numMonths - 1);
  const retirementWealth = history[retirementIdx]?.total || 0;
  const ruinThreshold = retirementWealth * RUIN_THRESHOLD_PERCENT;
  
  for (let m = savingsMonths; m < numMonths; m++) {
    const requested = history[m]?.withdrawal_requested || 0;
    const shortfallTolerance = Math.max(SHORTFALL_TOLERANCE_ABS, requested * SHORTFALL_TOLERANCE_PERCENT);
    const shortfall = history[m]?.shortfall || 0;
    const taxShortfall = history[m]?.tax_shortfall || 0;
    const significantShortfall = shortfall > shortfallTolerance || taxShortfall > shortfallTolerance;
    
    if ((history[m]?.total || 0) < ruinThreshold || significantShortfall) {
      isRuin = true;
      break;
    }
  }
  
  // Kapitalerhalt
  const retirementWealthReal = history[retirementIdx]?.total_real || 0;
  const endWealthReal = history[numMonths - 1]?.total_real || 0;
  const capitalPreserved = endWealth >= retirementWealth;
  const capitalPreservedReal = endWealthReal >= retirementWealthReal;
  
  // Entnahme-Statistiken
  const entnahmeRows = history.filter(r => r.phase === "Entnahme" && ((r.withdrawal || 0) > 0 || (r.withdrawal_net || 0) > 0));
  let avgWithdrawalNet = 0, avgWithdrawalNetReal = 0;
  let avgWithdrawalGross = 0, avgWithdrawalGrossReal = 0;
  let totalWithdrawalNet = 0, totalWithdrawalNetReal = 0;
  let totalWithdrawalGross = 0, totalWithdrawalGrossReal = 0;
  
  if (entnahmeRows.length > 0) {
    avgWithdrawalGross = entnahmeRows.reduce((s, r) => s + (r.withdrawal || 0), 0) / entnahmeRows.length;
    avgWithdrawalGrossReal = entnahmeRows.reduce((s, r) => s + (r.withdrawal_real || 0), 0) / entnahmeRows.length;
    avgWithdrawalNet = entnahmeRows.reduce((s, r) => s + (r.withdrawal_net || 0), 0) / entnahmeRows.length;
    avgWithdrawalNetReal = entnahmeRows.reduce((s, r) => s + (r.withdrawal_net_real || 0), 0) / entnahmeRows.length;
    totalWithdrawalGross = history.reduce((s, r) => s + (r.withdrawal || 0), 0);
    totalWithdrawalGrossReal = history.reduce((s, r) => s + (r.withdrawal_real || 0), 0);
    totalWithdrawalNet = history.reduce((s, r) => s + (r.withdrawal_net || 0), 0);
    totalWithdrawalNetReal = history.reduce((s, r) => s + (r.withdrawal_net_real || 0), 0);
  }
  
  return {
    hasPositiveEnd,
    hasAnsparShortfall,
    hasEntnahmeShortfall,
    isRuin,
    capitalPreserved,
    capitalPreservedReal,
    firstFillMonth,
    avgWithdrawalNet,
    avgWithdrawalNetReal,
    avgWithdrawalGross,
    avgWithdrawalGrossReal,
    totalWithdrawalNet,
    totalWithdrawalNetReal,
    totalWithdrawalGross,
    totalWithdrawalGrossReal,
  };
}

/**
 * Extrahiert SoRR-Daten für spätere Aggregation
 */
function extractSorrData(history, params, savingsMonths, numMonths) {
  const earlyYears = Math.min(5, params.withdrawal_years);
  const earlyMonths = earlyYears * 12;
  const startWealth = history[savingsMonths - 1]?.total || history[savingsMonths]?.total || 0;
  
  let twrProduct = 1;
  const earlyEndIdx = Math.min(savingsMonths + earlyMonths - 1, numMonths - 1);
  
  for (let m = savingsMonths; m <= earlyEndIdx && m < history.length; m++) {
    const monthlyReturn = history[m]?.portfolioReturn || history[m]?.etfReturn || 1;
    twrProduct *= monthlyReturn;
  }
  
  const actualMonths = earlyEndIdx - savingsMonths + 1;
  const earlyReturn = actualMonths > 0 ? Math.pow(twrProduct, 12 / actualMonths) - 1 : 0;
  const endWealth = history[numMonths - 1]?.total || 0;
  
  return { startWealth, earlyReturn, endWealth };
}

// ============ MESSAGE HANDLER ============

self.onmessage = function(e) {
  const { type } = e.data;
  
  try {
    switch (type) {
      // Legacy: Vollständige Simulation mit Analyse
      case 'start': {
        const { params, iterations, volatility, mcOptions } = e.data;
        
        if (!params) {
          throw new Error('Keine Parameter übergeben');
        }
        
        const results = runMonteCarloSimulationWorker(
          params,
          iterations || 1000,
          volatility || 15,
          mcOptions || {}
        );
        
        self.postMessage({ type: 'complete', results });
        break;
      }
      
      // Pool-Modus: Chunk-basierte Simulation mit Rohdaten-Rückgabe
      case 'run-chunk': {
        const { params, volatility, mcOptions, startIdx, count, totalIterations, workerId, baseSeed } = e.data;
        
        if (!params) {
          throw new Error('Keine Parameter übergeben');
        }
        
        const { rawData, samplePaths } = runChunk(
          params,
          volatility || 15,
          mcOptions || {},
          startIdx,
          count,
          totalIterations,
          workerId,
          baseSeed
        );
        
        self.postMessage({
          type: 'chunk-complete',
          workerId,
          rawData,
          samplePaths
        });
        break;
      }
      
      default:
        self.postMessage({ type: 'error', message: `Unbekannter Nachrichtentyp: ${type}` });
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err.message || 'Unbekannter Fehler bei der Monte-Carlo-Simulation'
    });
  }
};
