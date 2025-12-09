/**
 * ETF Simulator - Gemeinsame Konstanten
 * Version 2.0
 */

// ============ STEUER-KONSTANTEN ============

export const TAX_RATE_BASE = 0.25;
export const SOLI_RATE = 0.055;
export const TEILFREISTELLUNG_MAP = {
  aktien: 0.7,
  misch: 0.85,
  renten: 1.0,
};
export const SPARERPAUSCHBETRAG_SINGLE = 1000;
export const SPARERPAUSCHBETRAG_VERHEIRATET = 2000;
export const KIRCHENSTEUER_SATZ_8 = 0.08;
export const KIRCHENSTEUER_SATZ_9 = 0.09;

// ============ SIMULATIONS-KONSTANTEN ============

export const MONTHS_PER_YEAR = 12;
export const INITIAL_ETF_PRICE = 100;

/**
 * Historische Basiszinsen für die Vorabpauschale (§ 18 Abs. 4 InvStG)
 * Quelle: Bundesfinanzministerium, jährlich veröffentlicht
 * Key = Jahr, Value = Basiszins in %
 * Negative Werte führen zu keiner Vorabpauschale
 */
export const BASISZINS_HISTORY = {
  2025: 2.53,
  2024: 2.29,
  2023: 2.55,
  2022: -0.05, // Keine Vorabpauschale
  2021: -0.45, // Keine Vorabpauschale
  2020: 0.07,
  2019: 0.52,
  2018: 0.87
};

/**
 * Gibt den Basiszins für ein bestimmtes Kalenderjahr zurück.
 * Für Jahre ohne historischen Wert wird der übergebene Fallback verwendet.
 * @param {number} year - Kalenderjahr
 * @param {number} fallback - Fallback-Wert für unbekannte Jahre (z.B. aus UI)
 * @returns {number} Basiszins in %
 */
export function getBasiszinsForYear(year, fallback = 2.53) {
  if (BASISZINS_HISTORY[year] !== undefined) {
    return BASISZINS_HISTORY[year];
  }
  // Für zukünftige Jahre: Fallback verwenden (konfigurierbar im UI)
  return fallback;
}

// ============ UI-KONSTANTEN ============

export const Y_AXIS_STEPS = 5;
export const STORAGE_KEY_V1 = 'etf_simulator_params';
export const STORAGE_KEY_V2 = 'etf_simulator_v2';
export const THEME_STORAGE_KEY = 'etf_simulator_theme';

// ============ MC-KONSTANTEN ============

export const MC_DEFAULT_ITERATIONS = 2000;
export const MC_MAX_ITERATIONS = 10000;
export const MC_MOBILE_ITERATIONS = 1000;
export const MC_CHUNK_SIZE = 200;

// ============ SZENARIO-SCHEMA ============

export const SCENARIO_VERSION = '2.1.0';

