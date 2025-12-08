/**
 * ETF Simulator - Monte-Carlo Pfad-Metriken
 * Version 2.0
 * 
 * Zentrale Definitionen für Success/Ruin/Shortfall/Notgroschen-Metriken
 * pro Monte-Carlo-Pfad. Diese Logik wird sowohl vom Worker als auch
 * von der Haupt-Analyse verwendet.
 */

import { MONTHS_PER_YEAR } from './constants.js';

// ============ KONSTANTEN ============

/** 
 * Standard-Schwellenwert für "Erfolg": Endvermögen > X € (inflationsbereinigt)
 * Wird überschrieben durch dynamische Berechnung basierend auf Entnahme (12 Monate)
 */
export const DEFAULT_SUCCESS_THRESHOLD_REAL = 100;

/** Anzahl Monate Entnahme als dynamische Erfolgsschwelle */
export const SUCCESS_THRESHOLD_MONTHS = 12;

/** Standard-Schwellenwert für "Ruin": Vermögen < X% des Rentenbeginn-Vermögens */
export const DEFAULT_RUIN_THRESHOLD_PERCENT = 10;

/** Relative Toleranz für Shortfalls (1% der angeforderten Entnahme) */
export const SHORTFALL_TOLERANCE_PERCENT = 0.01;

/** Absolute Toleranz für Shortfalls (50 €) */
export const SHORTFALL_TOLERANCE_ABS = 50;

// ============ PFAD-EXTRAKTION ============

/**
 * Extrahiert Sim-Ergebnisse für Success/Shortfall/Ruin-Berechnung aus einer History.
 * Diese Funktion ist die zentrale Definition der Erfolgs-/Ruinkriterien.
 * 
 * @param {Array} history - Simulation History (Array von Monats-Zeilen)
 * @param {Object} params - Simulationsparameter
 * @param {Object} mcOptions - Monte-Carlo-Optionen
 * @param {number} [savingsMonthsOverride] - Optional: Anzahl Sparmonate (sonst berechnet)
 * @param {number} [numMonthsOverride] - Optional: Gesamtmonate (sonst berechnet)
 * @param {number} [savingsTargetOverride] - Optional: Notgroschen-Ziel (sonst aus params)
 * @returns {Object} Extrahierte Metriken
 */
