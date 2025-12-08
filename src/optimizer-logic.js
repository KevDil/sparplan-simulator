/**
 * ETF Simulator - Optimizer-Logik
 * Version 2.0
 * 
 * Zentrale Definitionen für Grid-Suche, Kandidatengenerierung und Scoring.
 * Diese Logik wird vom Optimizer-Worker verwendet.
 */

// ============ KONSTANTEN ============

/** Standard-Iterationen für Optimierung (Balance: Speed vs. Genauigkeit) */
export const DEFAULT_ITERATIONS_OPTIMIZE = 1000;

/** Hartes Limit für Optimierungs-Iterationen */
export const MAX_ITERATIONS_OPTIMIZE = 2000;

// ============ HILFSFUNKTIONEN ============

/**
 * Begrenzt einen Wert auf ein Intervall
 * @param {number} value - Wert
 * @param {number} min - Minimum
 * @param {number} max - Maximum
 * @returns {number} Begrenzter Wert
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// ============ GRID-GENERIERUNG ============

/**
 * Generiert Kandidaten für Modus A: Budget fix, Rente maximieren.
 * Unterstützt sowohl EUR-Modus (feste Beträge) als auch Percent-Modus (prozentuale Entnahme).
 * 
 * @param {Object} baseParams - Ausgangsparameter
 * @param {Object} gridConfig - Grid-Konfiguration
 * @returns {Array} Array von Kandidaten-Parametern
 */