export const DEFAULT_SCENARIO = {
  // Meta
  id: null,
  name: 'Szenario A',
  createdAt: null,
  updatedAt: null,
  
  // Basisdaten
  start_savings: 4000,
  start_etf: 100,
  start_etf_cost_basis: 0,
  savings_rate_pa: 3.0,
  etf_rate_pa: 6.0,
  etf_ter_pa: 0.2,
  savings_target: 5000,
  
  // Ansparphase
  savings_years: 36,
  monthly_savings: 100,
  monthly_etf: 150,
  annual_raise_percent: 3.0,
  special_payout_net_savings: 15000,
  special_interval_years_savings: 10,
  inflation_adjust_special_savings: true,
  
  // Entnahmephase
  withdrawal_years: 30,
  rent_mode: 'eur', // 'eur' oder 'percent'
  monthly_payout_net: 1000,
  monthly_payout_percent: 4.0,
  withdrawal_min: 0,
  withdrawal_max: 0,
  rent_is_gross: false,
  inflation_adjust_withdrawal: true,
  special_payout_net_withdrawal: 15000,
  special_interval_years_withdrawal: 10,
  inflation_adjust_special_withdrawal: true,
  
  // Kapitalerhalt
  capital_preservation_enabled: false,
  capital_preservation_threshold: 80,
  capital_preservation_reduction: 25,
  capital_preservation_recovery: 10,
  
  // Steuern
  inflation_rate_pa: 2.0,
  is_married: false, // Verheiratet-Schalter für doppelten Pauschbetrag
  sparerpauschbetrag: SPARERPAUSCHBETRAG_SINGLE,
  kirchensteuer: 'keine',
  fondstyp: 'aktien',
  basiszins: 2.53,
  use_lifo: false,
  loss_pot: 0,
  
  // MC-Optionen
  mc_iterations: MC_DEFAULT_ITERATIONS,
  mc_volatility: 15.0,
  mc_show_individual: false,
  mc_success_threshold: 100,
  mc_ruin_threshold: 10,
  mc_seed: 0,
  
  // Stress-Test
  stress_scenario: 'none',
  
  // MC-Erweiterte Risiken (Stufe 1)
  // Stochastische Inflation
  mc_inflation_mode: 'deterministic', // 'deterministic' | 'random'
  mc_inflation_volatility: 1.5, // Standardabweichung in Prozentpunkten
  mc_inflation_floor: -1.0, // Untergrenze für Inflation
  mc_inflation_cap: 10.0, // Obergrenze für Inflation
  
  // Stochastische Cashzinsen
  mc_cash_rate_mode: 'deterministic', // 'deterministic' | 'random'
  mc_cash_rate_volatility: 1.0, // Standardabweichung in Prozentpunkten
  mc_corr_inflation_cash: 0.7, // Korrelation Inflation <-> Cashzins
  
  // Sparraten-Schocks (Einkommensrisiko)
  mc_saving_shock_mode: 'off', // 'off' | 'simple'
  mc_saving_shock_p_neg: 0.03, // Wahrscheinlichkeit negativer Schock pro Jahr (3%)
  mc_saving_shock_p_pos: 0.05, // Wahrscheinlichkeit positiver Schock pro Jahr (5%)
  mc_saving_shock_factor_neg: 0.0, // Faktor bei negativem Schock (0 = vollständige Aussetzung)
  mc_saving_shock_factor_pos: 1.15, // Faktor bei positivem Schock (15% Erhöhung)
  mc_saving_shock_duration_neg: 12, // Dauer negativer Schock in Monaten
  
  // Unerwartete Ausgaben (Entnahmephase)
  mc_extra_expense_mode: 'off', // 'off' | 'percent_of_wealth' | 'fixed_real'
  mc_extra_expense_probability: 0.05, // Wahrscheinlichkeit pro Jahr (5%)
  mc_extra_expense_percent: 5.0, // Prozent vom Vermögen
  mc_extra_expense_fixed: 10000, // Fester Betrag (real)
  
  // Stochastische Crash-Ereignisse
  mc_crash_mode: 'off', // 'off' | 'simple'
  mc_crash_probability: 0.03, // Wahrscheinlichkeit pro Jahr (3%)
  mc_crash_drop_min: -0.25, // Minimaler Crash (-25%)
  mc_crash_drop_max: -0.45, // Maximaler Crash (-45%)
  
  // Korrelationen (Stufe 1.5)
  mc_corr_return_inflation: -0.1, // Korrelation Aktienrendite <-> Inflation
};

// ============ SZENARIO-VORLAGEN ============

