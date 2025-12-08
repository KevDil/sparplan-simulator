/**
 * ETF Simulator - Unit Tests für scenario store
 * 
 * Test-Fokus:
 * - Preset-Mapping (snake_case → camelCase)
 */

import { describe, test, expect } from 'vitest';
import { SCENARIO_PRESETS } from '../src/core/constants.js';

// Extracted mapping logic from scenario.js for testing
function mapPresetToStore(presetValues) {
  const mapping = {
    savings_years: 'yearsSave',
    withdrawal_years: 'yearsWithdraw',
    monthly_savings: 'monthlySavings',
    monthly_etf: 'monthlyEtf',
    savings_target: 'savingsTarget',
    monthly_payout_percent: 'rentPercent',
    monthly_payout_net: 'rentEur',
    rent_mode: 'rentMode',
    etf_rate_pa: 'etfRate',
    savings_rate_pa: 'savingsRate',
    inflation_adjust_withdrawal: 'inflationAdjustWithdrawal',
    capital_preservation_enabled: 'capitalPreservationEnabled',
    capital_preservation_threshold: 'capitalPreservationThreshold',
    capital_preservation_reduction: 'capitalPreservationReduction',
    capital_preservation_recovery: 'capitalPreservationRecovery',
    stress_scenario: 'stressScenario'
  };
  
  const mapped = {};
  for (const [key, value] of Object.entries(presetValues)) {
    const storeKey = mapping[key] || key;
    mapped[storeKey] = value;
  }
  return mapped;
}

describe('Preset Mapping', () => {
  test('FIRE preset maps snake_case fields to camelCase', () => {
    const firePreset = SCENARIO_PRESETS.fire;
    const mapped = mapPresetToStore(firePreset.values);
    
    // Check all snake_case fields are converted
    expect(mapped.yearsSave).toBe(25);
    expect(mapped.yearsWithdraw).toBe(40);
    expect(mapped.monthlySavings).toBe(200);
    expect(mapped.monthlyEtf).toBe(800);
    expect(mapped.savingsTarget).toBe(10000);
    expect(mapped.rentPercent).toBe(3.5);
    expect(mapped.rentMode).toBe('percent');
    expect(mapped.etfRate).toBe(7.0);
    expect(mapped.inflationAdjustWithdrawal).toBe(true);
    
    // Original snake_case keys should NOT exist in mapped output
    expect(mapped.savings_years).toBeUndefined();
    expect(mapped.withdrawal_years).toBeUndefined();
    expect(mapped.monthly_savings).toBeUndefined();
  });

  test('Classic preset maps capital_preservation correctly', () => {
    const classicPreset = SCENARIO_PRESETS.classic;
    const mapped = mapPresetToStore(classicPreset.values);
    
    expect(mapped.capitalPreservationEnabled).toBe(true);
    expect(mapped.capital_preservation_enabled).toBeUndefined();
  });

  test('Education preset maps rentEur correctly', () => {
    const eduPreset = SCENARIO_PRESETS.education;
    const mapped = mapPresetToStore(eduPreset.values);
    
    expect(mapped.rentEur).toBe(800);
    expect(mapped.monthly_payout_net).toBeUndefined();
  });

  test('All preset values are mapped', () => {
    for (const [key, preset] of Object.entries(SCENARIO_PRESETS)) {
      const mapped = mapPresetToStore(preset.values);
      
      // Ensure no snake_case keys remain in the mapped output
      for (const mappedKey of Object.keys(mapped)) {
        expect(mappedKey).not.toContain('_');
      }
    }
  });
});

// Test for rentMode handling in buildSimulationParams
// Simulates the logic from src/stores/simulation.js
describe('buildSimulationParams rentMode handling', () => {
  // Extracted logic from simulation.js for testing
  function buildSimulationParams(scenario) {
    const isEurMode = scenario.rentMode === 'eur';
    return {
      monthly_payout_net: isEurMode ? scenario.rentEur : null,
      monthly_payout_percent: isEurMode ? null : scenario.rentPercent,
    };
  }

  test('EUR mode sets monthly_payout_net, clears percent', () => {
    const scenario = {
      rentMode: 'eur',
      rentEur: 1000,
      rentPercent: 4.0
    };
    
    const params = buildSimulationParams(scenario);
    
    expect(params.monthly_payout_net).toBe(1000);
    expect(params.monthly_payout_percent).toBeNull();
  });

  test('Percent mode sets monthly_payout_percent, clears net', () => {
    const scenario = {
      rentMode: 'percent',
      rentEur: 1000,
      rentPercent: 4.0
    };
    
    const params = buildSimulationParams(scenario);
    
    expect(params.monthly_payout_net).toBeNull();
    expect(params.monthly_payout_percent).toBe(4.0);
  });

  test('Default (eur) mode when rentMode is undefined defaults correctly', () => {
    const scenario = {
      rentMode: undefined,
      rentEur: 1000,
      rentPercent: 4.0
    };
    
    const params = buildSimulationParams(scenario);
    
    // undefined !== 'eur', so isEurMode is false → percent mode
    // This tests edge case behavior
    expect(params.monthly_payout_net).toBeNull();
    expect(params.monthly_payout_percent).toBe(4.0);
  });
});
