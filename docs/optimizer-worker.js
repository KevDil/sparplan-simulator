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

const DEFAULT_ITERATIONS = 1000; // Iterationen für Optimierung (Balance: Speed vs. Genauigkeit)
const MAX_ITERATIONS_OPTIMIZE = 2000; // Hartes Limit für Optimierung

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// ============ GRID-GENERIERUNG ============

/**
 * Generiert Kandidaten für Modus A: Budget fix, Rente maximieren
 * Unterstützt sowohl EUR-Modus (feste Beträge) als auch Percent-Modus (prozentuale Entnahme)
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
    rentStepPercent = 0.25, // Schrittweite für Prozent-Modus
    rentRange = 0.5, // ±50% um aktuellen Wert
    maxCombinations = 60
  } = gridConfig;
  
  // Prüfe ob Percent-Modus aktiv ist
  const isPercentMode = baseParams.rent_mode === 'percent' || 
    (baseParams.monthly_payout_percent != null && baseParams.monthly_payout_percent > 0);
  
  // TG-Anteil von 0 bis maxBudget
  const tgValues = [];
  for (let tg = 0; tg <= maxBudget; tg += tgStep) {
    tgValues.push(tg);
  }
  
  if (isPercentMode) {
    // PERCENT-MODUS: Prozentuale Entnahme optimieren
    const currentPercent = baseParams.monthly_payout_percent || 3.5;
    const percentMin = Math.max(1.0, currentPercent * (1 - rentRange));
    const percentMax = Math.min(8.0, currentPercent * (1 + rentRange));
    
    // Prozent-Werte generieren
    const percentValues = [];
    for (let pct = percentMin; pct <= percentMax; pct += rentStepPercent) {
      percentValues.push(Math.round(pct * 100) / 100); // Auf 2 Dezimalstellen runden
    }
    
    // Kombinationen generieren
    for (const tg of tgValues) {
      const etf = maxBudget - tg;
      if (etf < 0) continue;
      
      for (const pct of percentValues) {
        candidates.push({
          ...baseParams,
          monthly_savings: tg,
          monthly_etf: etf,
          monthly_payout_percent: pct,
          monthly_payout_net: null, // Explizit null setzen für Percent-Modus
          rent_mode: 'percent',
        });
        
        if (candidates.length >= maxCombinations) {
          return candidates;
        }
      }
    }
  } else {
    // EUR-MODUS: Feste Beträge optimieren
    const currentRent = baseParams.monthly_payout_net || 1000;
    const rentMin = Math.max(100, currentRent * (1 - rentRange));
    const rentMax = currentRent * (1 + rentRange);
    
    // Renten-Werte
    const rentValues = [];
    for (let rent = rentMin; rent <= rentMax; rent += rentStep) {
      rentValues.push(Math.round(rent));
    }
    
    // Kombinationen generieren
    for (const tg of tgValues) {
      const etf = maxBudget - tg;
      if (etf < 0) continue;
      
      for (const rent of rentValues) {
        candidates.push({
          ...baseParams,
          monthly_savings: tg,
          monthly_etf: etf,
          monthly_payout_net: rent,
          monthly_payout_percent: null, // Explizit null setzen für EUR-Modus
          rent_mode: 'eur',
        });
        
        if (candidates.length >= maxCombinations) {
          return candidates;
        }
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

function buildEmergencyConfig(gridConfig = {}) {
  return {
    weight: gridConfig.emergencyWeight ?? 4000,
    maxFillYears: gridConfig.emergencyMaxYears ?? 10,
    minFillProbability: gridConfig.minFillProbability ?? 0,
    hardMinFill: gridConfig.hardMinFill ?? false,
    minFillPenalty: gridConfig.minFillPenalty ?? 1e6,
  };
}

function evaluateEmergency(candidate, results, emergencyConfig) {
  const target = candidate.savings_target ?? 0;
  const hasEmergencyGoal = target > 0;
  const fillProb = results.emergencyFillProbability ?? 0;
  const medianFillYears = results.emergencyMedianFillYears;
  const weight = emergencyConfig?.weight ?? 4000;
  const maxYears = emergencyConfig?.maxFillYears ?? 10;
  const minFillProb = emergencyConfig?.minFillProbability ?? 0;
  const minFillPenalty = emergencyConfig?.minFillPenalty ?? 1e6;
  const hardMinFill = emergencyConfig?.hardMinFill ?? false;

  if (hasEmergencyGoal && fillProb === 0) {
    return { disqualify: true, contribution: -Infinity, fillProb, medianFillYears };
  }

  let penalty = 0;
  if (hasEmergencyGoal && minFillProb > 0 && fillProb < minFillProb) {
    if (hardMinFill) {
      return { disqualify: true, contribution: -Infinity, fillProb, medianFillYears };
    }
    penalty = minFillPenalty;
  }

  const probFactor = hasEmergencyGoal ? clamp(fillProb / 100, 0, 1) : 1;
  let tNorm = 1;

  if (hasEmergencyGoal) {
    if (medianFillYears == null) {
      tNorm = 0;
    } else {
      tNorm = clamp((maxYears - medianFillYears) / maxYears, 0, 1);
    }
  }

  const quality = 0.6 * probFactor + 0.4 * tNorm;
  const contribution = quality * weight - penalty;

  return { disqualify: false, contribution, fillProb, medianFillYears, quality };
}

// ============ SCORING ============

/**
 * Berechnet Score für einen Kandidaten (Modus A)
 * Unterstützt sowohl EUR-Modus als auch Percent-Modus
 * 
 * Scoring-Logik (dokumentiert):
 * - Harte Bedingung: successRate >= targetSuccess, sonst -Infinity
 * - Hauptziel: Hohe Rente (EUR oder Prozent)
 * - Sekundärziel 1: Hohes Median-Endvermögen real (Gewicht: 1/10000)
 * - Sekundärziel 2: Niedriges Ruin-Risiko (Gewicht: -2)
 * 
 * @param {Object} candidate - Kandidaten-Parameter
 * @param {Object} results - MC-Ergebnisse
 * @param {number} targetSuccess - Ziel-Erfolgswahrscheinlichkeit (%)
 * @returns {number} Score
 */