export function generateCandidatesModeA(baseParams, gridConfig) {
  const candidates = [];
  
  const {
    maxBudget = (baseParams.monthly_savings || 0) + (baseParams.monthly_etf || 0),
    tgStep = 50,
    rentStep = 50,
    rentStepPercent = 0.25,
    rentRange = 0.5,
    maxCombinations = 60
  } = gridConfig;
  
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
    
    const percentValues = [];
    for (let pct = percentMin; pct <= percentMax; pct += rentStepPercent) {
      percentValues.push(Math.round(pct * 100) / 100);
    }
    
    for (const tg of tgValues) {
      const etf = maxBudget - tg;
      if (etf < 0) continue;
      
      for (const pct of percentValues) {
        candidates.push({
          ...baseParams,
          monthly_savings: tg,
          monthly_etf: etf,
          monthly_payout_percent: pct,
          monthly_payout_net: null,
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
    
    const rentValues = [];
    for (let rent = rentMin; rent <= rentMax; rent += rentStep) {
      rentValues.push(Math.round(rent));
    }
    
    for (const tg of tgValues) {
      const etf = maxBudget - tg;
      if (etf < 0) continue;
      
      for (const rent of rentValues) {
        candidates.push({
          ...baseParams,
          monthly_savings: tg,
          monthly_etf: etf,
          monthly_payout_net: rent,
          monthly_payout_percent: null,
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
 * Generiert Kandidaten für Modus B: Zielrente fix, Sparrate minimieren.
 * 
 * @param {Object} baseParams - Ausgangsparameter
 * @param {Object} gridConfig - Grid-Konfiguration
 * @returns {Array} Array von Kandidaten-Parametern
 */
export function generateCandidatesModeB(baseParams, gridConfig) {
  const candidates = [];
  
  const {
    maxBudget = (baseParams.monthly_savings || 0) + (baseParams.monthly_etf || 0),
    budgetStep = 25,
    budgetRange = 0.5,
    maxCombinations = 60
  } = gridConfig;
  
  const budgetMin = Math.max(50, maxBudget * (1 - budgetRange));
  const budgetMax = maxBudget * (1 + budgetRange);
  
  for (let budget = budgetMin; budget <= budgetMax; budget += budgetStep) {
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
 * Generiert Kandidaten basierend auf Optimierungsmodus.
 * 
 * @param {Object} baseParams - Ausgangsparameter
 * @param {string} mode - Modus ('A'/'budget_fix' oder 'B'/'rent_fix')
 * @param {Object} gridConfig - Grid-Konfiguration
 * @returns {Array} Array von Kandidaten-Parametern
 */
export function generateCandidates(baseParams, mode, gridConfig) {
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

// ============ NOTGROSCHEN-BEWERTUNG ============

/**
 * Erstellt Notgroschen-Bewertungskonfiguration aus Grid-Config.
 * 
 * @param {Object} gridConfig - Grid-Konfiguration
 * @returns {Object} Notgroschen-Konfiguration
 */
export function buildEmergencyConfig(gridConfig = {}) {
  return {
    weight: gridConfig.emergencyWeight ?? 4000,
    maxFillYears: gridConfig.emergencyMaxYears ?? 10,
    minFillProbability: gridConfig.minFillProbability ?? 0,
    hardMinFill: gridConfig.hardMinFill ?? false,
    minFillPenalty: gridConfig.minFillPenalty ?? 1e6,
  };
}

/**
 * Bewertet die Notgroschen-Erreichung eines Kandidaten.
 * 
 * @param {Object} candidate - Kandidaten-Parameter
 * @param {Object} results - MC-Ergebnisse
 * @param {Object} emergencyConfig - Notgroschen-Konfiguration
 * @returns {Object} Bewertungsergebnis
 */
export function evaluateEmergency(candidate, results, emergencyConfig) {
  const target = candidate.savings_target ?? 0;
  const hasEmergencyGoal = target > 0;
  const fillProb = results.emergencyFillProbability ?? 0;
  const medianFillYears = results.emergencyMedianFillYears;
  const weight = emergencyConfig?.weight ?? 4000;
  const maxYears = emergencyConfig?.maxFillYears ?? 10;
  const minFillProb = emergencyConfig?.minFillProbability ?? 0;
  const minFillPenalty = emergencyConfig?.minFillPenalty ?? 1e6;
  const hardMinFill = emergencyConfig?.hardMinFill ?? false;

  // Disqualifikation: Notgroschen-Ziel nie erreicht
  if (hasEmergencyGoal && fillProb === 0) {
    return { disqualify: true, contribution: -Infinity, fillProb, medianFillYears };
  }

  // Penalty: Minimale Füllwahrscheinlichkeit nicht erreicht
  let penalty = 0;
  if (hasEmergencyGoal && minFillProb > 0 && fillProb < minFillProb) {
    if (hardMinFill) {
      return { disqualify: true, contribution: -Infinity, fillProb, medianFillYears };
    }
    penalty = minFillPenalty;
  }

  // Qualitätsfaktor: 60% Füllwahrscheinlichkeit + 40% Füllgeschwindigkeit
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
 * Berechnet Score für einen Kandidaten (Modus A: Budget fix, Rente maximieren).
 * Unterstützt sowohl EUR-Modus als auch Percent-Modus.
 * 
 * Scoring-Logik:
 * - Harte Bedingung: successRate >= targetSuccess, sonst -Infinity
 * - Hauptziel: Hohe Rente (EUR oder Prozent)
 * - Sekundärziel 1: Hohes Median-Endvermögen real (Gewicht: 1/10000)
 * - Sekundärziel 2: Niedriges Ruin-Risiko (Gewicht: -2)
 * - Notgroschen-Bonus nach emergencyConfig
 * 
 * @param {Object} candidate - Kandidaten-Parameter
 * @param {Object} results - MC-Ergebnisse
 * @param {number} targetSuccess - Ziel-Erfolgswahrscheinlichkeit (%)
 * @param {Object} emergencyConfig - Notgroschen-Konfiguration
 * @returns {number} Score
 */
export function scoreCandidate(candidate, results, targetSuccess = 90, emergencyConfig) {
  // Harte Bedingung: Mindestsuccess
  if (results.successRate < targetSuccess) {
    return -Infinity;
  }

  const emergencyEval = evaluateEmergency(candidate, results, emergencyConfig);
  if (emergencyEval.disqualify) {
    return -Infinity;
  }
  
  const medianEndReal = results.medianEndReal || 0;
  const ruinProbability = results.ruinProbability || 0;
  
  let score = 0;
  
  const isPercentMode = candidate.rent_mode === 'percent' || 
    (candidate.monthly_payout_percent != null && candidate.monthly_payout_percent > 0);
  
  if (isPercentMode) {
    // Percent-Modus: Höherer Prozentsatz = besser
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
 * Berechnet Score für Modus B (Sparrate minimieren bei fixer Zielrente).
 * 
 * @param {Object} candidate - Kandidaten-Parameter
 * @param {Object} results - MC-Ergebnisse
 * @param {number} targetSuccess - Ziel-Erfolgswahrscheinlichkeit (%)
 * @param {Object} emergencyConfig - Notgroschen-Konfiguration
 * @returns {number} Score
 */
export function scoreCandidateModeB(candidate, results, targetSuccess = 90, emergencyConfig) {
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

/**
 * Wählt die richtige Scoring-Funktion basierend auf dem Modus.
 * 
 * @param {string} mode - Optimierungsmodus
 * @returns {Function} Scoring-Funktion
 */
export function getScoringFunction(mode) {
  if (mode === 'B' || mode === 'rent_fix') {
    return scoreCandidateModeB;
  }
  return scoreCandidate;
}

/**
 * Extrahiert relevante Ergebnisse für die Optimierung aus MC-Ergebnissen.
 * 
 * @param {Object} results - Vollständige MC-Ergebnisse
 * @returns {Object} Reduzierte Ergebnisse für Speicherung
 */
export function extractOptimizationResults(results) {
  return {
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
  };
}
