/**
 * ETF Simulator - Unit Tests für simulation-core.js
 * 
 * Test-Fokus:
 * - Steuerberechnung (Vorabpauschale, Teilfreistellung, Freibetrag)
 * - ETF-Verkauf (FIFO/LIFO)
 * - Verlusttopf-Logik
 * - Simulationsphasen (Anspar/Entnahme)
 * - Kapitalerhalt-Modus
 * - Stress-Test-Renditen
 */

// Für Node.js-Kompatibilität: Mock der Importe
// In Jest werden diese automatisch aufgelöst

import {
  toMonthlyRate,
  toMonthlyVolatility,
  calculateTaxRate,
  percentile,
  consolidateLots,
  sellEtfOptimized,
  sellEtfGross,
  coverTaxWithSavingsAndEtf,
  simulate,
  analyzeHistory,
  createSeededRandom,
  setRng,
  getStressReturn,
} from '../src/core/simulation-core.js';

import {
  TAX_RATE_BASE,
  SOLI_RATE,
  TEILFREISTELLUNG_MAP,
  SPARERPAUSCHBETRAG_SINGLE,
} from '../src/core/constants.js';

// ============ UTILITY TESTS ============

describe('toMonthlyRate', () => {
  test('0% annual rate returns 0 monthly', () => {
    expect(toMonthlyRate(0)).toBeCloseTo(0, 10);
  });
  
  test('12% annual rate converts correctly', () => {
    const monthly = toMonthlyRate(12);
    const annualized = Math.pow(1 + monthly, 12) - 1;
    expect(annualized).toBeCloseTo(0.12, 6);
  });
  
  test('negative rate works', () => {
    const monthly = toMonthlyRate(-5);
    expect(monthly).toBeLessThan(0);
  });
});

describe('toMonthlyVolatility', () => {
  test('converts annual to monthly volatility', () => {
    const annual = 15;
    const monthly = toMonthlyVolatility(annual);
    expect(monthly).toBeCloseTo(annual / Math.sqrt(12), 6);
  });
});

describe('calculateTaxRate', () => {
  test('base tax rate without church tax', () => {
    const rate = calculateTaxRate(0);
    const expected = TAX_RATE_BASE * (1 + SOLI_RATE);
    expect(rate).toBeCloseTo(expected, 6);
  });
  
  test('8% church tax rate', () => {
    const rate = calculateTaxRate(0.08);
    expect(rate).toBeCloseTo(0.27818, 4);
  });
  
  test('9% church tax rate', () => {
    const rate = calculateTaxRate(0.09);
    expect(rate).toBeCloseTo(0.27995, 4);
  });
});

describe('percentile', () => {
  test('returns correct median', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(percentile(arr, 50)).toBe(3);
  });
  
  test('returns 0 for empty array', () => {
    expect(percentile([], 50)).toBe(0);
  });
  
  test('interpolates between values', () => {
    const arr = [10, 20, 30, 40];
    // p=25: idx = 0.25 * 3 = 0.75 -> 10*(1-0.75) + 20*0.75 = 17.5
    expect(percentile(arr, 25)).toBeCloseTo(17.5, 1);
  });
});

