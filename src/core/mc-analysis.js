/**
 * ETF Simulator - Monte-Carlo Analyse
 * Version 2.0
 * 
 * Funktionen zur Analyse von Monte-Carlo-Ergebnissen
 */

import { MONTHS_PER_YEAR } from './constants.js';
import { percentile } from './simulation-core.js';

/**
 * Analysiert Monte-Carlo-Ergebnisse
 */
export function analyzeMonteCarloResults(allHistories, params, mcOptions = {}) {
  const numMonths = allHistories[0]?.length || 0;
  const numSims = allHistories.length;
  const savingsMonths = params.savings_years * MONTHS_PER_YEAR;
  const savingsTarget = params.savings_target ?? 0;
  
  // Dynamische Erfolgsschwelle: 12× monatliche Entnahme oder expliziter Wert
  const monthlyPayout = params.monthly_payout_net || 0;
  const dynamicThreshold = monthlyPayout > 0 ? monthlyPayout * 12 : 100;
  const SUCCESS_THRESHOLD_REAL = mcOptions.successThreshold ?? dynamicThreshold;
  const RUIN_THRESHOLD_PERCENT = (mcOptions.ruinThresholdPercent ?? 10) / 100;
  
  // Sammel-Arrays
  const finalTotals = allHistories.map(h => h[h.length - 1]?.total || 0).sort((a, b) => a - b);
  const finalTotalsReal = allHistories.map(h => h[h.length - 1]?.total_real || 0).sort((a, b) => a - b);
  const finalLossPot = allHistories.map(h => h[h.length - 1]?.loss_pot || 0).sort((a, b) => a - b);
  const finalYearlyFreibetrag = allHistories.map(h => h[h.length - 1]?.yearly_used_freibetrag || 0).sort((a, b) => a - b);
  
  const retirementIdx = Math.min(savingsMonths - 1, numMonths - 1);
  const retirementTotals = allHistories.map(h => h[retirementIdx]?.total || 0).sort((a, b) => a - b);
  const retirementTotalsReal = allHistories.map(h => h[retirementIdx]?.total_real || 0).sort((a, b) => a - b);
  
  // Entnahme-Statistiken
  const avgWithdrawalsNet = [];
  const avgWithdrawalsNetReal = [];
  const avgWithdrawalsGross = [];
  const avgWithdrawalsGrossReal = [];
  const totalWithdrawalsNet = [];
  const totalWithdrawalsNetReal = [];
  const totalWithdrawalsGross = [];
  const totalWithdrawalsGrossReal = [];
  
  for (const history of allHistories) {
    const entnahmeRows = history.filter(r => r.phase === "Entnahme" && ((r.withdrawal || 0) > 0 || (r.withdrawal_net || 0) > 0));
    if (entnahmeRows.length > 0) {
      avgWithdrawalsGross.push(entnahmeRows.reduce((s, r) => s + (r.withdrawal || 0), 0) / entnahmeRows.length);
      avgWithdrawalsGrossReal.push(entnahmeRows.reduce((s, r) => s + (r.withdrawal_real || 0), 0) / entnahmeRows.length);
      avgWithdrawalsNet.push(entnahmeRows.reduce((s, r) => s + (r.withdrawal_net || 0), 0) / entnahmeRows.length);
      avgWithdrawalsNetReal.push(entnahmeRows.reduce((s, r) => s + (r.withdrawal_net_real || 0), 0) / entnahmeRows.length);
      totalWithdrawalsGross.push(history.reduce((s, r) => s + (r.withdrawal || 0), 0));
      totalWithdrawalsGrossReal.push(history.reduce((s, r) => s + (r.withdrawal_real || 0), 0));
      totalWithdrawalsNet.push(history.reduce((s, r) => s + (r.withdrawal_net || 0), 0));
      totalWithdrawalsNetReal.push(history.reduce((s, r) => s + (r.withdrawal_net_real || 0), 0));
    }
  }
  
  avgWithdrawalsNet.sort((a, b) => a - b);
  avgWithdrawalsNetReal.sort((a, b) => a - b);
  avgWithdrawalsGross.sort((a, b) => a - b);
  avgWithdrawalsGrossReal.sort((a, b) => a - b);
  totalWithdrawalsNet.sort((a, b) => a - b);
  totalWithdrawalsNetReal.sort((a, b) => a - b);
  totalWithdrawalsGross.sort((a, b) => a - b);
  totalWithdrawalsGrossReal.sort((a, b) => a - b);
  
  // Erfolgs-/Ruin-Berechnung
  let successCount = 0;
  let softSuccessCount = 0;
  let ruinCount = 0;
  let capitalPreservedCount = 0;
  let capitalPreservedRealCount = 0;
  let ansparShortfallCount = 0;
  let entnahmeShortfallCount = 0;
  const emergencyFillMonths = [];
  
  // MC-Erweiterte Risiken: Tracking
  let pathsWithExtraExpenses = 0;
  let pathsWithSavingShocks = 0;
  const avgInflationRates = [];
  let totalExtraExpenses = 0;
  
  const SHORTFALL_TOLERANCE_PERCENT = 0.01;
  const SHORTFALL_TOLERANCE_ABS = 50;
  
  for (const history of allHistories) {
    const lastRow = history[history.length - 1];
    const endWealth = lastRow?.total || 0;
    const endInflation = lastRow?.cumulative_inflation || 1;
    const successThresholdNominal = SUCCESS_THRESHOLD_REAL * endInflation;
    const hasPositiveEnd = endWealth > successThresholdNominal;
    
    const retirementRow = history[retirementIdx];
    const retirementWealth = retirementRow?.total || 0;
    const retirementWealthReal = retirementRow?.total_real || 0;
    const endWealthReal = lastRow?.total_real || 0;
    
    // Emergency Fill
    let firstFillMonth = null;
    if (savingsTarget <= 0) {
      firstFillMonth = 0;
    } else {
      for (let m = 0; m < numMonths && m < history.length; m++) {
        if ((history[m]?.savings || 0) >= savingsTarget) {
          firstFillMonth = history[m]?.month ?? (m + 1);
          break;
        }
      }
    }
    if (firstFillMonth !== null) {
      emergencyFillMonths.push(firstFillMonth / 12);
    }
    
    // Shortfall-Tracking
    let hasAnsparShortfall = false;
    let hasEntnahmeShortfall = false;
    
    for (let m = 0; m < savingsMonths && m < numMonths && m < history.length; m++) {
      if ((history[m]?.shortfall || 0) > SHORTFALL_TOLERANCE_ABS || 
          (history[m]?.tax_shortfall || 0) > SHORTFALL_TOLERANCE_ABS) {
        hasAnsparShortfall = true;
        break;
      }
    }
    
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
    
    if (hasAnsparShortfall) ansparShortfallCount++;
    if (hasEntnahmeShortfall) entnahmeShortfallCount++;
    
    // Ruin-Tracking
    let isRuin = false;
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
    
    if (isRuin) ruinCount++;
    
    // Erfolg: Nur wenn kein Ruin aufgetreten ist
    if (hasPositiveEnd && !hasEntnahmeShortfall && !isRuin) successCount++;
    if (hasPositiveEnd && !isRuin) softSuccessCount++;
    
    // Kapitalerhalt
    if (endWealth >= retirementWealth) capitalPreservedCount++;
    if (endWealthReal >= retirementWealthReal) capitalPreservedRealCount++;
    
    // MC-Erweiterte Risiken: Tracking für diesen Pfad
    let hasExtraExpense = false;
    let hasSavingShock = false;
    let sumInflationRates = 0;
    let inflationCount = 0;
    let pathExtraExpenses = 0;
    
    for (const row of history) {
      if ((row.extra_expense || 0) > 0) {
        hasExtraExpense = true;
        pathExtraExpenses += row.extra_expense;
      }
      if ((row.saving_shock_factor || 1) < 1) {
        hasSavingShock = true;
      }
      if (row.inflation_rate_year !== undefined) {
        sumInflationRates += row.inflation_rate_year;
        inflationCount++;
      }
    }
    
    if (hasExtraExpense) pathsWithExtraExpenses++;
    if (hasSavingShock) pathsWithSavingShocks++;
    if (inflationCount > 0) avgInflationRates.push(sumInflationRates / inflationCount);
    totalExtraExpenses += pathExtraExpenses;
  }
  
  // Perzentile pro Monat
  const months = [];
  const percentiles = { p5: [], p10: [], p25: [], p50: [], p75: [], p90: [], p95: [] };
  const percentilesReal = { p5: [], p10: [], p25: [], p50: [], p75: [], p90: [], p95: [] };
  
  for (let m = 0; m < numMonths; m++) {
    months.push(m + 1);
    const monthTotals = allHistories.map(h => h[m]?.total || 0).sort((a, b) => a - b);
    const monthTotalsReal = allHistories.map(h => h[m]?.total_real || 0).sort((a, b) => a - b);
    
    percentiles.p5.push(percentile(monthTotals, 5));
    percentiles.p10.push(percentile(monthTotals, 10));
    percentiles.p25.push(percentile(monthTotals, 25));
    percentiles.p50.push(percentile(monthTotals, 50));
    percentiles.p75.push(percentile(monthTotals, 75));
    percentiles.p90.push(percentile(monthTotals, 90));
    percentiles.p95.push(percentile(monthTotals, 95));
    
    percentilesReal.p5.push(percentile(monthTotalsReal, 5));
    percentilesReal.p10.push(percentile(monthTotalsReal, 10));
    percentilesReal.p25.push(percentile(monthTotalsReal, 25));
    percentilesReal.p50.push(percentile(monthTotalsReal, 50));
    percentilesReal.p75.push(percentile(monthTotalsReal, 75));
    percentilesReal.p90.push(percentile(monthTotalsReal, 90));
    percentilesReal.p95.push(percentile(monthTotalsReal, 95));
  }
  
  // SoRR-Analyse
  const sorr = analyzeSoRR(allHistories, params);
  
  // Emergency Fill Stats
  emergencyFillMonths.sort((a, b) => a - b);
  const emergencyFillProbability = (emergencyFillMonths.length / numSims) * 100;
  const emergencyMedianFillYears = emergencyFillMonths.length > 0 
    ? percentile(emergencyFillMonths, 50) 
    : null;
  
  return {
    iterations: numSims,
    months,
    percentiles,
    percentilesReal,
    savingsYears: params.savings_years,
    
    // Endvermögen nominal
    medianEnd: percentile(finalTotals, 50),
    meanEnd: finalTotals.reduce((a, b) => a + b, 0) / numSims,
    p5End: percentile(finalTotals, 5),
    p10End: percentile(finalTotals, 10),
    p25End: percentile(finalTotals, 25),
    p75End: percentile(finalTotals, 75),
    p90End: percentile(finalTotals, 90),
    p95End: percentile(finalTotals, 95),
    
    // Endvermögen real
    medianEndReal: percentile(finalTotalsReal, 50),
    meanEndReal: finalTotalsReal.reduce((a, b) => a + b, 0) / numSims,
    p5EndReal: percentile(finalTotalsReal, 5),
    p10EndReal: percentile(finalTotalsReal, 10),
    p25EndReal: percentile(finalTotalsReal, 25),
    p75EndReal: percentile(finalTotalsReal, 75),
    p90EndReal: percentile(finalTotalsReal, 90),
    p95EndReal: percentile(finalTotalsReal, 95),
    
    // Rentenbeginn
    retirementMedian: percentile(retirementTotals, 50),
    retirementMedianReal: percentile(retirementTotalsReal, 50),
    
    // Entnahmen
    medianAvgWithdrawalNet: avgWithdrawalsNet.length > 0 ? percentile(avgWithdrawalsNet, 50) : 0,
    medianAvgWithdrawalNetReal: avgWithdrawalsNetReal.length > 0 ? percentile(avgWithdrawalsNetReal, 50) : 0,
    medianAvgWithdrawalGross: avgWithdrawalsGross.length > 0 ? percentile(avgWithdrawalsGross, 50) : 0,
    medianAvgWithdrawalGrossReal: avgWithdrawalsGrossReal.length > 0 ? percentile(avgWithdrawalsGrossReal, 50) : 0,
    medianTotalWithdrawalNet: totalWithdrawalsNet.length > 0 ? percentile(totalWithdrawalsNet, 50) : 0,
    medianTotalWithdrawalNetReal: totalWithdrawalsNetReal.length > 0 ? percentile(totalWithdrawalsNetReal, 50) : 0,
    medianTotalWithdrawalGross: totalWithdrawalsGross.length > 0 ? percentile(totalWithdrawalsGross, 50) : 0,
    medianTotalWithdrawalGrossReal: totalWithdrawalsGrossReal.length > 0 ? percentile(totalWithdrawalsGrossReal, 50) : 0,
    
    // Raten
    successRate: (successCount / numSims) * 100,
    softSuccessRate: (softSuccessCount / numSims) * 100,
    ruinProbability: (ruinCount / numSims) * 100,
    capitalPreservationRate: (capitalPreservedCount / numSims) * 100,
    capitalPreservationRateReal: (capitalPreservedRealCount / numSims) * 100,
    ansparShortfallRate: (ansparShortfallCount / numSims) * 100,
    entnahmeShortfallRate: (entnahmeShortfallCount / numSims) * 100,
    
    // Notgroschen
    emergencyFillProbability,
    emergencyNeverFillProbability: 100 - emergencyFillProbability,
    emergencyMedianFillYears,
    
    // Verlusttopf / Freibetrag
    medianFinalLossPot: percentile(finalLossPot, 50),
    medianFinalYearlyFreibetrag: percentile(finalYearlyFreibetrag, 50),
    
    // SoRR
    sorr,
    
    // MC-Erweiterte Risiken: Statistiken
    pathsWithExtraExpensesRate: (pathsWithExtraExpenses / numSims) * 100,
    pathsWithSavingShocksRate: (pathsWithSavingShocks / numSims) * 100,
    medianAvgInflationRate: avgInflationRates.length > 0 ? percentile(avgInflationRates.sort((a, b) => a - b), 50) : null,
    avgExtraExpensePerPath: numSims > 0 ? totalExtraExpenses / numSims : 0,
    
    // MC-Optionen (für Export)
    mcOptions,
  };
}