function scoreCandidate(candidate, results, targetSuccess = 90, emergencyConfig) {
  // Harte Bedingung
  if (results.successRate < targetSuccess) {
    return -Infinity;
  }

  const emergencyEval = evaluateEmergency(candidate, results, emergencyConfig);
  if (emergencyEval.disqualify) {
    return -Infinity;
  }
  
  const medianEndReal = results.medianEndReal || 0;
  const ruinProbability = results.ruinProbability || 0;
  
  // Score-Berechnung abhängig vom Modus
  let score = 0;
  
  const isPercentMode = candidate.rent_mode === 'percent' || 
    (candidate.monthly_payout_percent != null && candidate.monthly_payout_percent > 0);
  
  if (isPercentMode) {
    // Percent-Modus: Höherer Prozentsatz = besser
    // Gewicht 1000 um vergleichbar mit EUR-Modus zu sein (3.5% * 1000 = 3500, ähnlich zu 1000€ * 10)
    const rentPercent = candidate.monthly_payout_percent || 0;
    score += rentPercent * 1000;
  } else {
    // EUR-Modus: Höhere Rente = besser
    const rentEur = candidate.monthly_payout_net || 0;
    score += rentEur * 10;
  }
  
  score += medianEndReal / 10000;           // Sekundär: Höheres Endvermögen
  score -= ruinProbability * 2;             // Bestrafung: Ruin-Risiko
  score += emergencyEval.contribution;      // Notgroschen-Priorisierung
  
  return score;
}

/**
 * Berechnet Score für Modus B (Sparrate minimieren)
 */
function scoreCandidateModeB(candidate, results, targetSuccess = 90, emergencyConfig) {
  if (results.successRate < targetSuccess) {
    return -Infinity;
  }

  const emergencyEval = evaluateEmergency(candidate, results, emergencyConfig);
  if (emergencyEval.disqualify) {
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
  score += emergencyEval.contribution;      // Notgroschen-Priorisierung
  
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
  const emergencyConfig = buildEmergencyConfig(gridConfig || {});
  
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
    const score = mode === 'B' || mode === 'rent_fix'
      ? scoreCandidateModeB(candidate, results, targetSuccess, emergencyConfig)
      : scoreCandidate(candidate, results, targetSuccess, emergencyConfig);

    if (score === -Infinity) {
      continue;
    }
    
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
          emergencyFillProbability: results.emergencyFillProbability,
          emergencyNeverFillProbability: results.emergencyNeverFillProbability,
          emergencyMedianFillYears: results.emergencyMedianFillYears,
        },
        score
      };
    }
  }
  
  return best;
}

// ============ CHUNK-BASIERTE OPTIMIERUNG (POOL-MODUS) ============

/**
 * Führt Optimierung für einen Chunk von Kandidaten durch.
 * Gibt nur den besten Kandidaten des Chunks zurück.
 * 
 * @param {Array} candidates - Kandidaten-Array mit globalIdx
 * @param {Object} mcOptions - MC-Optionen
 * @param {string} mode - Optimierungsmodus ('A' oder 'B')
 * @param {Object} gridConfig - Grid-Konfiguration
 * @param {number} seedBase - Basis-Seed für CRN
 * @param {number} workerId - Worker-ID für Progress
 * @param {number} totalCandidates - Gesamtzahl Kandidaten (für Progress)
 */
function runChunkOptimization(candidates, mcOptions, mode, gridConfig, seedBase, workerId, totalCandidates) {
  const targetSuccess = mcOptions.successThreshold 
    ? 100 - mcOptions.successThreshold
    : (gridConfig.targetSuccess || 90);
  const emergencyConfig = buildEmergencyConfig(gridConfig || {});
  
  let best = null;
  let processed = 0;
  
  for (const { candidate, globalIdx } of candidates) {
    // MC-Simulation mit globalem Seed für CRN
    const results = runMonteCarloForCandidate(candidate, mcOptions, seedBase, globalIdx);
    
    // Score berechnen
    const score = mode === 'B' || mode === 'rent_fix'
      ? scoreCandidateModeB(candidate, results, targetSuccess, emergencyConfig)
      : scoreCandidate(candidate, results, targetSuccess, emergencyConfig);
    
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
    // Bei Gleichstand: kleinerer globalIdx gewinnt (für Determinismus)
    if (!best || score > best.score || (score === best.score && globalIdx < best.globalIdx)) {
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
          emergencyFillProbability: results.emergencyFillProbability,
          emergencyNeverFillProbability: results.emergencyNeverFillProbability,
          emergencyMedianFillYears: results.emergencyMedianFillYears,
        },
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
      // Legacy: Vollständige Optimierung (generiert Kandidaten selbst)
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