export function extractSimResult(history, params, mcOptions = {}, savingsMonthsOverride = null, numMonthsOverride = null, savingsTargetOverride = null) {
  const savingsMonths = savingsMonthsOverride ?? (params.savings_years * MONTHS_PER_YEAR);
  const numMonths = numMonthsOverride ?? ((params.savings_years + params.withdrawal_years) * MONTHS_PER_YEAR);
  const savingsTarget = savingsTargetOverride ?? (params.savings_target ?? 0);
  
  // Dynamische Erfolgsschwelle: 12× monatliche Entnahme oder expliziter Wert
  const monthlyPayout = params.monthly_payout_net || 0;
  const dynamicThreshold = monthlyPayout > 0 ? monthlyPayout * SUCCESS_THRESHOLD_MONTHS : DEFAULT_SUCCESS_THRESHOLD_REAL;
  const SUCCESS_THRESHOLD_REAL = mcOptions.successThreshold ?? dynamicThreshold;
  const RUIN_THRESHOLD_PERCENT = (mcOptions.ruinThresholdPercent ?? DEFAULT_RUIN_THRESHOLD_PERCENT) / 100;
  
  const lastRow = history[history.length - 1];
  const endWealth = lastRow?.total || 0;
  const endInflation = lastRow?.cumulative_inflation || 1;
  const successThresholdNominal = SUCCESS_THRESHOLD_REAL * endInflation;
  const hasPositiveEnd = endWealth > successThresholdNominal;
  
  // Emergency-Fill-Tracking: Erster Monat, in dem Notgroschen-Ziel erreicht wurde
  let firstFillMonth = null;
  if (savingsTarget <= 0) {
    firstFillMonth = 0; // Kein Ziel = sofort erfüllt
  } else {
    for (let m = 0; m < Math.min(numMonths, history.length); m++) {
      if ((history[m]?.savings || 0) >= savingsTarget) {
        firstFillMonth = history[m]?.month ?? (m + 1);
        break;
      }
    }
  }
  
  // Shortfall-Tracking: Prüfung ob Zahlungen nicht vollständig erfüllt wurden
  let hasAnsparShortfall = false;
  let hasEntnahmeShortfall = false;
  
  // Ansparphase: Shortfalls prüfen (z.B. Steuer auf Vorabpauschale nicht bezahlbar)
  for (let m = 0; m < savingsMonths && m < numMonths && m < history.length; m++) {
    if ((history[m]?.shortfall || 0) > SHORTFALL_TOLERANCE_ABS || 
        (history[m]?.tax_shortfall || 0) > SHORTFALL_TOLERANCE_ABS) {
      hasAnsparShortfall = true;
      break;
    }
  }
  
  // Entnahmephase: Shortfalls prüfen (Entnahme nicht vollständig möglich)
  for (let m = savingsMonths; m < numMonths && m < history.length; m++) {
    const requested = history[m]?.withdrawal_requested || 0;
    const shortfall = history[m]?.shortfall || 0;
    const taxShortfall = history[m]?.tax_shortfall || 0;
    const tolerance = Math.max(SHORTFALL_TOLERANCE_ABS, requested * SHORTFALL_TOLERANCE_PERCENT);
    
    if (shortfall > tolerance || taxShortfall > tolerance) {
      hasEntnahmeShortfall = true;
      break;
    }
  }
  
  // Ruin-Tracking: Vermögen unter kritischem Schwellenwert
  let isRuin = false;
  const retirementIdx = Math.min(savingsMonths - 1, numMonths - 1);
  const retirementWealth = history[retirementIdx]?.total || 0;
  const ruinThreshold = retirementWealth * RUIN_THRESHOLD_PERCENT;
  
  for (let m = savingsMonths; m < numMonths && m < history.length; m++) {
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
  
  // Kapitalerhalt: Endvermögen >= Rentenbeginvermögen?
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
 * Extrahiert SoRR-Daten (Sequence-of-Returns-Risk) für spätere Aggregation.
 * Berechnet frühe Renditen und deren Auswirkung auf das Endvermögen.
 * 
 * @param {Array} history - Simulation History
 * @param {Object} params - Simulationsparameter
 * @param {number} [savingsMonthsOverride] - Optional: Anzahl Sparmonate
 * @param {number} [numMonthsOverride] - Optional: Gesamtmonate
 * @returns {Object} SoRR-Daten { startWealth, earlyReturn, endWealth }
 */
export function extractSorrData(history, params, savingsMonthsOverride = null, numMonthsOverride = null) {
  const savingsMonths = savingsMonthsOverride ?? (params.savings_years * MONTHS_PER_YEAR);
  const numMonths = numMonthsOverride ?? ((params.savings_years + params.withdrawal_years) * MONTHS_PER_YEAR);
  
  const earlyYears = Math.min(5, params.withdrawal_years);
  const earlyMonths = earlyYears * 12;
  const startWealth = history[savingsMonths - 1]?.total || history[savingsMonths]?.total || 0;
  
  // TWR (Time-Weighted Return) für die ersten Jahre der Entnahmephase
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

/**
 * Extrahiert monatliche Daten aus einer History für Perzentil-Berechnung
 * 
 * @param {Array} history - Simulation History
 * @param {number} numMonths - Anzahl Monate
 * @returns {Object} { monthlyTotals: number[], monthlyTotalsReal: number[] }
 */
export function extractMonthlyData(history, numMonths) {
  const monthlyTotals = [];
  const monthlyTotalsReal = [];
  
  for (let m = 0; m < numMonths && m < history.length; m++) {
    monthlyTotals.push(history[m]?.total || 0);
    monthlyTotalsReal.push(history[m]?.total_real || 0);
  }
  
  return { monthlyTotals, monthlyTotalsReal };
}

/**
 * Extrahiert Endvermögen-Daten aus einer History
 * 
 * @param {Array} history - Simulation History
 * @param {number} retirementIdx - Index des Rentenbeginns
 * @returns {Object} Endvermögen-Daten
 */
export function extractEndData(history, retirementIdx) {
  const lastRow = history[history.length - 1];
  const retirementRow = history[retirementIdx];
  
  return {
    finalTotal: lastRow?.total || 0,
    finalTotalReal: lastRow?.total_real || 0,
    finalLossPot: lastRow?.loss_pot || 0,
    finalYearlyFreibetrag: lastRow?.yearly_used_freibetrag || 0,
    retirementTotal: retirementRow?.total || 0,
    retirementTotalReal: retirementRow?.total_real || 0,
  };
}
