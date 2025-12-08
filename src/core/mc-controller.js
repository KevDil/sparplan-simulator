/**
 * ETF Simulator - Monte-Carlo Controller
 * Version 2.0
 * 
 * Steuert die Monte-Carlo-Simulation mit Web Workers
 */

import { MC_DEFAULT_ITERATIONS, MC_MAX_ITERATIONS, MC_CHUNK_SIZE } from './constants.js';
import { aggregateChunkResults } from './mc-analysis.js';

// ============ STATE ============

let workers = [];
let isRunning = false;
let abortController = null;
let progressCallback = null;
let completedChunks = [];
let totalIterations = 0;
let completedIterations = 0;

// ============ WORKER POOL ============

/**
 * Ermittelt optimale Worker-Anzahl
 */
function getOptimalWorkerCount() {
  const cores = navigator.hardwareConcurrency || 4;
  return Math.min(Math.max(2, cores - 1), 8);
}

/**
 * Erstellt Worker-Pool
 */
function createWorkerPool(count) {
  const pool = [];
  for (let i = 0; i < count; i++) {
    // Worker-URL: docs/mc-worker.js (relativer Pfad)
    const worker = new Worker('mc-worker.js');
    pool.push({
      worker,
      id: i,
      busy: false,
      currentCompletedInChunk: 0,
      currentChunkSize: 0,
    });
  }
  return pool;
}

/**
 * Beendet alle Worker
 */
function terminateWorkers() {
  for (const { worker } of workers) {
    worker.terminate();
  }
  workers = [];
}

// ============ MC SIMULATION ============

/**
 * Startet Monte-Carlo-Simulation
 * @param {Object} params - Simulationsparameter
 * @param {Object} options - MC-Optionen
 * @param {Function} onProgress - Progress-Callback
 * @returns {Promise<Object>} MC-Ergebnisse
 */
export function runMonteCarloSimulation(params, options = {}, onProgress = null) {
  return new Promise((resolve, reject) => {
    if (isRunning) {
      reject(new Error('Simulation läuft bereits'));
      return;
    }
    
    isRunning = true;
    progressCallback = onProgress;
    completedChunks = [];
    completedIterations = 0;
    
    const iterations = Math.min(options.iterations || MC_DEFAULT_ITERATIONS, MC_MAX_ITERATIONS);
    const volatility = options.volatility || 15;
    const seed = options.seed || Date.now();
    totalIterations = iterations;
    
    const mcOptions = {
      successThreshold: options.successThreshold || 100,
      ruinThresholdPercent: options.ruinThresholdPercent || 10,
      seed,
      stressScenario: options.stressScenario || 'none',
    };
    
    // Worker-Pool erstellen
    const workerCount = getOptimalWorkerCount();
    workers = createWorkerPool(workerCount);
    
    // Chunks aufteilen
    const chunks = [];
    let remaining = iterations;
    let startIdx = 0;
    
    while (remaining > 0) {
      const count = Math.min(MC_CHUNK_SIZE, remaining);
      chunks.push({ startIdx, count });
      startIdx += count;
      remaining -= count;
    }
    
    let chunkIndex = 0;
    let errored = false;

    function reportProgress() {
      if (!progressCallback) return;
      const inFlight = workers.reduce((sum, w) => sum + (w.currentCompletedInChunk || 0), 0);
      const totalCompleted = completedIterations + inFlight;
      const clamped = Math.min(totalCompleted, iterations);
      progressCallback({
        current: clamped,
        total: iterations,
        percent: Math.round((clamped / iterations) * 100),
      });
    }
    
    // Chunk an freien Worker zuweisen
    function assignNextChunk(workerItem) {
      if (errored || chunkIndex >= chunks.length) return;
      
      const chunk = chunks[chunkIndex++];
      workerItem.busy = true;
      workerItem.currentCompletedInChunk = 0;
      workerItem.currentChunkSize = chunk.count;
      
      workerItem.worker.postMessage({
        type: 'run-chunk',
        params,
        volatility,
        mcOptions,
        startIdx: chunk.startIdx,
        count: chunk.count,
        totalIterations: iterations,
        workerId: workerItem.id,
        baseSeed: seed,
      });
    }
    
    // Worker-Handler einrichten
    for (const workerItem of workers) {
      workerItem.worker.onmessage = (e) => {
        const { type } = e.data;
        
        if (type === 'chunk-progress') {
          const { completedInChunk } = e.data;
          // Fortschritt pro Worker aktualisieren und kumuliert melden
          workerItem.currentCompletedInChunk = completedInChunk;
          reportProgress();
        } else if (type === 'chunk-complete') {
          const { rawData, samplePaths } = e.data;
          completedChunks.push({ rawData, samplePaths });
          workerItem.busy = false;
          
          // Abgeschlossenen Chunk in die Gesamtanzahl übernehmen
          workerItem.currentCompletedInChunk = 0;
          workerItem.currentChunkSize = 0;
          completedIterations += rawData.finalTotals.length;
          reportProgress();
          
          // Nächsten Chunk zuweisen
          if (chunkIndex < chunks.length) {
            assignNextChunk(workerItem);
          } else if (completedChunks.length === chunks.length) {
            // Alle Chunks fertig
            finishSimulation();
          }
        } else if (type === 'error') {
          errored = true;
          isRunning = false;
          terminateWorkers();
          reject(new Error(e.data.message));
        }
      };
      
      workerItem.worker.onerror = (err) => {
        errored = true;
        isRunning = false;
        terminateWorkers();
        reject(new Error(err.message || 'Worker-Fehler'));
      };
    }
    
    // Simulation abschließen
    function finishSimulation() {
      isRunning = false;
      terminateWorkers();
      
      // Ergebnisse aggregieren
      const results = aggregateChunkResults(completedChunks, params, mcOptions);
      results.volatility = volatility;
      results.iterations = iterations;
      
      resolve(results);
    }
    
    // Erste Chunks starten
    for (const workerItem of workers) {
      if (chunkIndex < chunks.length) {
        assignNextChunk(workerItem);
      }
    }
  });
}

/**
 * Bricht laufende Simulation ab
 */
export function abortSimulation() {
  if (!isRunning) return;
  
  isRunning = false;
  terminateWorkers();
  completedChunks = [];
}

/**
 * Prüft ob Simulation läuft
 */
export function isSimulationRunning() {
  return isRunning;
}

/**
 * Legacy-Funktion: Einzelner Worker
 */
export function runMonteCarloLegacy(params, iterations, volatility, mcOptions = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('mc-worker.js');
    
    worker.onmessage = (e) => {
      const { type, results, message } = e.data;
      
      if (type === 'complete') {
        worker.terminate();
        resolve(results);
      } else if (type === 'error') {
        worker.terminate();
        reject(new Error(message));
      } else if (type === 'progress' && progressCallback) {
        progressCallback(e.data);
      }
    };
    
    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message));
    };
    
    worker.postMessage({
      type: 'start',
      params,
      iterations,
      volatility,
      mcOptions,
    });
  });
}
