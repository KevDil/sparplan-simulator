/**
 * ETF Sparplan Simulator - Monte-Carlo Web Worker
 * 
 * Führt Monte-Carlo-Simulationen im Hintergrund durch.
 * 
 * MESSAGE PROTOKOLL:
 * - Main → Worker: { type: 'start', params, iterations, volatility, mcOptions }
 * - Worker → Main: { type: 'progress', current, total, percent }
 * - Worker → Main: { type: 'complete', results }
 * - Worker → Main: { type: 'error', message }
 */

// Importiere Simulationskern
importScripts('simulation-core.js');

// ============ MONTE-CARLO SIMULATION ============

/**
 * Führt Monte-Carlo-Simulation durch
 */
function runMonteCarloSimulationWorker(params, iterations, volatility, mcOptions = {}) {
  const allHistories = [];
  const batchSize = 50;
  
  // Seeded RNG falls angegeben
  if (mcOptions.seed != null) {
    currentRng = createSeededRandom(mcOptions.seed);
  } else {
    // Zufälliger Seed für Reproduzierbarkeit im Worker
    currentRng = createSeededRandom(Date.now() + Math.random() * 1000000);
  }
  
  for (let i = 0; i < iterations; i += batchSize) {
    const batchEnd = Math.min(i + batchSize, iterations);
    
    for (let j = i; j < batchEnd; j++) {
      const history = simulate(params, volatility);
      allHistories.push(history);
    }
    
    // Progress melden
    const progress = Math.round((batchEnd / iterations) * 100);
    self.postMessage({
      type: 'progress',
      current: batchEnd,
      total: iterations,
      percent: progress
    });
  }
  
  // Ergebnisse analysieren
  const results = analyzeMonteCarloResults(allHistories, params, mcOptions);
  results.volatility = volatility;
  
  // Für individuelle Pfade: Erste 50 speichern
  results.allHistories = allHistories.slice(0, 50);
  results.mcOptions = mcOptions;
  
  return results;
}

// ============ MESSAGE HANDLER ============

self.onmessage = function(e) {
  const { type, params, iterations, volatility, mcOptions } = e.data;
  
  if (type !== 'start') {
    self.postMessage({ type: 'error', message: `Unbekannter Nachrichtentyp: ${type}` });
    return;
  }
  
  try {
    if (!params) {
      throw new Error('Keine Parameter übergeben');
    }
    
    const results = runMonteCarloSimulationWorker(
      params,
      iterations || 1000,
      volatility || 15,
      mcOptions || {}
    );
    
    self.postMessage({
      type: 'complete',
      results
    });
    
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err.message || 'Unbekannter Fehler bei der Monte-Carlo-Simulation'
    });
  }
};
