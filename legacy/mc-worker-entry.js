/**
 * ETF Sparplan Simulator - Monte-Carlo Web Worker Entry
 * Version 2.0
 * 
 * Worker-Einstiegspunkt für Monte-Carlo-Simulationen.
 * Wird nach docs/mc-worker.js gebündelt.
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
 * - Worker → Main: { type: 'chunk-progress', workerId, completedInChunk, chunkSize, totalIterations }
 * - Worker → Main: { type: 'chunk-complete', workerId, rawData, samplePaths }
 * 
 * - Worker → Main: { type: 'error', message }
 */

import { simulate, createSeededRandom, setRng } from './simulation-core.js';
import { analyzeMonteCarloResults } from './mc-analysis.js';
import { extractSimResult, extractSorrData } from './mc-path-metrics.js';
import { MONTHS_PER_YEAR } from './constants.js';

// ============ KONSTANTEN ============

const PROGRESS_THROTTLE_MS = 100;
const MAX_SAMPLE_PATHS = 10;

// ============ MONTE-CARLO SIMULATION (LEGACY) ============

/**
 * Führt Monte-Carlo-Simulation durch (Legacy-Modus, vollständige Analyse)
 */
function runMonteCarloSimulationWorker(params, iterations, volatility, mcOptions = {}) {
  const allHistories = [];
  const batchSize = 50;
  
  // Seeded RNG falls angegeben
  if (mcOptions.seed != null) {
    setRng(createSeededRandom(mcOptions.seed));
  } else {
    setRng(createSeededRandom(Date.now() + Math.random() * 1000000));
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
 */
function runChunk(params, volatility, mcOptions, startIdx, count, totalIterations, workerId, baseSeed) {
  const batchSize = 50;
  let lastProgressTime = 0;
  
  const savingsMonths = params.savings_years * MONTHS_PER_YEAR;
  const numMonths = (params.savings_years + params.withdrawal_years) * MONTHS_PER_YEAR;
  const savingsTarget = params.savings_target ?? 0;
  
  // Rohdaten für Aggregation sammeln
  const rawData = {
    finalTotals: [],
    finalTotalsReal: [],
    finalLossPot: [],
    finalYearlyFreibetrag: [],
    retirementTotals: [],
    retirementTotalsReal: [],
    simResults: [],
    sorrData: [],
    monthlyTotals: [],
    monthlyTotalsReal: [],
  };
  
  const samplePaths = [];
  
  // Initialisiere Per-Monat-Arrays
  for (let m = 0; m < numMonths; m++) {
    rawData.monthlyTotals.push([]);
    rawData.monthlyTotalsReal.push([]);
  }
  
  for (let i = 0; i < count; i++) {
    const globalIdx = startIdx + i;
    
    // Deterministisches Seeding: seed = baseSeed + globalIndex
    setRng(createSeededRandom(baseSeed + globalIdx));
    
    // Stress-Szenario Option für MC
    const simOptions = {};
    if (mcOptions.stressScenario && mcOptions.stressScenario !== 'none') {
      simOptions.stressScenario = mcOptions.stressScenario;
    }
    
    const history = simulate(params, volatility, simOptions);
    
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
    
    // Sim-spezifische Ergebnisse für Success/Shortfall/Ruin (aus mc-path-metrics.js)
    rawData.simResults.push(extractSimResult(history, params, mcOptions, savingsMonths, numMonths, savingsTarget));
    
    // SoRR-Daten (aus mc-path-metrics.js)
    rawData.sorrData.push(extractSorrData(history, params, savingsMonths, numMonths));
    
    // Sample-Pfade für UI (begrenzt)
    if (samplePaths.length < MAX_SAMPLE_PATHS) {
      samplePaths.push(history);
    }
    
    // Progress melden (gedrosselt)
    if ((i + 1) % batchSize === 0 || i === count - 1) {
      const now = Date.now();
      if (now - lastProgressTime >= PROGRESS_THROTTLE_MS || i === count - 1) {
        lastProgressTime = now;
        self.postMessage({
          type: 'chunk-progress',
          workerId,
          completedInChunk: i + 1,
          chunkSize: count,
          totalIterations
        });
      }
    }
  }
  
  return { rawData, samplePaths };
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
