/**
 * ETF Sparplan Optimizer - Web Worker
 * 
 * Führt Grid-Suche im Hintergrund durch, ohne den Main-Thread zu blockieren.
 * 
 * MESSAGE PROTOKOLL:
 * - Main → Worker: { type: 'start', params, mcOptions, mode, gridConfig, seedBase }
 * - Worker → Main: { type: 'progress', current, total, percent, currentCandidate }
 * - Worker → Main: { type: 'complete', best: { params, results, score } }
 * - Worker → Main: { type: 'error', message }
 */

// Importiere Simulationskern
importScripts('simulation-core.js');

// ============ KONSTANTEN ============

const DEFAULT_ITERATIONS = 500; // Reduzierte Iterationen für Optimierung (Speed vs. Genauigkeit)
const MAX_ITERATIONS_OPTIMIZE = 2000; // Hartes Limit für Optimierung

// ============ GRID-GENERIERUNG ============

/**
 * Generiert Kandidaten für Modus A: Budget fix, Rente maximieren
 * @param {Object} baseParams - Ausgangsparameter
 * @param {Object} gridConfig - Grid-Konfiguration
 * @returns {Array} Array von Kandidaten-Parametern
 */
function generateCandidatesModeA(baseParams, gridConfig) {
  const candidates = [];
  
  const {
    maxBudget = (baseParams.monthly_savings || 0) + (baseParams.monthly_etf || 0),
    tgStep = 50,
    rentStep = 50,
    rentRange = 0.5, // ±50% um aktuellen Wert
    maxCombinations = 60
  } = gridConfig;
  
  const currentRent = baseParams.monthly_payout_net || 1000;
  const rentMin = Math.max(100, currentRent * (1 - rentRange));
  const rentMax = currentRent * (1 + rentRange);
  
  // TG-Anteil von 0 bis maxBudget
  const tgValues = [];
  for (let tg = 0; tg <= maxBudget; tg += tgStep) {
    tgValues.push(tg);
  }
  
  // Renten-Werte
  const rentValues = [];
  for (let rent = rentMin; rent <= rentMax; rent += rentStep) {
    rentValues.push(Math.round(rent));
  }
  
  // Kombinationen generieren (mit Limit)
  for (const tg of tgValues) {
    const etf = maxBudget - tg;
    if (etf < 0) continue;
    
    for (const rent of rentValues) {
      candidates.push({
        ...baseParams,
        monthly_savings: tg,
        monthly_etf: etf,
        monthly_payout_net: rent,
      });
      
      if (candidates.length >= maxCombinations) {
        return candidates;
      }
    }
  }
  
  return candidates;
}

/**
 * Generiert Kandidaten für Modus B: Zielrente fix, Sparrate minimieren
 */
function generateCandidatesModeB(baseParams, gridConfig) {
  const candidates = [];
  
  const {
    maxBudget = (baseParams.monthly_savings || 0) + (baseParams.monthly_etf || 0),
    budgetStep = 25,
    budgetRange = 0.5,
    maxCombinations = 60
  } = gridConfig;
  
  const budgetMin = Math.max(50, maxBudget * (1 - budgetRange));
  const budgetMax = maxBudget * (1 + budgetRange);
  
  // Budget-Werte
  for (let budget = budgetMin; budget <= budgetMax; budget += budgetStep) {
    // Verschiedene TG/ETF Aufteilungen
    for (let tgRatio = 0; tgRatio <= 1; tgRatio += 0.25) {
      const tg = Math.round(budget * tgRatio);
      const etf = Math.round(budget - tg);
      
      candidates.push({
        ...baseParams,
        monthly_savings: tg,
        monthly_etf: etf,
      });
      
      if (candidates.length >= maxCombinations) {
        return candidates;
      }
    }
  }
  
  return candidates;
}

/**
 * Generiert Kandidaten basierend auf Modus
 */
function generateCandidates(baseParams, mode, gridConfig) {
  switch (mode) {
    case 'A':
    case 'budget_fix':
      return generateCandidatesModeA(baseParams, gridConfig);
    case 'B':
    case 'rent_fix':
      return generateCandidatesModeB(baseParams, gridConfig);
    default:
      return generateCandidatesModeA(baseParams, gridConfig);
  }
}

// ============ SCORING ============

/**
 * Berechnet Score für einen Kandidaten (Modus A)
 * 
 * Scoring-Logik (dokumentiert):
 * - Harte Bedingung: successRate >= targetSuccess, sonst -Infinity
 * - Hauptziel: Hohe Rente (Gewicht: 10)
 * - Sekundärziel 1: Hohes Median-Endvermögen real (Gewicht: 1/10000)
 * - Sekundärziel 2: Niedriges Ruin-Risiko (Gewicht: -2)
 * 
 * @param {Object} candidate - Kandidaten-Parameter
 * @param {Object} results - MC-Ergebnisse
 * @param {number} targetSuccess - Ziel-Erfolgswahrscheinlichkeit (%)
 * @returns {number} Score
 */
