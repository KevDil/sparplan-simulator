/**
 * ETF Sparplan Optimizer - Web Worker Entry
 * Version 2.0
 * 
 * Worker-Einstiegspunkt für die Grid-Optimierung.
 * Wird nach docs/optimizer-worker.js gebündelt.
 * 
 * MESSAGE PROTOKOLL:
 * - Main → Worker: { type: 'start', params, mcOptions, mode, gridConfig, seedBase }
 * - Worker → Main: { type: 'progress', current, total, percent, currentCandidate }
 * - Worker → Main: { type: 'complete', best: { params, results, score } }
 * - Worker → Main: { type: 'error', message }
 * 
 * POOL-MODUS:
 * - Main → Worker: { type: 'run-chunk', candidates, mcOptions, mode, gridConfig, seedBase, workerId, totalCandidates }
 * - Worker → Main: { type: 'chunk-progress', workerId, processed, chunkSize, totalCandidates }
 * - Worker → Main: { type: 'chunk-complete', workerId, best, processed }
 */

import { simulate, createSeededRandom, setRng } from './simulation-core.js';
import { analyzeMonteCarloResults } from './mc-analysis.js';
import { 
  generateCandidates,
  buildEmergencyConfig,
  scoreCandidate,
  scoreCandidateModeB,
  extractOptimizationResults,
  DEFAULT_ITERATIONS_OPTIMIZE,
  MAX_ITERATIONS_OPTIMIZE
} from './optimizer-logic.js';

// ============ MC FÜR KANDIDATEN ============

/**
 * Führt Monte-Carlo-Simulation für einen Kandidaten durch
 */
function runMonteCarloForCandidate(params, mcOptions, seedBase, candidateIdx) {
  const iterations = Math.min(mcOptions.iterations || DEFAULT_ITERATIONS_OPTIMIZE, MAX_ITERATIONS_OPTIMIZE);
  const volatility = mcOptions.volatility || 15;
  
  // Seed für diesen Kandidaten (Common Random Numbers)
  const seed = seedBase + candidateIdx;
  setRng(createSeededRandom(seed));
  
  const allHistories = [];
  
  for (let i = 0; i < iterations; i++) {
    const history = simulate(params, volatility);
    allHistories.push(history);
  }
  
  return analyzeMonteCarloResults(allHistories, params, mcOptions);
}

// ============ OPTIMIERUNG ============

/**
 * Hauptfunktion: Optimierung durchführen
 */
function runOptimization(baseParams, mcOptions, mode, gridConfig, seedBase) {
  const candidates = generateCandidates(baseParams, mode, gridConfig);
  const targetSuccess = (gridConfig && typeof gridConfig.targetSuccess === 'number')
    ? gridConfig.targetSuccess
    : 90;
  const emergencyConfig = buildEmergencyConfig(gridConfig || {});
  
  const scoreFn = mode === 'B' || mode === 'rent_fix' ? scoreCandidateModeB : scoreCandidate;
  
  let best = null;
  const total = candidates.length;
  
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    
    // Progress melden
    self.postMessage({
      type: 'progress',
      current: i + 1,
      total,
      percent: Math.round(((i + 1) / total) * 100),
      currentCandidate: {
        monthly_savings: candidate.monthly_savings,
        monthly_etf: candidate.monthly_etf,
        monthly_payout_net: candidate.monthly_payout_net,
        monthly_payout_percent: candidate.monthly_payout_percent,
        rent_mode: candidate.rent_mode,
      }
    });
    
    // MC-Simulation durchführen
    const results = runMonteCarloForCandidate(candidate, mcOptions, seedBase, i);
    
    // Score berechnen
    const score = scoreFn(candidate, results, targetSuccess, emergencyConfig);

    if (score === -Infinity) {
      continue;
    }
    
    // Besten Kandidaten aktualisieren
    if (!best || score > best.score) {
      best = {
        params: candidate,
        results: extractOptimizationResults(results),
        score
      };
    }
  }
  
  return best;
}

// ============ CHUNK-BASIERTE OPTIMIERUNG (POOL-MODUS) ============

/**
 * Führt Optimierung für einen Chunk von Kandidaten durch.
 */
function runChunkOptimization(candidates, mcOptions, mode, gridConfig, seedBase, workerId, totalCandidates) {
  const targetSuccess = (gridConfig && typeof gridConfig.targetSuccess === 'number')
    ? gridConfig.targetSuccess
    : 90;
  const emergencyConfig = buildEmergencyConfig(gridConfig || {});
  
  const scoreFn = mode === 'B' || mode === 'rent_fix' ? scoreCandidateModeB : scoreCandidate;
  
  let best = null;
  let processed = 0;
  
  for (const { candidate, globalIdx } of candidates) {
    // MC-Simulation mit globalem Seed für CRN
    const results = runMonteCarloForCandidate(candidate, mcOptions, seedBase, globalIdx);
    
    // Score berechnen
    const score = scoreFn(candidate, results, targetSuccess, emergencyConfig);
    
    processed++;
    
    // Progress melden (gedrosselt)
    if (processed % 5 === 0 || processed === candidates.length) {
      self.postMessage({
        type: 'chunk-progress',
        workerId,
        processed,
        chunkSize: candidates.length,
        totalCandidates
      });
    }
    
    if (score === -Infinity) continue;
    
    // Besten Kandidaten dieses Chunks aktualisieren
    if (!best || score > best.score || (score === best.score && globalIdx < best.globalIdx)) {
      best = {
        params: candidate,
        results: extractOptimizationResults(results),
        score,
        globalIdx
      };
    }
  }
  
  return { best, processed };
}

// ============ MESSAGE HANDLER ============

self.onmessage = function(e) {
  const { type } = e.data;
  
  try {
    switch (type) {
      // Legacy: Vollständige Optimierung
      case 'start': {
        const { params, mcOptions, mode, gridConfig, seedBase } = e.data;
        
        if (!params) {
          throw new Error('Keine Parameter übergeben');
        }
        
        const seed = seedBase || (mcOptions?.seed ?? Date.now());
        const best = runOptimization(params, mcOptions || {}, mode || 'A', gridConfig || {}, seed);
        
        if (!best) {
          self.postMessage({
            type: 'complete',
            best: null,
            message: 'Keine gültige Konfiguration gefunden (alle unter Ziel-Erfolgswahrscheinlichkeit)'
          });
        } else {
          self.postMessage({ type: 'complete', best });
        }
        break;
      }
      
      // Pool-Modus: Chunk von Kandidaten verarbeiten
      case 'run-chunk': {
        const { candidates, mcOptions, mode, gridConfig, seedBase, workerId, totalCandidates } = e.data;
        
        if (!candidates || !candidates.length) {
          throw new Error('Keine Kandidaten übergeben');
        }
        
        const { best, processed } = runChunkOptimization(
          candidates,
          mcOptions || {},
          mode || 'A',
          gridConfig || {},
          seedBase,
          workerId,
          totalCandidates
        );
        
        self.postMessage({
          type: 'chunk-complete',
          workerId,
          best,
          processed
        });
        break;
      }
      
      default:
        self.postMessage({ type: 'error', message: `Unbekannter Nachrichtentyp: ${type}` });
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err.message || 'Unbekannter Fehler bei der Optimierung'
    });
  }
};