export const SCENARIO_PRESETS = {
  fire: {
    name: 'FIRE / Frührente',
    description: 'Lange Ansparphase, hohe ETF-Quote, 3.5% Entnahme',
    values: {
      savings_years: 25,
      withdrawal_years: 40,
      monthly_savings: 200,
      monthly_etf: 800,
      savings_target: 10000,
      monthly_payout_percent: 3.5,
      rent_mode: 'percent',
      etf_rate_pa: 7.0,
      inflation_adjust_withdrawal: true,
    }
  },
  classic: {
    name: 'Klassische Rente',
    description: '67 → 95, moderate ETF-Quote, konservativere Entnahme',
    values: {
      savings_years: 35,
      withdrawal_years: 28,
      monthly_savings: 150,
      monthly_etf: 350,
      savings_target: 8000,
      monthly_payout_percent: 4.0,
      rent_mode: 'percent',
      etf_rate_pa: 6.0,
      capital_preservation_enabled: true,
    }
  },
  education: {
    name: 'Bildungskonto / Studium',
    description: 'Kürzere Laufzeit, Entnahmen über 3-6 Jahre',
    values: {
      savings_years: 18,
      withdrawal_years: 5,
      monthly_savings: 50,
      monthly_etf: 150,
      savings_target: 3000,
      monthly_payout_net: 800,
      rent_mode: 'eur',
      inflation_adjust_withdrawal: true,
    }
  },
  emergency: {
    name: 'Notgroschen-Fokus',
    description: 'Aggressiver Aufbau des Tagesgeldziels, konservativ in ETF',
    values: {
      savings_years: 10,
      withdrawal_years: 25,
      monthly_savings: 300,
      monthly_etf: 100,
      savings_target: 15000,
      monthly_payout_percent: 3.0,
      rent_mode: 'percent',
      etf_rate_pa: 5.0,
    }
  }
};

// ============ STRESS-TEST-SZENARIEN ============

export const STRESS_SCENARIOS = {
  none: {
    name: 'Standard (Zufällig)',
    description: 'Normale Monte-Carlo-Simulation mit zufälligen Renditen',
    returns: null, // Nutzt normale Zufallsrenditen
  },
  early_crash: {
    name: 'Früher Crash',
    description: '-30% im 1. Rentenjahr, langsame Erholung über 5 Jahre',
    // Jährliche Renditen für die ersten 10 Jahre, danach normale Zufallswerte
    returns: [-0.30, -0.10, 0.05, 0.08, 0.10, 0.12, 0.08, 0.07, 0.06, 0.06]
  },
  sideways: {
    name: 'Seitwärtsmarkt',
    description: '0% Realrendite über 10 Jahre',
    returns: [0.02, 0.01, -0.01, 0.02, 0.00, -0.02, 0.03, -0.01, 0.01, 0.00]
  },
  bear_market: {
    name: 'Bärenmarkt-Phase',
    description: '3-5 Jahre leicht negative Renditen, danach normal',
    returns: [-0.05, -0.08, -0.03, -0.02, 0.02, 0.08, 0.10, 0.07, 0.06, 0.06]
  },
  late_crash: {
    name: 'Später Crash',
    description: 'Normaler Start, Crash nach 5 Jahren',
    returns: [0.08, 0.10, 0.07, 0.09, 0.06, -0.35, -0.15, 0.10, 0.12, 0.08]
  }
};

// ============ UI-MODUS ============

export const UI_MODE_SIMPLE = 'simple';
export const UI_MODE_EXPERT = 'expert';

// Felder, die im einfachen Modus ausgeblendet werden
export const EXPERT_ONLY_FIELDS = [
  'kirchensteuer',
  'basiszins',
  'use_lifo',
  'fondstyp',
  'capital_preservation_threshold',
  'capital_preservation_reduction',
  'capital_preservation_recovery',
  'loss_pot',
  'start_etf_cost_basis',
  'mc_seed',
  'mc_ruin_threshold',
  'rent_is_gross',
  // MC-Erweiterte Risiken
  'mc_inflation_mode',
  'mc_inflation_volatility',
  'mc_inflation_floor',
  'mc_inflation_cap',
  'mc_cash_rate_mode',
  'mc_cash_rate_volatility',
  'mc_corr_inflation_cash',
  'mc_saving_shock_mode',
  'mc_saving_shock_p_neg',
  'mc_saving_shock_p_pos',
  'mc_saving_shock_factor_neg',
  'mc_saving_shock_factor_pos',
  'mc_saving_shock_duration_neg',
  'mc_extra_expense_mode',
  'mc_extra_expense_probability',
  'mc_extra_expense_percent',
  'mc_extra_expense_fixed',
  'mc_crash_mode',
  'mc_crash_probability',
  'mc_crash_drop_min',
  'mc_crash_drop_max',
  'mc_corr_return_inflation',
];