describe('createSeededRandom', () => {
  test('same seed produces same sequence', () => {
    const rng1 = createSeededRandom(12345);
    const rng2 = createSeededRandom(12345);
    
    for (let i = 0; i < 10; i++) {
      expect(rng1()).toBe(rng2());
    }
  });
  
  test('different seeds produce different sequences', () => {
    const rng1 = createSeededRandom(12345);
    const rng2 = createSeededRandom(54321);
    
    expect(rng1()).not.toBe(rng2());
  });
  
  test('values are in [0, 1)', () => {
    const rng = createSeededRandom(99999);
    for (let i = 0; i < 100; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });
});

// ============ LOT CONSOLIDATION ============

describe('consolidateLots', () => {
  test('returns empty array for empty input', () => {
    expect(consolidateLots([])).toEqual([]);
  });
  
  test('single lot unchanged', () => {
    const lots = [{ amount: 10, price: 100, monthIdx: 1 }];
    const result = consolidateLots(lots);
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(10);
  });
  
  test('merges lots with similar prices', () => {
    const lots = [
      { amount: 10, price: 100.001, monthIdx: 1 },
      { amount: 5, price: 100.002, monthIdx: 2 },
    ];
    const result = consolidateLots(lots);
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBeCloseTo(15, 6);
  });
  
  test('keeps distinct prices separate', () => {
    const lots = [
      { amount: 10, price: 100, monthIdx: 1 },
      { amount: 5, price: 200, monthIdx: 2 },
    ];
    const result = consolidateLots(lots);
    expect(result).toHaveLength(2);
  });
  
  test('ignores zero-amount lots', () => {
    const lots = [
      { amount: 0, price: 100, monthIdx: 1 },
      { amount: 5, price: 100, monthIdx: 2 },
    ];
    const result = consolidateLots(lots);
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(5);
  });
});

// ============ ETF SELLING ============

describe('sellEtfOptimized', () => {
  const defaultParams = {
    currentEtfPrice: 150,
    yearlyUsedFreibetrag: 0,
    sparerpauschbetrag: 1000,
    taxRate: 0.26375,
    lossPotStart: 0,
    useFifo: true,
    teilfreistellung: 0.7,
  };
  
  test('sells shares to cover net amount', () => {
    const lots = [{ amount: 100, price: 100, monthIdx: 1 }];
    const result = sellEtfOptimized(
      1000, lots, 
      defaultParams.currentEtfPrice,
      defaultParams.yearlyUsedFreibetrag,
      defaultParams.sparerpauschbetrag,
      defaultParams.taxRate,
      defaultParams.lossPotStart,
      defaultParams.useFifo,
      defaultParams.teilfreistellung
    );
    
    expect(result.remaining).toBeLessThan(1);
    expect(lots[0].amount).toBeLessThan(100);
  });
  
  test('uses Freibetrag before paying taxes', () => {
    const lots = [{ amount: 100, price: 100, monthIdx: 1 }];
    // Kleiner Verkauf, der durch Freibetrag gedeckt ist
    const result = sellEtfOptimized(
      500, lots, 
      defaultParams.currentEtfPrice,
      0, // Kein genutzter Freibetrag
      1000, // Freibetrag
      defaultParams.taxRate,
      0,
      true,
      0.7
    );
    
    // Bei 50€ Gewinn × 0.7 = 35€ steuerpflichtig, unter Freibetrag
    expect(result.taxPaid).toBe(0);
    expect(result.yearlyUsedFreibetrag).toBeGreaterThan(0);
  });
  
  test('LIFO sells newest lots first', () => {
    const lots = [
      { amount: 10, price: 80, monthIdx: 1 },
      { amount: 10, price: 140, monthIdx: 12 },
    ];
    
    const result = sellEtfOptimized(
      500, lots, 150, 0, 1000, 0.26375, 0, false, 0.7 // useFifo = false
    );
    
    // Bei LIFO sollte zuerst das teurere (neuere) Lot verkauft werden
    // Das erste (ältere) Lot sollte mehr Anteile behalten
    expect(lots[0].amount).toBeGreaterThan(lots[1].amount);
  });
  
  test('loss increases loss pot', () => {
    const lots = [{ amount: 100, price: 200, monthIdx: 1 }]; // Verlust-Lot
    const result = sellEtfOptimized(
      1000, lots, 100, 0, 1000, 0.26375, 0, true, 0.7
    );
    
    expect(result.lossPot).toBeGreaterThan(0);
  });
});

describe('sellEtfGross', () => {
  test('sells exact gross amount', () => {
    const lots = [{ amount: 100, price: 100, monthIdx: 1 }];
    const result = sellEtfGross(
      1500, lots, 150, 0, 1000, 0.26375, 0, true, 0.7
    );
    
    // 1500 brutto = 10 Anteile × 150
    expect(lots[0].amount).toBeCloseTo(90, 1);
  });
  
  test('returns net proceeds after tax', () => {
    const lots = [{ amount: 100, price: 100, monthIdx: 1 }];
    const result = sellEtfGross(
      1500, lots, 150, 0, 1000, 0.26375, 0, true, 0.7
    );
    
    expect(result.netProceeds).toBeLessThanOrEqual(1500);
  });
});

describe('coverTaxWithSavingsAndEtf', () => {
  test('uses savings first', () => {
    const lots = [{ amount: 100, price: 100, monthIdx: 1 }];
    const result = coverTaxWithSavingsAndEtf(
      500, 1000, lots, 150, 0, 1000, 0.26375, 0, true, 0.7
    );
    
    expect(result.savings).toBe(500); // 1000 - 500
    expect(lots[0].amount).toBe(100); // Kein ETF-Verkauf nötig
  });
  
  test('sells ETF if savings insufficient', () => {
    const lots = [{ amount: 100, price: 100, monthIdx: 1 }];
    const result = coverTaxWithSavingsAndEtf(
      1500, 500, lots, 150, 0, 1000, 0.26375, 0, true, 0.7
    );
    
    expect(result.savings).toBe(0);
    expect(lots[0].amount).toBeLessThan(100);
  });
  
  test('returns 0 for zero tax amount', () => {
    const lots = [{ amount: 100, price: 100, monthIdx: 1 }];
    const result = coverTaxWithSavingsAndEtf(
      0, 1000, lots, 150, 0, 1000, 0.26375, 0, true, 0.7
    );
    
    expect(result.savings).toBe(1000);
    expect(result.totalTaxRecorded).toBe(0);
  });
});

// ============ STRESS-TEST ============

describe('getStressReturn', () => {
  test('returns null for none scenario', () => {
    const result = getStressReturn('none', 100, 60, 0.005);
    expect(result).toBeNull();
  });
  
  test('returns null during savings phase', () => {
    const result = getStressReturn('early_crash', 50, 60, 0.005);
    expect(result).toBeNull();
  });
  
  test('returns stress return in withdrawal phase', () => {
    const savingsMonths = 60;
    // Erster Monat der Entnahmephase (Jahr 1)
    const result = getStressReturn('early_crash', savingsMonths + 1, savingsMonths, 0.005);
    
    // early_crash hat -30% im ersten Jahr
    expect(result).not.toBeNull();
    expect(result).toBeLessThan(1); // Negativ = < 1
  });
  
  test('returns normal after stress years', () => {
    const savingsMonths = 60;
    // 15 Jahre nach Entnahmebeginn (nach den 10 definierten Jahren)
    const result = getStressReturn('early_crash', savingsMonths + 180, savingsMonths, 0.005);
    expect(result).toBeNull();
  });
});

// ============ SIMULATION ============

describe('simulate', () => {
  const baseParams = {
    start_savings: 10000,
    start_etf: 50000,
    start_etf_cost_basis: 40000,
    monthly_savings: 200,
    monthly_etf: 500,
    savings_rate_pa: 3.0,
    etf_rate_pa: 7.0,
    etf_ter_pa: 0.2,
    savings_target: 15000,
    annual_raise_percent: 2.0,
    savings_years: 5,
    withdrawal_years: 10,
    monthly_payout_net: 2000,
    monthly_payout_percent: null,
    withdrawal_min: 0,
    withdrawal_max: 0,
    rent_is_gross: false,
    inflation_adjust_withdrawal: false,
    special_payout_net_savings: 0,
    special_interval_years_savings: 0,
    inflation_adjust_special_savings: false,
    special_payout_net_withdrawal: 0,
    special_interval_years_withdrawal: 0,
    inflation_adjust_special_withdrawal: false,
    inflation_rate_pa: 2.0,
    sparerpauschbetrag: 1000,
    kirchensteuer: 'keine',
    basiszins: 2.53,
    use_lifo: false,
    capital_preservation_enabled: false,
    capital_preservation_threshold: 80,
    capital_preservation_reduction: 25,
    capital_preservation_recovery: 10,
    loss_pot: 0,
    fondstyp: 'aktien',
  };
  
  beforeEach(() => {
    // Deterministische RNG für Tests
    setRng(createSeededRandom(42));
  });
  
  test('returns history with correct length', () => {
    const history = simulate(baseParams, 0);
    const expectedMonths = (baseParams.savings_years + baseParams.withdrawal_years) * 12;
    expect(history).toHaveLength(expectedMonths);
  });
  
  test('first month has correct phase', () => {
    const history = simulate(baseParams, 0);
    expect(history[0].phase).toBe('Anspar');
  });
  
  test('transitions to withdrawal phase', () => {
    const history = simulate(baseParams, 0);
    const savingsMonths = baseParams.savings_years * 12;
    
    expect(history[savingsMonths - 1].phase).toBe('Anspar');
    expect(history[savingsMonths].phase).toBe('Entnahme');
  });
  
  test('savings grow during savings phase', () => {
    const history = simulate(baseParams, 0);
    
    // Tagesgeld sollte durch Einzahlungen und Zinsen wachsen
    expect(history[11].savings).toBeGreaterThan(baseParams.start_savings);
  });
  
  test('ETF grows in deterministic mode', () => {
    const history = simulate(baseParams, 0);
    const savingsMonths = baseParams.savings_years * 12;
    
    // Am Ende der Ansparphase sollte ETF gewachsen sein
    expect(history[savingsMonths - 1].etf).toBeGreaterThan(baseParams.start_etf);
  });
  
  test('withdrawals happen in withdrawal phase', () => {
    const history = simulate(baseParams, 0);
    const savingsMonths = baseParams.savings_years * 12;
    
    expect(history[savingsMonths].withdrawal).toBeGreaterThan(0);
  });
  
  test('cumulative inflation grows over time', () => {
    const history = simulate(baseParams, 0);
    
    expect(history[0].cumulative_inflation).toBeGreaterThan(1);
    expect(history[history.length - 1].cumulative_inflation).toBeGreaterThan(history[0].cumulative_inflation);
  });
  
  test('real values account for inflation', () => {
    const history = simulate(baseParams, 0);
    const lastRow = history[history.length - 1];
    
    // Wenn Endvermögen > 0, dann sollte real < nominal sein
    if (lastRow.total > 0) {
      expect(lastRow.total_real).toBeLessThan(lastRow.total);
    } else {
      // Bei 0 sind beide gleich
      expect(lastRow.total_real).toBe(lastRow.total);
    }
  });
  
  test('stochastic simulation varies with seed', () => {
    // Reset RNG before each simulation
    setRng(createSeededRandom(100));
    const history1 = simulate(baseParams, 15);
    
    setRng(createSeededRandom(200));
    const history2 = simulate(baseParams, 15);
    
    // Vergleiche Werte am Ende der Ansparphase (vor Vermögensaufbrauch)
    const savingsMonths = baseParams.savings_years * 12;
    const val1 = history1[savingsMonths - 1].etf;
    const val2 = history2[savingsMonths - 1].etf;
    
    // ETF-Werte sollten bei unterschiedlichen Seeds und Volatilität unterschiedlich sein
    expect(val1).not.toBeCloseTo(val2, 0);
  });
  
  test('same seed produces same results', () => {
    setRng(createSeededRandom(12345));
    const history1 = simulate(baseParams, 15);
    
    setRng(createSeededRandom(12345));
    const history2 = simulate(baseParams, 15);
    
    expect(history1[history1.length - 1].total).toBeCloseTo(
      history2[history2.length - 1].total, 6
    );
  });
});

describe('simulate - Kapitalerhalt-Modus', () => {
  const baseParams = {
    start_savings: 5000,
    start_etf: 500000,
    start_etf_cost_basis: 400000,
    monthly_savings: 0,
    monthly_etf: 0,
    savings_rate_pa: 2.0,
    etf_rate_pa: -20.0, // Negativ für Crash-Szenario
    etf_ter_pa: 0.2,
    savings_target: 5000,
    annual_raise_percent: 0,
    savings_years: 1,
    withdrawal_years: 5,
    monthly_payout_net: 5000,
    monthly_payout_percent: null,
    withdrawal_min: 0,
    withdrawal_max: 0,
    rent_is_gross: false,
    inflation_adjust_withdrawal: false,
    special_payout_net_savings: 0,
    special_interval_years_savings: 0,
    special_payout_net_withdrawal: 0,
    special_interval_years_withdrawal: 0,
    inflation_rate_pa: 0,
    sparerpauschbetrag: 1000,
    kirchensteuer: 'keine',
    basiszins: 2.53,
    use_lifo: false,
    capital_preservation_enabled: true,
    capital_preservation_threshold: 80,
    capital_preservation_reduction: 50,
    capital_preservation_recovery: 10,
    loss_pot: 0,
    fondstyp: 'aktien',
  };
  
  beforeEach(() => {
    setRng(createSeededRandom(42));
  });
  
  test('reduces payout when below threshold', () => {
    const history = simulate(baseParams, 0);
    
    // Bei -20% Rendite sollte irgendwann der Kapitalerhalt aktiv werden
    const activeMonths = history.filter(r => r.capital_preservation_active);
    expect(activeMonths.length).toBeGreaterThan(0);
  });
  
  test('tracks capital preservation months', () => {
    const history = simulate(baseParams, 0);
    expect(history.capitalPreservationMonths).toBeGreaterThanOrEqual(0);
  });
});

describe('simulate - Sonderausgaben', () => {
  const baseParams = {
    start_savings: 10000,
    start_etf: 100000,
    start_etf_cost_basis: 80000,
    monthly_savings: 500,
    monthly_etf: 500,
    savings_rate_pa: 3.0,
    etf_rate_pa: 6.0,
    etf_ter_pa: 0.2,
    savings_target: 15000,
    annual_raise_percent: 0,
    savings_years: 5,
    withdrawal_years: 5,
    monthly_payout_net: 2000,
    monthly_payout_percent: null,
    withdrawal_min: 0,
    withdrawal_max: 0,
    rent_is_gross: false,
    inflation_adjust_withdrawal: false,
    special_payout_net_savings: 10000,
    special_interval_years_savings: 2,
    inflation_adjust_special_savings: false,
    special_payout_net_withdrawal: 5000,
    special_interval_years_withdrawal: 2,
    inflation_adjust_special_withdrawal: false,
    inflation_rate_pa: 2.0,
    sparerpauschbetrag: 1000,
    kirchensteuer: 'keine',
    basiszins: 2.53,
    use_lifo: false,
    capital_preservation_enabled: false,
    loss_pot: 0,
    fondstyp: 'aktien',
  };
  
  beforeEach(() => {
    setRng(createSeededRandom(42));
  });
  
  test('special withdrawals happen at intervals', () => {
    const history = simulate(baseParams, 0);
    
    // Monat 24, 48 in Ansparphase sollten Sonderentnahmen haben
    // (alle 2 Jahre = 24 Monate)
    const month24 = history.find(r => r.month === 24);
    expect(month24?.withdrawal).toBeGreaterThan(0);
  });
});

describe('analyzeHistory', () => {
  const baseParams = {
    start_savings: 10000,
    start_etf: 50000,
    monthly_savings: 200,
    monthly_etf: 500,
    savings_rate_pa: 3.0,
    etf_rate_pa: 7.0,
    savings_years: 5,
    withdrawal_years: 10,
    monthly_payout_net: 2000,
  };
  
  beforeEach(() => {
    setRng(createSeededRandom(42));
  });
  
  test('returns analysis object', () => {
    const fullParams = {
      ...baseParams,
      start_etf_cost_basis: 40000,
      etf_ter_pa: 0.2,
      savings_target: 15000,
      annual_raise_percent: 2.0,
      monthly_payout_percent: null,
      withdrawal_min: 0,
      withdrawal_max: 0,
      rent_is_gross: false,
      inflation_adjust_withdrawal: false,
      special_payout_net_savings: 0,
      special_interval_years_savings: 0,
      special_payout_net_withdrawal: 0,
      special_interval_years_withdrawal: 0,
      inflation_rate_pa: 2.0,
      sparerpauschbetrag: 1000,
      kirchensteuer: 'keine',
      basiszins: 2.53,
      use_lifo: false,
      capital_preservation_enabled: false,
      loss_pot: 0,
      fondstyp: 'aktien',
    };
    
    const history = simulate(fullParams, 0);
    const analysis = analyzeHistory(history, fullParams);
    
    expect(analysis).toHaveProperty('endTotal');
    expect(analysis).toHaveProperty('endTotalReal');
    expect(analysis).toHaveProperty('retirementTotal');
    expect(analysis).toHaveProperty('totalInvested');
    expect(analysis).toHaveProperty('totalReturn');
    expect(analysis).toHaveProperty('totalTax');
  });
  
  test('returns null for empty history', () => {
    expect(analyzeHistory([], baseParams)).toBeNull();
  });
});
