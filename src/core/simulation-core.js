/**
 * ETF Sparplan Simulator - Simulation Core
 * Version 2.0
 * 
 * Reine Simulationsfunktionen ohne DOM-Abhängigkeiten.
 * Kann in Browser und Web Worker verwendet werden.
 * 
 * Dieses Modul exportiert alle Funktionen als ES-Module.
 * Für Worker-Kompatibilität wird auch eine globale Version erstellt.
 */

import {
  TAX_RATE_BASE,
  SOLI_RATE,
  TEILFREISTELLUNG_MAP,
  SPARERPAUSCHBETRAG_SINGLE,
  KIRCHENSTEUER_SATZ_8,
  KIRCHENSTEUER_SATZ_9,
  MONTHS_PER_YEAR,
  INITIAL_ETF_PRICE,
  STRESS_SCENARIOS,
  getBasiszinsForYear,
} from './constants.js';

// ============ GLOBALER RNG ============

let currentRng = Math.random;

export function setRng(rng) {
  currentRng = rng;
}

export function getRng() {
  return currentRng;
}

// ============ UTILITY FUNCTIONS ============

export function toMonthlyRate(annualPercent) {
  return Math.pow(1 + annualPercent / 100, 1 / MONTHS_PER_YEAR) - 1;
}

export function toMonthlyVolatility(annualVolatility) {
  return annualVolatility / Math.sqrt(12);
}

export function calculateTaxRate(kirchensteuerSatz = 0) {
  const basePlusSoli = TAX_RATE_BASE * (1 + SOLI_RATE);
  if (kirchensteuerSatz === 0) return basePlusSoli;
  if (kirchensteuerSatz === KIRCHENSTEUER_SATZ_8) return 0.27818;
  if (kirchensteuerSatz === KIRCHENSTEUER_SATZ_9) return 0.27995;
  return basePlusSoli + TAX_RATE_BASE * kirchensteuerSatz;
}

// Box-Muller Transform für Normalverteilung
export function randomNormal(mean = 0, stdDev = 1) {
  let u1, u2;
  do {
    u1 = currentRng();
    u2 = currentRng();
  } while (u1 === 0);
  
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev + mean;
}