/**
 * Analysiert Sequence-of-Returns Risk
 */
function analyzeSoRR(allHistories, params) {
  const numSims = allHistories.length;
  const savingsMonths = params.savings_years * MONTHS_PER_YEAR;
  const numMonths = (params.savings_years + params.withdrawal_years) * MONTHS_PER_YEAR;
  const earlyYears = Math.min(5, params.withdrawal_years);
  const earlyMonths = earlyYears * 12;
  
  const sorrData = [];
  
  for (const history of allHistories) {
    if (history.length < savingsMonths) continue;
    
    const startWealth = history[savingsMonths - 1]?.total || history[savingsMonths]?.total || 0;
    if (startWealth <= 0) continue;
    
    // TWR für frühe Jahre berechnen
    let twrProduct = 1;
    const earlyEndIdx = Math.min(savingsMonths + earlyMonths - 1, numMonths - 1, history.length - 1);
    
    for (let m = savingsMonths; m <= earlyEndIdx; m++) {
      const monthlyReturn = history[m]?.portfolioReturn || history[m]?.etfReturn || 1;
      twrProduct *= monthlyReturn;
    }
    
    const actualMonths = earlyEndIdx - savingsMonths + 1;
    const earlyReturn = actualMonths > 0 ? Math.pow(twrProduct, 12 / actualMonths) - 1 : 0;
    const endWealth = history[history.length - 1]?.total || 0;
    
    sorrData.push({ startWealth, earlyReturn, endWealth });
  }
  
  if (sorrData.length < 10) {
    return {
      sorRiskScore: 0,
      earlyBadImpact: 0,
      earlyGoodImpact: 0,
      correlationEarlyReturns: 0,
      worstSequenceEnd: 0,
      bestSequenceEnd: 0,
      vulnerabilityWindow: earlyYears,
    };
  }
  
  // Nach früher Rendite sortieren
  sorrData.sort((a, b) => a.earlyReturn - b.earlyReturn);
  
  const quintileSize = Math.floor(sorrData.length / 5);
  const worstQuintile = sorrData.slice(0, quintileSize);
  const bestQuintile = sorrData.slice(-quintileSize);
  
  const avgEndAll = sorrData.reduce((s, d) => s + d.endWealth, 0) / sorrData.length;
  const avgEndWorst = worstQuintile.reduce((s, d) => s + d.endWealth, 0) / worstQuintile.length;
  const avgEndBest = bestQuintile.reduce((s, d) => s + d.endWealth, 0) / bestQuintile.length;
  const avgStartWealth = sorrData.reduce((s, d) => s + d.startWealth, 0) / sorrData.length;
  
  const earlyBadImpact = avgStartWealth > 0 ? ((avgEndAll - avgEndWorst) / avgStartWealth) * 100 : 0;
  const earlyGoodImpact = avgStartWealth > 0 ? ((avgEndBest - avgEndAll) / avgStartWealth) * 100 : 0;
  const sorRiskScore = earlyBadImpact + earlyGoodImpact;
  
  // Korrelation berechnen
  const n = sorrData.length;
  const sumX = sorrData.reduce((s, d) => s + d.earlyReturn, 0);
  const sumY = sorrData.reduce((s, d) => s + d.endWealth, 0);
  const sumXY = sorrData.reduce((s, d) => s + d.earlyReturn * d.endWealth, 0);
  const sumX2 = sorrData.reduce((s, d) => s + d.earlyReturn * d.earlyReturn, 0);
  const sumY2 = sorrData.reduce((s, d) => s + d.endWealth * d.endWealth, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  const correlation = denominator > 0 ? numerator / denominator : 0;
  
  return {
    sorRiskScore: Math.abs(sorRiskScore),
    earlyBadImpact,
    earlyGoodImpact,
    correlationEarlyReturns: correlation,
    worstSequenceEnd: avgEndWorst,
    bestSequenceEnd: avgEndBest,
    vulnerabilityWindow: earlyYears,
  };
}

/**
 * Aggregiert Rohdaten von mehreren Workers
 */
export function aggregateChunkResults(chunks, params, mcOptions) {
  const numMonths = (params.savings_years + params.withdrawal_years) * MONTHS_PER_YEAR;
  
  // Sammel-Arrays
  const allFinalTotals = [];
  const allFinalTotalsReal = [];
  const allFinalLossPot = [];
  const allFinalYearlyFreibetrag = [];
  const allRetirementTotals = [];
  const allRetirementTotalsReal = [];
  const allSimResults = [];
  const allSorrData = [];
  const allSamplePaths = [];
  
  // Per-Monat-Daten
  const monthlyTotals = Array(numMonths).fill(null).map(() => []);
  const monthlyTotalsReal = Array(numMonths).fill(null).map(() => []);
  
  for (const chunk of chunks) {
    const { rawData, samplePaths } = chunk;
    
    allFinalTotals.push(...rawData.finalTotals);
    allFinalTotalsReal.push(...rawData.finalTotalsReal);
    allFinalLossPot.push(...rawData.finalLossPot);
    allFinalYearlyFreibetrag.push(...rawData.finalYearlyFreibetrag);
    allRetirementTotals.push(...rawData.retirementTotals);
    allRetirementTotalsReal.push(...rawData.retirementTotalsReal);
    allSimResults.push(...rawData.simResults);
    allSorrData.push(...rawData.sorrData);
    
    if (allSamplePaths.length < 50) {
      allSamplePaths.push(...samplePaths.slice(0, 50 - allSamplePaths.length));
    }
    
    // Per-Monat-Daten zusammenführen
    for (let m = 0; m < numMonths && m < rawData.monthlyTotals.length; m++) {
      monthlyTotals[m].push(...rawData.monthlyTotals[m]);
      monthlyTotalsReal[m].push(...rawData.monthlyTotalsReal[m]);
    }
  }
  
  const numSims = allFinalTotals.length;
  
  // Sortieren für Perzentile
  allFinalTotals.sort((a, b) => a - b);
  allFinalTotalsReal.sort((a, b) => a - b);
  allFinalLossPot.sort((a, b) => a - b);
  allFinalYearlyFreibetrag.sort((a, b) => a - b);
  allRetirementTotals.sort((a, b) => a - b);
  allRetirementTotalsReal.sort((a, b) => a - b);
  
  // Erfolgs-/Ruin-Berechnung aus SimResults
  let successCount = 0;
  let softSuccessCount = 0;
  let ruinCount = 0;
  let capitalPreservedCount = 0;
  let capitalPreservedRealCount = 0;
  let ansparShortfallCount = 0;
  let entnahmeShortfallCount = 0;
  const emergencyFillYears = [];
  
  for (const result of allSimResults) {
    // Erfolg: Nur wenn kein Ruin aufgetreten ist
    if (result.hasPositiveEnd && !result.hasEntnahmeShortfall && !result.isRuin) successCount++;
    if (result.hasPositiveEnd && !result.isRuin) softSuccessCount++;
    if (result.isRuin) ruinCount++;
    if (result.capitalPreserved) capitalPreservedCount++;
    if (result.capitalPreservedReal) capitalPreservedRealCount++;
    if (result.hasAnsparShortfall) ansparShortfallCount++;
    if (result.hasEntnahmeShortfall) entnahmeShortfallCount++;
    if (result.firstFillMonth !== null) {
      emergencyFillYears.push(result.firstFillMonth / 12);
    }
  }
  
  emergencyFillYears.sort((a, b) => a - b);
  
  // Perzentile pro Monat
  const months = [];
  const percentiles = { p5: [], p10: [], p25: [], p50: [], p75: [], p90: [], p95: [] };
  const percentilesReal = { p5: [], p10: [], p25: [], p50: [], p75: [], p90: [], p95: [] };
  
  for (let m = 0; m < numMonths; m++) {
    months.push(m + 1);
    const monthData = monthlyTotals[m].sort((a, b) => a - b);
    const monthDataReal = monthlyTotalsReal[m].sort((a, b) => a - b);
    
    percentiles.p5.push(percentile(monthData, 5));
    percentiles.p10.push(percentile(monthData, 10));
    percentiles.p25.push(percentile(monthData, 25));
    percentiles.p50.push(percentile(monthData, 50));
    percentiles.p75.push(percentile(monthData, 75));
    percentiles.p90.push(percentile(monthData, 90));
    percentiles.p95.push(percentile(monthData, 95));
    
    percentilesReal.p5.push(percentile(monthDataReal, 5));
    percentilesReal.p10.push(percentile(monthDataReal, 10));
    percentilesReal.p25.push(percentile(monthDataReal, 25));
    percentilesReal.p50.push(percentile(monthDataReal, 50));
    percentilesReal.p75.push(percentile(monthDataReal, 75));
    percentilesReal.p90.push(percentile(monthDataReal, 90));
    percentilesReal.p95.push(percentile(monthDataReal, 95));
  }
  
  // SoRR aus aggregierten Daten
  const sorr = aggregateSoRR(allSorrData);
  
  // Entnahme-Statistiken
  const avgWithdrawalsNet = allSimResults.map(r => r.avgWithdrawalNet).filter(v => v > 0).sort((a, b) => a - b);
  const avgWithdrawalsNetReal = allSimResults.map(r => r.avgWithdrawalNetReal).filter(v => v > 0).sort((a, b) => a - b);
  const totalWithdrawalsGross = allSimResults.map(r => r.totalWithdrawalGross).filter(v => v > 0).sort((a, b) => a - b);
  const totalWithdrawalsGrossReal = allSimResults.map(r => r.totalWithdrawalGrossReal).filter(v => v > 0).sort((a, b) => a - b);
  
  return {
    iterations: numSims,
    months,
    percentiles,
    percentilesReal,
    savingsYears: params.savings_years,
    
    // Endvermögen nominal
    medianEnd: percentile(allFinalTotals, 50),
    meanEnd: allFinalTotals.reduce((a, b) => a + b, 0) / numSims,
    p5End: percentile(allFinalTotals, 5),
    p10End: percentile(allFinalTotals, 10),
    p25End: percentile(allFinalTotals, 25),
    p75End: percentile(allFinalTotals, 75),
    p90End: percentile(allFinalTotals, 90),
    p95End: percentile(allFinalTotals, 95),
    
    // Endvermögen real
    medianEndReal: percentile(allFinalTotalsReal, 50),
    meanEndReal: allFinalTotalsReal.reduce((a, b) => a + b, 0) / numSims,
    p5EndReal: percentile(allFinalTotalsReal, 5),
    p10EndReal: percentile(allFinalTotalsReal, 10),
    p25EndReal: percentile(allFinalTotalsReal, 25),
    p75EndReal: percentile(allFinalTotalsReal, 75),
    p90EndReal: percentile(allFinalTotalsReal, 90),
    p95EndReal: percentile(allFinalTotalsReal, 95),
    
    // Rentenbeginn
    retirementMedian: percentile(allRetirementTotals, 50),
    retirementMedianReal: percentile(allRetirementTotalsReal, 50),
    
    // Entnahmen
    medianAvgWithdrawalNet: avgWithdrawalsNet.length > 0 ? percentile(avgWithdrawalsNet, 50) : 0,
    medianAvgWithdrawalNetReal: avgWithdrawalsNetReal.length > 0 ? percentile(avgWithdrawalsNetReal, 50) : 0,
    medianTotalWithdrawalGross: totalWithdrawalsGross.length > 0 ? percentile(totalWithdrawalsGross, 50) : 0,
    medianTotalWithdrawalGrossReal: totalWithdrawalsGrossReal.length > 0 ? percentile(totalWithdrawalsGrossReal, 50) : 0,
    
    // Raten
    successRate: (successCount / numSims) * 100,
    softSuccessRate: (softSuccessCount / numSims) * 100,
    ruinProbability: (ruinCount / numSims) * 100,
    capitalPreservationRate: (capitalPreservedCount / numSims) * 100,
    capitalPreservationRateReal: (capitalPreservedRealCount / numSims) * 100,
    ansparShortfallRate: (ansparShortfallCount / numSims) * 100,
    entnahmeShortfallRate: (entnahmeShortfallCount / numSims) * 100,
    
    // Notgroschen
    emergencyFillProbability: (emergencyFillYears.length / numSims) * 100,
    emergencyNeverFillProbability: ((numSims - emergencyFillYears.length) / numSims) * 100,
    emergencyMedianFillYears: emergencyFillYears.length > 0 ? percentile(emergencyFillYears, 50) : null,
    
    // Verlusttopf / Freibetrag
    medianFinalLossPot: percentile(allFinalLossPot, 50),
    medianFinalYearlyFreibetrag: percentile(allFinalYearlyFreibetrag, 50),
    
    // SoRR
    sorr,
    
    // Sample Paths für UI
    allHistories: allSamplePaths,
    
    // MC-Optionen
    mcOptions,
  };
}

/**
 * Aggregiert SoRR-Daten von mehreren Chunks
 */
function aggregateSoRR(allSorrData) {
  if (allSorrData.length < 10) {
    return {
      sorRiskScore: 0,
      earlyBadImpact: 0,
      earlyGoodImpact: 0,
      correlationEarlyReturns: 0,
      worstSequenceEnd: 0,
      bestSequenceEnd: 0,
      vulnerabilityWindow: 5,
    };
  }
  
  // Nach früher Rendite sortieren
  allSorrData.sort((a, b) => a.earlyReturn - b.earlyReturn);
  
  const quintileSize = Math.floor(allSorrData.length / 5);
  const worstQuintile = allSorrData.slice(0, quintileSize);
  const bestQuintile = allSorrData.slice(-quintileSize);
  
  const avgEndAll = allSorrData.reduce((s, d) => s + d.endWealth, 0) / allSorrData.length;
  const avgEndWorst = worstQuintile.reduce((s, d) => s + d.endWealth, 0) / worstQuintile.length;
  const avgEndBest = bestQuintile.reduce((s, d) => s + d.endWealth, 0) / bestQuintile.length;
  const avgStartWealth = allSorrData.reduce((s, d) => s + d.startWealth, 0) / allSorrData.length;
  
  const earlyBadImpact = avgStartWealth > 0 ? ((avgEndAll - avgEndWorst) / avgStartWealth) * 100 : 0;
  const earlyGoodImpact = avgStartWealth > 0 ? ((avgEndBest - avgEndAll) / avgStartWealth) * 100 : 0;
  const sorRiskScore = earlyBadImpact + earlyGoodImpact;
  
  // Korrelation berechnen
  const n = allSorrData.length;
  const sumX = allSorrData.reduce((s, d) => s + d.earlyReturn, 0);
  const sumY = allSorrData.reduce((s, d) => s + d.endWealth, 0);
  const sumXY = allSorrData.reduce((s, d) => s + d.earlyReturn * d.endWealth, 0);
  const sumX2 = allSorrData.reduce((s, d) => s + d.earlyReturn * d.earlyReturn, 0);
  const sumY2 = allSorrData.reduce((s, d) => s + d.endWealth * d.endWealth, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  const correlation = denominator > 0 ? numerator / denominator : 0;
  
  return {
    sorRiskScore: Math.abs(sorRiskScore),
    earlyBadImpact,
    earlyGoodImpact,
    correlationEarlyReturns: correlation,
    worstSequenceEnd: avgEndWorst,
    bestSequenceEnd: avgEndBest,
    vulnerabilityWindow: 5,
  };
}

// ============ TEXTUELLE ZUSAMMENFASSUNG ============

const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Generiert eine textuelle Zusammenfassung der MC-Ergebnisse
 * @param {Object} results - MC-Ergebnisse
 * @param {Object} params - Simulationsparameter
 * @returns {string} HTML-formatierte Zusammenfassung
 */
export function generateMcSummaryText(results, params) {
  if (!results) return '';
  
  const totalYears = params.savings_years + params.withdrawal_years;
  const successRate = results.successRate || 0;
  const ruinProb = results.ruinProbability || 0;
  const medianEndReal = results.medianEndReal || 0;
  const retirementMedian = results.retirementMedian || 0;
  const emergencyFillProb = results.emergencyFillProbability || 0;
  const emergencyFillYears = results.emergencyMedianFillYears;
  
  const lines = [];
  
  // Erfolgswahrscheinlichkeit
  if (successRate >= 95) {
    lines.push(`<strong>Sehr gute Aussichten:</strong> In ${nf1.format(successRate)}% der ${nf0.format(results.iterations)} Simulationen war dein Geld nach ${totalYears} Jahren noch nicht aufgebraucht.`);
  } else if (successRate >= 80) {
    lines.push(`<strong>Gute Aussichten:</strong> In ${nf1.format(successRate)}% der Simulationen reichte dein Vermögen über die gesamte Laufzeit von ${totalYears} Jahren.`);
  } else if (successRate >= 50) {
    lines.push(`<strong>Erhöhtes Risiko:</strong> Nur in ${nf1.format(successRate)}% der Simulationen war dein Geld nach ${totalYears} Jahren noch vorhanden. Erwäge eine niedrigere Entnahmerate oder längere Ansparphase.`);
  } else {
    lines.push(`<strong>Hohes Risiko:</strong> In nur ${nf1.format(successRate)}% der Simulationen blieb Vermögen übrig. Diese Strategie ist sehr riskant.`);
  }
  
  // Ruinrisiko
  if (ruinProb > 0) {
    if (ruinProb < 5) {
      lines.push(`Das Risiko, während der Entnahmephase in finanzielle Schwierigkeiten zu geraten, liegt bei nur ${nf1.format(ruinProb)}%.`);
    } else if (ruinProb < 15) {
      lines.push(`Das Pleite-Risiko beträgt ${nf1.format(ruinProb)}% – moderate Vorsicht ist geboten.`);
    } else {
      lines.push(`<strong>Achtung:</strong> Das Risiko eines Vermögensausfalls liegt bei ${nf1.format(ruinProb)}%.`);
    }
  }
  
  // Vermögen bei Rentenbeginn
  if (retirementMedian > 0) {
    lines.push(`Bei Rentenbeginn (nach ${params.savings_years} Jahren) hast du im Median ca. ${nf0.format(retirementMedian)} € angespart.`);
  }
  
  // Endvermögen
  if (medianEndReal > 0) {
    lines.push(`Das inflationsbereinigte Median-Endvermögen beträgt ${nf0.format(medianEndReal)} €.`);
  }
  
  // Notgroschen
  if (params.savings_target > 0) {
    if (emergencyFillProb >= 95) {
      lines.push(`Dein Notgroschen-Ziel von ${nf0.format(params.savings_target)} € wird in ${nf1.format(emergencyFillProb)}% der Fälle erreicht${emergencyFillYears ? ` (im Median nach ${nf1.format(emergencyFillYears)} Jahren)` : ''}.`);
    } else if (emergencyFillProb >= 80) {
      lines.push(`Der Notgroschen wird in ${nf1.format(emergencyFillProb)}% der Simulationen gefüllt${emergencyFillYears ? ` – typischerweise nach ${nf1.format(emergencyFillYears)} Jahren` : ''}.`);
    } else if (emergencyFillProb > 0) {
      lines.push(`Nur in ${nf1.format(emergencyFillProb)}% der Fälle erreichst du dein Notgroschen-Ziel. Erwäge eine höhere TG-Sparrate.`);
    }
  }
  
  // SoRR-Hinweis
  if (results.sorr && results.sorr.sorRiskScore > 30) {
    lines.push(`<strong>Sequence-of-Returns-Risiko:</strong> Frühe Crashs in der Entnahmephase haben einen starken Einfluss auf dein Endvermögen (Korrelation: ${nf1.format(Math.abs(results.sorr.correlationEarlyReturns * 100))}%).`);
  }
  
  return lines.join(' ');
}