function scoreCandidate(candidate, results, targetSuccess = 90) {
  // Harte Bedingung
  if (results.successRate < targetSuccess) {
    return -Infinity;
  }
  
  const rentEur = candidate.monthly_payout_net || 0;
  const medianEndReal = results.medianEndReal || 0;
  const ruinProbability = results.ruinProbability || 0;
  
  // Score-Berechnung (Gewichte dokumentiert)
  let score = 0;
  score += rentEur * 10;                    // Hauptziel: Rente maximieren
  score += medianEndReal / 10000;           // Sekundär: Höheres Endvermögen
  score -= ruinProbability * 2;             // Bestrafung: Ruin-Risiko
  
  return score;
}

/**
 * Berechnet Score für Modus B (Sparrate minimieren)
 */
function scoreCandidateModeB(candidate, results, targetSuccess = 90) {
  if (results.successRate < targetSuccess) {
    return -Infinity;
  }
  
  const totalBudget = (candidate.monthly_savings || 0) + (candidate.monthly_etf || 0);
  const medianEndReal = results.medianEndReal || 0;
  const ruinProbability = results.ruinProbability || 0;
  
  // Score: Niedrigeres Budget = besser (daher negativ)
  let score = 0;
  score -= totalBudget * 10;                // Hauptziel: Budget minimieren
  score += medianEndReal / 10000;           // Sekundär: Höheres Endvermögen
  score -= ruinProbability * 2;             // Bestrafung: Ruin-Risiko
  
  return score;
}

// ============ OPTIMIERUNG ============

/**
 * Führt Monte-Carlo-Simulation für einen Kandidaten durch
 */
function runMonteCarloForCandidate(params, mcOptions, seedBase, candidateIdx) {
  const iterations = Math.min(mcOptions.iterations || DEFAULT_ITERATIONS, MAX_ITERATIONS_OPTIMIZE);
  const volatility = mcOptions.volatility || 15;
  
  // Seed für diesen Kandidaten (Common Random Numbers)
  const seed = seedBase + candidateIdx;
  currentRng = createSeededRandom(seed);
  
  const allHistories = [];
  
  for (let i = 0; i < iterations; i++) {
    const history = simulate(params, volatility);
    allHistories.push(history);
  }
  
  return analyzeMonteCarloResults(allHistories, params, mcOptions);
}

/**
 * Hauptfunktion: Optimierung durchführen
 */
function runOptimization(baseParams, mcOptions, mode, gridConfig, seedBase) {
  const candidates = generateCandidates(baseParams, mode, gridConfig);
  const targetSuccess = mcOptions.successThreshold 
    ? 100 - mcOptions.successThreshold // Umrechnung falls Threshold angegeben
    : (gridConfig.targetSuccess || 90);
  
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
      }
    });
    
    // MC-Simulation durchführen
    const results = runMonteCarloForCandidate(candidate, mcOptions, seedBase, i);
    
    // Score berechnen
    const score = mode === 'B' || mode === 'rent_fix'
      ? scoreCandidateModeB(candidate, results, targetSuccess)
      : scoreCandidate(candidate, results, targetSuccess);
    
    // Besten Kandidaten aktualisieren
    if (!best || score > best.score) {
      best = {
        params: candidate,
        results: {
          successRate: results.successRate,
          ruinProbability: results.ruinProbability,
          medianEnd: results.medianEnd,
          medianEndReal: results.medianEndReal,
          capitalPreservationRate: results.capitalPreservationRate,
          capitalPreservationRateReal: results.capitalPreservationRateReal,
          retirementMedian: results.retirementMedian,
          retirementMedianReal: results.retirementMedianReal,
          p10EndReal: results.p10EndReal,
          p90EndReal: results.p90EndReal,
        },
        score
      };
    }
  }
  
  return best;
}

// ============ MESSAGE HANDLER ============

self.onmessage = function(e) {
  const { type, params, mcOptions, mode, gridConfig, seedBase } = e.data;
  
  if (type !== 'start') {
    self.postMessage({ type: 'error', message: `Unbekannter Nachrichtentyp: ${type}` });
    return;
  }
  
  try {
    // Validierung
    if (!params) {
      throw new Error('Keine Parameter übergeben');
    }
    
    // Seed bestimmen
    const seed = seedBase || (mcOptions?.seed ?? Date.now());
    
    // Optimierung starten
    const best = runOptimization(
      params,
      mcOptions || {},
      mode || 'A',
      gridConfig || {},
      seed
    );
    
    if (!best) {
      self.postMessage({
        type: 'complete',
        best: null,
        message: 'Keine gültige Konfiguration gefunden (alle unter Ziel-Erfolgswahrscheinlichkeit)'
      });
    } else {
      self.postMessage({
        type: 'complete',
        best
      });
    }
    
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err.message || 'Unbekannter Fehler bei der Optimierung'
    });
  }
};