// Seeded PRNG (Mulberry32) für reproduzierbare Ergebnisse
export function createSeededRandom(seed) {
  let s = seed;
  return function() {
    s |= 0;
    s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Berechnet Perzentil aus sortiertem Array
export function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedArr[lower];
  return sortedArr[lower] * (upper - idx) + sortedArr[upper] * (idx - lower);
}

// ============ LOT CONSOLIDATION ============

export function consolidateLots(etfLots, priceTolerance = 0.01) {
  if (etfLots.length <= 1) return etfLots;
  
  const grouped = new Map();
  
  for (const lot of etfLots) {
    if (lot.amount <= 0) continue;
    const roundedPrice = Math.round(lot.price / priceTolerance) * priceTolerance;
    const key = roundedPrice.toFixed(4);
    
    if (grouped.has(key)) {
      const existing = grouped.get(key);
      const totalAmount = existing.amount + lot.amount;
      const avgPrice = (existing.price * existing.amount + lot.price * lot.amount) / totalAmount;
      existing.amount = totalAmount;
      existing.price = avgPrice;
      existing.monthIdx = Math.min(existing.monthIdx, lot.monthIdx);
    } else {
      grouped.set(key, { ...lot });
    }
  }
  
  return Array.from(grouped.values()).sort((a, b) => a.monthIdx - b.monthIdx);
}

// ============ ETF SELLING ============

export function sellEtfOptimized(remaining, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate, lossPotStart = 0, useFifo = true, teilfreistellung = 0.7) {
  let taxPaid = 0;
  let freibetragUsed = yearlyUsedFreibetrag;
  let lossPot = lossPotStart;
  let grossProceeds = 0;
  let taxableGainTotal = 0;
  
  while (remaining > 0.01 && etfLots.length) {
    const lotIndex = useFifo ? 0 : etfLots.length - 1;
    const lot = etfLots[lotIndex];
    const gainPerShare = currentEtfPrice - lot.price;
    const remainingFreibetrag = Math.max(0, sparerpauschbetrag - freibetragUsed);
    let sharesNeeded;

    if (gainPerShare > 0) {
      const taxableGainPerShare = gainPerShare * teilfreistellung;
      const lossPotCoversShares = Math.min(
        taxableGainPerShare > 0 ? lossPot / taxableGainPerShare : Number.POSITIVE_INFINITY,
        lot.amount
      );
      const freibetragCoversShares = Math.min(
        taxableGainPerShare > 0 ? remainingFreibetrag / taxableGainPerShare : Number.POSITIVE_INFINITY,
        lot.amount - lossPotCoversShares
      );
      const totalTaxFreeShares = lossPotCoversShares + freibetragCoversShares;
      const sharesIfTaxFree = remaining / currentEtfPrice;

      if (sharesIfTaxFree <= totalTaxFreeShares) {
        sharesNeeded = sharesIfTaxFree;
      } else {
        const netFromTaxFree = totalTaxFreeShares * currentEtfPrice;
        const stillNeeded = remaining - netFromTaxFree;
        const taxPerShareFull = taxableGainPerShare * taxRate;
        const netPerShareTaxed = currentEtfPrice - taxPerShareFull;
        if (netPerShareTaxed <= 0) break;
        const additionalShares = stillNeeded / netPerShareTaxed;
        sharesNeeded = totalTaxFreeShares + additionalShares;
      }
    } else {
      sharesNeeded = remaining / currentEtfPrice;
    }

    const sharesToSell = Math.min(sharesNeeded, lot.amount);
    grossProceeds += sharesToSell * currentEtfPrice;
    
    const bruttoGainLoss = sharesToSell * gainPerShare;
    const taxableGainLoss = bruttoGainLoss * teilfreistellung;
    taxableGainTotal += taxableGainLoss;
    
    let partTax = 0;
    
    if (taxableGainLoss > 0) {
      const usedLossPot = Math.min(taxableGainLoss, lossPot);
      lossPot -= usedLossPot;
      const afterLossPot = taxableGainLoss - usedLossPot;
      const currentRemainingFreibetrag = Math.max(0, sparerpauschbetrag - freibetragUsed);
      const usedFreibetrag = Math.min(afterLossPot, currentRemainingFreibetrag);
      freibetragUsed += usedFreibetrag;
      const taxableAfterAll = afterLossPot - usedFreibetrag;
      partTax = taxableAfterAll * taxRate;
    } else if (taxableGainLoss < 0) {
      lossPot += Math.abs(taxableGainLoss);
    }
    
    const partNet = sharesToSell * currentEtfPrice - partTax;
    remaining -= partNet;
    taxPaid += partTax;

    if (sharesNeeded >= lot.amount) {
      if (useFifo) {
        etfLots.shift();
      } else {
        etfLots.pop();
      }
    } else {
      lot.amount -= sharesToSell;
    }
  }
  
  return { 
    remaining, 
    taxPaid, 
    yearlyUsedFreibetrag: freibetragUsed, 
    lossPot,
    grossProceeds,
    taxableGainTotal 
  };
}

export function sellEtfGross(grossAmount, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate, lossPotStart = 0, useFifo = true, teilfreistellung = 0.7) {
  let taxPaid = 0;
  let freibetragUsed = yearlyUsedFreibetrag;
  let lossPot = lossPotStart;
  let grossRemaining = grossAmount;
  let netProceeds = 0;
  
  while (grossRemaining > 0.01 && etfLots.length) {
    const lotIndex = useFifo ? 0 : etfLots.length - 1;
    const lot = etfLots[lotIndex];
    const gainPerShare = currentEtfPrice - lot.price;
    const sharesNeeded = grossRemaining / currentEtfPrice;
    const sharesToSell = Math.min(sharesNeeded, lot.amount);
    const grossFromSale = sharesToSell * currentEtfPrice;
    const bruttoGainLoss = sharesToSell * gainPerShare;
    const taxableGainLoss = bruttoGainLoss * teilfreistellung;
    
    let partTax = 0;
    
    if (taxableGainLoss > 0) {
      const usedLossPot = Math.min(taxableGainLoss, lossPot);
      lossPot -= usedLossPot;
      const afterLossPot = taxableGainLoss - usedLossPot;
      const remainingFreibetrag = Math.max(0, sparerpauschbetrag - freibetragUsed);
      const usedFreibetrag = Math.min(afterLossPot, remainingFreibetrag);
      freibetragUsed += usedFreibetrag;
      const taxableAfterAll = afterLossPot - usedFreibetrag;
      partTax = taxableAfterAll * taxRate;
    } else if (taxableGainLoss < 0) {
      lossPot += Math.abs(taxableGainLoss);
    }
    
    const partNet = grossFromSale - partTax;
    netProceeds += partNet;
    taxPaid += partTax;
    grossRemaining -= grossFromSale;
    
    if (sharesNeeded >= lot.amount) {
      if (useFifo) {
        etfLots.shift();
      } else {
        etfLots.pop();
      }
    } else {
      lot.amount -= sharesToSell;
    }
  }
  
  const shortfall = grossRemaining > 0.01 ? grossRemaining : 0;
  
  return { 
    netProceeds, 
    taxPaid, 
    yearlyUsedFreibetrag: freibetragUsed, 
    lossPot,
    shortfall
  };
}

export function coverTaxWithSavingsAndEtf(taxAmount, savings, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate, lossPotStart = 0, useFifo = true, teilfreistellung = 0.7) {
  if (taxAmount <= 0) {
    return {
      savings,
      yearlyUsedFreibetrag,
      lossPot: lossPotStart,
      taxPaidOriginal: 0,
      saleTax: 0,
      totalTaxRecorded: 0,
      shortfall: 0,
    };
  }

  let remainingTax = taxAmount;
  let lossPot = lossPotStart;

  const useCash = Math.min(savings, remainingTax);
  savings -= useCash;
  remainingTax -= useCash;

  let saleTax = 0;
  if (remainingTax > 0.01 && etfLots.length) {
    const sellResult = sellEtfOptimized(remainingTax, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate, lossPot, useFifo, teilfreistellung);
    remainingTax = sellResult.remaining;
    saleTax = sellResult.taxPaid;
    yearlyUsedFreibetrag = sellResult.yearlyUsedFreibetrag;
    lossPot = sellResult.lossPot;
  }

  remainingTax = Math.max(0, remainingTax);
  const taxPaidOriginal = taxAmount - remainingTax;
  const shortfall = remainingTax > 0.01 ? remainingTax : 0;
  const totalTaxRecorded = taxPaidOriginal + saleTax;

  return {
    savings,
    yearlyUsedFreibetrag,
    lossPot,
    taxPaidOriginal,
    saleTax,
    totalTaxRecorded,
    shortfall,
  };
}

// ============ STRESS-TEST RENDITEN ============

/**
 * Gibt die Rendite für einen bestimmten Monat im Stress-Test zurück
 * @param {string} stressScenario - Key des Stress-Szenarios
 * @param {number} monthIdx - Monat-Index (1-basiert)
 * @param {number} savingsMonths - Anzahl Monate in der Ansparphase
 * @param {number} monthlyEtfRate - Normale monatliche ETF-Rendite
 * @returns {number} Monatliche Rendite (als Faktor, z.B. 1.01 für +1%)
 */
export function getStressReturn(stressScenario, monthIdx, savingsMonths, monthlyEtfRate) {
  const scenario = STRESS_SCENARIOS[stressScenario];
  if (!scenario || !scenario.returns) {
    // Kein Stress-Test, normale Berechnung
    return null;
  }
  
  // Stress-Test nur in der Entnahmephase
  const withdrawalMonth = monthIdx - savingsMonths;
  if (withdrawalMonth <= 0) {
    return null; // Normale Rendite in Ansparphase
  }
  
  // Jährliche Rendite in monatliche umrechnen
  const yearIdx = Math.floor((withdrawalMonth - 1) / 12);
  if (yearIdx < scenario.returns.length) {
    const annualReturn = scenario.returns[yearIdx];
    // Jährliche Rendite in monatliche umrechnen
    return Math.pow(1 + annualReturn, 1/12);
  }
  
  // Nach den definierten Jahren: normale Rendite
  return null;
}

// ============ HAUPTSIMULATION ============

/**
 * Unified simulation function for both standard and Monte-Carlo simulations.
 * @param {Object} params - Simulation parameters
 * @param {number} volatility - Annual volatility for stochastic simulation (0 = deterministic)
 * @param {Object} options - Additional options (stressScenario, etc.)
 * @returns {Array} History array with monthly data points
 */
export function simulate(params, volatility = 0, options = {}) {
  const {
    start_savings,
    start_etf,
    start_etf_cost_basis = 0,
    monthly_savings,
    monthly_etf,
    savings_rate_pa,
    etf_rate_pa,
    etf_ter_pa = 0,
    savings_target,
    annual_raise_percent,
    savings_years,
    withdrawal_years,
    monthly_payout_net,
    monthly_payout_percent,
    withdrawal_min = 0,
    withdrawal_max = 0,
    inflation_adjust_withdrawal = true,
    special_payout_net_savings,
    special_interval_years_savings,
    inflation_adjust_special_savings = true,
    special_payout_net_withdrawal,
    special_interval_years_withdrawal,
    inflation_adjust_special_withdrawal = true,
    inflation_rate_pa = 0,
    sparerpauschbetrag = SPARERPAUSCHBETRAG_SINGLE,
    kirchensteuer = "keine",
    basiszins = 2.53,
    use_lifo = false,
    rent_is_gross = false,
    capital_preservation_enabled = false,
    capital_preservation_threshold = 80,
    capital_preservation_reduction = 25,
    capital_preservation_recovery = 10,
    loss_pot: initialLossPot = 0,
    fondstyp = "aktien",
  } = params;
  
  const { stressScenario = 'none', startYear = new Date().getFullYear() } = options;
  
  const isStochastic = volatility > 0;
  const useStressTest = stressScenario && stressScenario !== 'none';
  const monthlyVolatility = isStochastic ? toMonthlyVolatility(volatility / 100) : 0;
  const teilfreistellung = TEILFREISTELLUNG_MAP[fondstyp] || TEILFREISTELLUNG_MAP.aktien;

  let kirchensteuerSatz = 0;
  if (kirchensteuer === "8") kirchensteuerSatz = KIRCHENSTEUER_SATZ_8;
  else if (kirchensteuer === "9") kirchensteuerSatz = KIRCHENSTEUER_SATZ_9;
  const taxRate = calculateTaxRate(kirchensteuerSatz);

  const history = [];
  let savings = start_savings;
  let currentEtfPrice = INITIAL_ETF_PRICE;
  const etfLots = [];
  if (start_etf > 0) {
    const shares = start_etf / currentEtfPrice;
    const effectiveCostBasis = start_etf_cost_basis > 0 ? start_etf_cost_basis : start_etf;
    const costPricePerShare = effectiveCostBasis / shares;
    etfLots.push({ amount: shares, price: costPricePerShare, monthIdx: 0 });
  }

  const effectiveEtfRate = etf_rate_pa - etf_ter_pa;
  const monthlySavingsRate = toMonthlyRate(savings_rate_pa);
  const monthlyEtfRate = toMonthlyRate(effectiveEtfRate);
  const monthlyInflationRate = toMonthlyRate(inflation_rate_pa);
  const annualRaise = annual_raise_percent / 100;
  const totalMonths = (savings_years + withdrawal_years) * MONTHS_PER_YEAR;
  const savingsMonths = savings_years * MONTHS_PER_YEAR;

  let savingsFull = savings >= savings_target;
  let yearlyUsedFreibetrag = 0;
  let currentTaxYear = 0;
  let payoutFromPercentDone = false;
  let payoutValue = monthly_payout_net;
  let payoutPercentPa = monthly_payout_percent;
  let entnahmeStartTotal = null;
  let basePayoutValue = null;
  let cumulativeInflation = 1;
  let capitalPreservationActive = false;
  let capitalPreservationMonths = 0;
  let etfValueYearStart = start_etf;
  let etfPriceAtYearStart = currentEtfPrice;
  let vorabpauschaleTaxYearly = 0;
  let lossPot = initialLossPot;
  let yearlyAccumulatedInterestGross = 0;
  let pendingVorabpauschaleTax = 0;
  let pendingVorabpauschaleAmount = 0;

  for (let monthIdx = 1; monthIdx <= totalMonths; monthIdx += 1) {
    const isSavingsPhase = monthIdx <= savingsMonths;
    const yearIdx = Math.floor((monthIdx - 1) / MONTHS_PER_YEAR);
    const monthInYear = ((monthIdx - 1) % MONTHS_PER_YEAR) + 1;
    let vorabpauschaleTaxPaidThisMonth = 0;
    let taxPaidThisMonth = 0;
    let taxShortfall = 0;
    
    cumulativeInflation *= (1 + monthlyInflationRate);
    const totalEtfSharesStart = etfLots.reduce((acc, l) => acc + l.amount, 0);
    const totalEtfValueStart = totalEtfSharesStart * currentEtfPrice;
    const totalPortfolioStart = savings + totalEtfValueStart;

    // Jahreswechsel-Logik
    if (yearIdx !== currentTaxYear) {
      yearlyUsedFreibetrag = 0;
      vorabpauschaleTaxYearly = 0;
      
      if (pendingVorabpauschaleAmount > 0) {
        const usedLossPot = Math.min(pendingVorabpauschaleAmount, lossPot);
        lossPot -= usedLossPot;
        const afterLossPot = pendingVorabpauschaleAmount - usedLossPot;
        const remainingFreibetrag = sparerpauschbetrag;
        const usedFreibetrag = Math.min(afterLossPot, remainingFreibetrag);
        yearlyUsedFreibetrag = usedFreibetrag;
        const taxableAfterAll = Math.max(0, afterLossPot - usedFreibetrag);
        const dueTax = taxableAfterAll * taxRate;

        const coverResult = coverTaxWithSavingsAndEtf(
          dueTax, savings, etfLots, currentEtfPrice, yearlyUsedFreibetrag,
          sparerpauschbetrag, taxRate, lossPot, !use_lifo, teilfreistellung
        );
        savings = coverResult.savings;
        yearlyUsedFreibetrag = coverResult.yearlyUsedFreibetrag;
        lossPot = coverResult.lossPot;
        vorabpauschaleTaxPaidThisMonth = coverResult.taxPaidOriginal;
        vorabpauschaleTaxYearly = coverResult.taxPaidOriginal;
        taxPaidThisMonth += coverResult.totalTaxRecorded;
        taxShortfall += coverResult.shortfall;
      }
      
      currentTaxYear = yearIdx;
      etfValueYearStart = totalEtfValueStart;
      etfPriceAtYearStart = currentEtfPrice;
      yearlyAccumulatedInterestGross = 0;
      pendingVorabpauschaleTax = 0;
      pendingVorabpauschaleAmount = 0;
    }

    // ETF-Wertentwicklung
    let monthlyEtfReturn;
    
    // Prüfe ob Stress-Test-Rendite verwendet werden soll
    const stressReturn = useStressTest 
      ? getStressReturn(stressScenario, monthIdx, savingsMonths, monthlyEtfRate)
      : null;
    
    if (stressReturn !== null) {
      // Stress-Test: Deterministische Rendite
      monthlyEtfReturn = stressReturn;
      currentEtfPrice *= monthlyEtfReturn;
    } else if (isStochastic) {
      const continuousMonthlyRate = Math.log(1 + monthlyEtfRate);
      const drift = continuousMonthlyRate - 0.5 * monthlyVolatility * monthlyVolatility;
      const z = randomNormal(0, 1);
      monthlyEtfReturn = Math.exp(drift + monthlyVolatility * z);
      currentEtfPrice *= monthlyEtfReturn;
    } else {
      monthlyEtfReturn = 1 + monthlyEtfRate;
      currentEtfPrice *= monthlyEtfReturn;
    }
    const etfGrowth = totalEtfValueStart * (monthlyEtfReturn - 1);

    const savingsInterest = savings * monthlySavingsRate;
    let savingsInterestTax = 0;
    yearlyAccumulatedInterestGross += savingsInterest;
    savings += savingsInterest;

    let savings_contrib = 0;
    let etf_contrib = 0;
    let overflow = 0;
    let withdrawal = 0;
    let tax_paid = taxPaidThisMonth;
    let withdrawal_paid = 0;
    let withdrawal_net = 0;
    let monthlyPayout = 0;
    let capitalPreservationActiveThisMonth = false;
    let netWithdrawalThisMonth = 0;

    // ANSPARPHASE
    if (isSavingsPhase) {
      const raiseFactor = Math.pow(1 + annualRaise, yearIdx);
      const currMonthlySav = monthly_savings * raiseFactor;
      const currMonthlyEtf = monthly_etf * raiseFactor;

      if (savingsFull) {
        etf_contrib = currMonthlyEtf + currMonthlySav;
      } else {
        savings += currMonthlySav;
        savings_contrib = currMonthlySav;
        etf_contrib = currMonthlyEtf;
      }

      if (savings > savings_target) {
        overflow = savings - savings_target;
        savings = savings_target;
        etf_contrib += overflow;
        savingsFull = true;
      }

      if (etf_contrib > 0) {
        const newShares = etf_contrib / currentEtfPrice;
        etfLots.push({ amount: newShares, price: currentEtfPrice, monthIdx });
      }

      // Sonderausgaben Ansparphase
      const inSpecial = special_interval_years_savings > 0
        && monthIdx % (special_interval_years_savings * MONTHS_PER_YEAR) === 0
        && monthIdx > 0;

      if (inSpecial) {
        let specialAmount = special_payout_net_savings;
        if (inflation_adjust_special_savings) {
          const yearsElapsed = monthIdx / MONTHS_PER_YEAR;
          specialAmount = special_payout_net_savings * Math.pow(1 + inflation_rate_pa / 100, yearsElapsed);
        }
        let remaining = specialAmount;
        withdrawal = remaining;

        const extraCash = Math.max(0, savings - savings_target);
        if (extraCash > 0) {
          const use = Math.min(extraCash, remaining);
          savings -= use;
          remaining -= use;
        }

        const sellResult = sellEtfOptimized(remaining, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate, lossPot, !use_lifo, teilfreistellung);
        remaining = sellResult.remaining;
        tax_paid += sellResult.taxPaid;
        yearlyUsedFreibetrag = sellResult.yearlyUsedFreibetrag;
        lossPot = sellResult.lossPot;

        if (remaining > 0.01) {
          const draw = Math.min(savings, remaining);
          savings -= draw;
          remaining -= draw;
          if (savings < savings_target) savingsFull = false;
        }

        if (remaining < 0) {
          savings += Math.abs(remaining);
          remaining = 0;
        }

        withdrawal_paid = withdrawal - Math.max(0, remaining);
      }
    }

    // ENTNAHMEPHASE
    else {
      if (entnahmeStartTotal === null) {
        const totalEtfShares = etfLots.reduce((acc, l) => acc + l.amount, 0);
        entnahmeStartTotal = savings + totalEtfShares * currentEtfPrice;
        if (monthly_payout_percent != null && !payoutFromPercentDone) {
          payoutValue = entnahmeStartTotal * (monthly_payout_percent / 100) / 12;
          basePayoutValue = payoutValue;
          payoutFromPercentDone = true;
          payoutPercentPa = monthly_payout_percent;
        } else if (payoutValue != null) {
          basePayoutValue = payoutValue;
          payoutPercentPa = entnahmeStartTotal > 0 ? (payoutValue * 12 / entnahmeStartTotal * 100) : 0;
        }
      }

      let currentPayout = payoutValue || 0;
      if (inflation_adjust_withdrawal && basePayoutValue != null) {
        const withdrawalYearIdx = yearIdx - savings_years;
        currentPayout = basePayoutValue * Math.pow(1 + inflation_rate_pa / 100, withdrawalYearIdx);
      }

      if (withdrawal_min > 0 && currentPayout < withdrawal_min) {
        currentPayout = withdrawal_min;
      }
      if (withdrawal_max > 0 && currentPayout > withdrawal_max) {
        currentPayout = withdrawal_max;
      }

      // Kapitalerhalt-Modus
      if (capital_preservation_enabled && entnahmeStartTotal > 0) {
        const totalEtfSharesNow = etfLots.reduce((acc, l) => acc + l.amount, 0);
        const currentTotal = savings + totalEtfSharesNow * currentEtfPrice;
        const thresholdValue = entnahmeStartTotal * (capital_preservation_threshold / 100);
        const recoveryValue = entnahmeStartTotal * ((capital_preservation_threshold + capital_preservation_recovery) / 100);
        
        if (currentTotal < thresholdValue) {
          capitalPreservationActive = true;
        } else if (currentTotal >= recoveryValue) {
          capitalPreservationActive = false;
        }
        
        if (capitalPreservationActive) {
          currentPayout = currentPayout * (1 - capital_preservation_reduction / 100);
          capitalPreservationActiveThisMonth = true;
          capitalPreservationMonths++;
        }
      }

      const requestedMonthlyPayout = currentPayout;
      let specialExpenseThisMonth = 0;
      let needed_net = currentPayout;
      if (special_interval_years_withdrawal > 0
        && monthIdx % (special_interval_years_withdrawal * MONTHS_PER_YEAR) === 0) {
        specialExpenseThisMonth = special_payout_net_withdrawal;
        if (inflation_adjust_special_withdrawal) {
          const yearsElapsed = monthIdx / MONTHS_PER_YEAR;
          specialExpenseThisMonth = special_payout_net_withdrawal * Math.pow(1 + inflation_rate_pa / 100, yearsElapsed);
        }
        needed_net += specialExpenseThisMonth;
      }

      if (needed_net > 0) {
        let remaining = needed_net;
        withdrawal = needed_net;

        const extraCash = Math.max(0, savings - savings_target);
        if (extraCash > 0) {
          const use = Math.min(extraCash, remaining);
          savings -= use;
          remaining -= use;
          if (rent_is_gross) {
            netWithdrawalThisMonth += use;
          }
        }

        if (rent_is_gross && remaining > 0) {
          const sellResult = sellEtfGross(remaining, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate, lossPot, !use_lifo, teilfreistellung);
          const netReceived = sellResult.netProceeds;
          tax_paid += sellResult.taxPaid;
          yearlyUsedFreibetrag = sellResult.yearlyUsedFreibetrag;
          lossPot = sellResult.lossPot;
          remaining = sellResult.shortfall;
          withdrawal_paid = withdrawal - remaining;
          netWithdrawalThisMonth += netReceived;
        } else if (remaining > 0) {
          const sellResult = sellEtfOptimized(remaining, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate, lossPot, !use_lifo, teilfreistellung);
          remaining = sellResult.remaining;
          tax_paid += sellResult.taxPaid;
          yearlyUsedFreibetrag = sellResult.yearlyUsedFreibetrag;
          lossPot = sellResult.lossPot;
        }

        if (remaining > 0.01) {
          const draw = Math.min(savings, remaining);
          savings -= draw;
          remaining -= draw;
          if (rent_is_gross) {
            netWithdrawalThisMonth += draw;
          }
        }

        if (remaining < 0) {
          savings += Math.abs(remaining);
          remaining = 0;
        }

        if (!rent_is_gross) {
          withdrawal_paid = withdrawal - Math.max(0, remaining);
        }
      }
      
      if (withdrawal > 0 && withdrawal_paid < withdrawal) {
        const payoutRatio = withdrawal_paid / withdrawal;
        monthlyPayout = requestedMonthlyPayout * payoutRatio;
      } else {
        monthlyPayout = requestedMonthlyPayout;
      }
    }

    // Jahresende-Logik (Dezember)
    let totalVorabpauschale = 0;
    if (monthInYear === 12) {
      // TG-Zinsen besteuern
      if (yearlyAccumulatedInterestGross > 0) {
        const usedLossPot = Math.min(yearlyAccumulatedInterestGross, lossPot);
        lossPot -= usedLossPot;
        const afterLossPot = yearlyAccumulatedInterestGross - usedLossPot;
        const remainingFreibetrag = Math.max(0, sparerpauschbetrag - yearlyUsedFreibetrag);
        const usedFreibetrag = Math.min(afterLossPot, remainingFreibetrag);
        yearlyUsedFreibetrag += usedFreibetrag;
        const taxableAfterAll = Math.max(0, afterLossPot - usedFreibetrag);
        savingsInterestTax = taxableAfterAll * taxRate;

        if (savingsInterestTax > 0.01) {
          const coverResult = coverTaxWithSavingsAndEtf(
            savingsInterestTax, savings, etfLots, currentEtfPrice, yearlyUsedFreibetrag,
            sparerpauschbetrag, taxRate, lossPot, !use_lifo, teilfreistellung
          );
          savings = coverResult.savings;
          yearlyUsedFreibetrag = coverResult.yearlyUsedFreibetrag;
          lossPot = coverResult.lossPot;
          tax_paid += coverResult.totalTaxRecorded;
          taxShortfall += coverResult.shortfall;
        }
      }
      
      // Vorabpauschale berechnen - verwende historischen Basiszins wenn verfügbar
      const currentCalendarYear = startYear + yearIdx;
      const effectiveBasiszins = getBasiszinsForYear(currentCalendarYear, basiszins);
      
      if (effectiveBasiszins > 0) {
        const yearStartMonth = yearIdx * MONTHS_PER_YEAR;
        const BASISERTRAG_FAKTOR = 0.7;
        
        for (const lot of etfLots) {
          if (lot.amount <= 0) continue;
          
          const boughtThisYear = lot.monthIdx > yearStartMonth;
          const basisertragBase = boughtThisYear 
            ? lot.amount * lot.price
            : lot.amount * etfPriceAtYearStart;
          
          let zeitanteil = 1;
          if (boughtThisYear) {
            const kaufMonatImJahr = ((lot.monthIdx - 1) % MONTHS_PER_YEAR) + 1;
            zeitanteil = (12 - kaufMonatImJahr + 1) / 12;
          }
          
          const lotBasisertrag = basisertragBase * (effectiveBasiszins / 100) * BASISERTRAG_FAKTOR * zeitanteil;
          const lotValueYearEnd = lot.amount * currentEtfPrice;
          const lotValueStart = boughtThisYear 
            ? lot.amount * lot.price
            : lot.amount * etfPriceAtYearStart;
          const lotActualGain = Math.max(0, lotValueYearEnd - lotValueStart);
          const lotVorabpauschale = Math.min(lotBasisertrag, lotActualGain);
          
          if (lotVorabpauschale > 0) {
            totalVorabpauschale += lotVorabpauschale;
            lot.price += lotVorabpauschale / lot.amount;
          }
        }
        
        if (totalVorabpauschale > 0) {
          const taxableVorabpauschale = totalVorabpauschale * teilfreistellung;
          pendingVorabpauschaleAmount = taxableVorabpauschale;
        }
      }
    }
    
    // Lot-Konsolidierung
    if (monthInYear === 12 && etfLots.length > 50) {
      const consolidated = consolidateLots(etfLots);
      etfLots.length = 0;
      etfLots.push(...consolidated);
    }

    const totalEtfShares = etfLots.reduce((acc, l) => acc + l.amount, 0);
    const etf_value = totalEtfShares * currentEtfPrice;
    const total = savings + etf_value;
    const effectivePayout = isSavingsPhase ? null : (withdrawal > 0 ? withdrawal : null);
    const shortfall = withdrawal > 0 ? Math.max(0, withdrawal - withdrawal_paid) : 0;
    
    if (!isSavingsPhase && withdrawal > 0) {
      if (rent_is_gross) {
        withdrawal_net = netWithdrawalThisMonth;
      } else {
        withdrawal_net = withdrawal_paid;
      }
    } else {
      withdrawal_net = 0;
    }
    
    const savingsReturnFactor = 1 + monthlySavingsRate;
    let portfolioReturn = monthlyEtfReturn;
    if (totalPortfolioStart > 0) {
      const etfWeight = totalEtfValueStart / totalPortfolioStart;
      const cashWeight = 1 - etfWeight;
      portfolioReturn = etfWeight * monthlyEtfReturn + cashWeight * savingsReturnFactor;
    }
    
    history.push({
      month: monthIdx,
      year: yearIdx + 1,
      phase: isSavingsPhase ? "Anspar" : "Entnahme",
      savings,
      etf: etf_value,
      total,
      total_real: total / cumulativeInflation,
      savings_contrib,
      etf_contrib,
      savings_interest: savingsInterest,
      withdrawal: withdrawal_paid,
      withdrawal_real: withdrawal_paid / cumulativeInflation,
      withdrawal_net,
      withdrawal_net_real: withdrawal_net / cumulativeInflation,
      withdrawal_requested: withdrawal,
      shortfall,
      tax_shortfall: taxShortfall,
      monthly_payout: monthlyPayout,
      monthly_payout_real: monthlyPayout / cumulativeInflation,
      tax_paid,
      vorabpauschale_tax: vorabpauschaleTaxPaidThisMonth,
      payout_value: effectivePayout,
      payout_percent_pa: isSavingsPhase ? null : payoutPercentPa,
      return_gain: etfGrowth + savingsInterest,
      etfReturn: monthlyEtfReturn,
      portfolioReturn,
      cumulative_inflation: cumulativeInflation,
      capital_preservation_active: capitalPreservationActiveThisMonth || false,
      yearly_used_freibetrag: yearlyUsedFreibetrag,
      loss_pot: lossPot,
    });
  }

  // Nachbearbeitung: Pending Vorabpauschale
  if (pendingVorabpauschaleAmount > 0 && history.length > 0) {
    const usedLossPot = Math.min(pendingVorabpauschaleAmount, lossPot);
    lossPot -= usedLossPot;
    const afterLossPot = pendingVorabpauschaleAmount - usedLossPot;
    const finalRemainingFreibetrag = sparerpauschbetrag;
    const usedFreibetrag = Math.min(afterLossPot, finalRemainingFreibetrag);
    const finalTaxableAfterAll = Math.max(0, afterLossPot - usedFreibetrag);
    const finalVorabpauschaleTax = finalTaxableAfterAll * taxRate;
    
    const coverResult = coverTaxWithSavingsAndEtf(
      finalVorabpauschaleTax, savings, etfLots, currentEtfPrice, usedFreibetrag,
      sparerpauschbetrag, taxRate, lossPot, !use_lifo, teilfreistellung
    );
    savings = coverResult.savings;
    lossPot = coverResult.lossPot;
    const totalEtfShares = etfLots.reduce((acc, l) => acc + l.amount, 0);
    const updatedEtfValue = totalEtfShares * currentEtfPrice;
    
    const lastEntry = history[history.length - 1];
    lastEntry.savings = savings;
    lastEntry.etf = updatedEtfValue;
    lastEntry.total = lastEntry.savings + lastEntry.etf;
    lastEntry.total_real = lastEntry.total / lastEntry.cumulative_inflation;
    lastEntry.tax_paid += coverResult.totalTaxRecorded;
    lastEntry.vorabpauschale_tax = (lastEntry.vorabpauschale_tax || 0) + coverResult.taxPaidOriginal;
    lastEntry.pending_vorabpauschale_tax = coverResult.taxPaidOriginal;
    lastEntry.loss_pot = lossPot;
    if (coverResult.shortfall > 0.01) {
      lastEntry.tax_shortfall = (lastEntry.tax_shortfall || 0) + coverResult.shortfall;
    }
    
    if (savings < 0) savings = 0;
  }

  if (history.length > 0) {
    history.capitalPreservationMonths = capitalPreservationMonths;
    history.capitalPreservationEnabled = capital_preservation_enabled;
  }

  return history;
}

// ============ ANALYSE-FUNKTIONEN ============

/**
 * Analysiert eine einzelne Simulation
 */
export function analyzeHistory(history, params) {
  if (!history || history.length === 0) return null;
  
  const lastRow = history[history.length - 1];
  const savingsMonths = params.savings_years * MONTHS_PER_YEAR;
  const retirementIdx = Math.min(savingsMonths - 1, history.length - 1);
  const retirementRow = history[retirementIdx];
  
  const ansparRows = history.filter(r => r.phase === "Anspar");
  const entnahmeRows = history.filter(r => r.phase === "Entnahme");
  
  const totalInvested = (params.start_savings || 0) + (params.start_etf || 0) +
    ansparRows.reduce((sum, r) => sum + (r.savings_contrib || 0) + (r.etf_contrib || 0), 0);
  const totalReturn = history.reduce((sum, r) => sum + (r.return_gain || 0), 0);
  const totalTax = history.reduce((sum, r) => sum + (r.tax_paid || 0), 0);
  const totalVorabpauschale = history.reduce((sum, r) => sum + (r.vorabpauschale_tax || 0), 0);
  
  let avgWithdrawal = 0;
  let minWithdrawal = 0;
  let maxWithdrawal = 0;
  let totalWithdrawals = 0;
  
  if (entnahmeRows.length > 0) {
    const withdrawals = entnahmeRows.filter(r => r.monthly_payout > 0).map(r => r.monthly_payout);
    if (withdrawals.length > 0) {
      avgWithdrawal = withdrawals.reduce((a, b) => a + b, 0) / withdrawals.length;
      minWithdrawal = Math.min(...withdrawals);
      maxWithdrawal = Math.max(...withdrawals);
    }
    totalWithdrawals = entnahmeRows.reduce((sum, r) => sum + (r.withdrawal || 0), 0);
  }
  
  const shortfalls = history.filter(r => r.shortfall > 0);
  const hasShortfall = shortfalls.length > 0;
  
  return {
    endTotal: lastRow.total,
    endTotalReal: lastRow.total_real,
    retirementTotal: retirementRow?.total || 0,
    retirementTotalReal: retirementRow?.total_real || 0,
    totalInvested,
    totalReturn,
    totalTax,
    totalVorabpauschale,
    avgWithdrawal,
    minWithdrawal,
    maxWithdrawal,
    totalWithdrawals,
    hasShortfall,
    shortfallMonths: shortfalls.length,
    capitalPreservationMonths: history.capitalPreservationMonths || 0,
    finalLossPot: lastRow.loss_pot || 0,
    cumulativeInflation: lastRow.cumulative_inflation || 1,
  };
}

// Re-export für Worker-Kompatibilität
export {
  TAX_RATE_BASE,
  SOLI_RATE,
  TEILFREISTELLUNG_MAP,
  SPARERPAUSCHBETRAG_SINGLE,
  KIRCHENSTEUER_SATZ_8,
  KIRCHENSTEUER_SATZ_9,
  MONTHS_PER_YEAR,
  INITIAL_ETF_PRICE,
};
