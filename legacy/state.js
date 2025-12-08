/**
 * ETF Simulator - State Management
 * Version 2.0
 * 
 * Zentrales State-Management für Szenarien, LocalStorage und Migration
 */

import {
  STORAGE_KEY_V1,
  STORAGE_KEY_V2,
  THEME_STORAGE_KEY,
  SCENARIO_VERSION,
  DEFAULT_SCENARIO,
  SCENARIO_PRESETS,
  UI_MODE_SIMPLE,
  UI_MODE_EXPERT,
} from './constants.js';

// ============ STATE ============

const state = {
  // Aktives Szenario-ID
  activeScenarioId: 'A',
  
  // Alle Szenarien (A, B, C)
  scenarios: {
    A: null,
    B: null,
    C: null,
  },
  
  // UI-Modus (simple/expert)
  uiMode: UI_MODE_EXPERT,
  
  // Theme (light/dark)
  theme: 'dark',
  
  // Letzte Simulationsergebnisse pro Szenario
  results: {
    A: null,
    B: null,
    C: null,
  },
  
  // MC-Ergebnisse pro Szenario
  mcResults: {
    A: null,
    B: null,
    C: null,
  },
  
  // Listeners für State-Änderungen
  listeners: [],
};

// ============ HELPER ============

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ============ SZENARIO-FUNKTIONEN ============

/**
 * Erstellt ein neues Szenario mit Standardwerten
 */
export function createScenario(name = 'Neues Szenario', baseScenario = null) {
  const now = new Date().toISOString();
  const base = baseScenario ? deepClone(baseScenario) : deepClone(DEFAULT_SCENARIO);
  
  return {
    ...base,
    id: generateId(),
    name,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Gibt die aktive Szenario-ID zurück
 */
export function getActiveScenarioId() {
  return state.activeScenarioId;
}

/**
 * Gibt das aktive Szenario zurück
 */
export function getActiveScenario() {
  return state.scenarios[state.activeScenarioId];
}

/**
 * Gibt ein Szenario nach ID zurück
 */
export function getScenario(id) {
  return state.scenarios[id];
}

/**
 * Gibt alle Szenarien zurück
 */
export function getAllScenarios() {
  return { ...state.scenarios };
}

/**
 * Setzt das aktive Szenario
 */
export function setActiveScenario(id) {
  if (state.scenarios[id]) {
    state.activeScenarioId = id;
    notifyListeners('activeScenarioChanged', { id });
    saveToStorage();
  }
}

/**
 * Aktualisiert ein Szenario
 */
export function updateScenario(id, updates) {
  if (state.scenarios[id]) {
    state.scenarios[id] = {
      ...state.scenarios[id],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    notifyListeners('scenarioUpdated', { id, scenario: state.scenarios[id] });
    saveToStorage();
  }
}

/**
 * Dupliziert ein Szenario
 */
export function duplicateScenario(sourceId, targetId) {
  const source = state.scenarios[sourceId];
  if (!source) return null;
  
  const newName = `Kopie von ${source.name}`;
  const duplicate = createScenario(newName, source);
  
  state.scenarios[targetId] = duplicate;
  notifyListeners('scenarioDuplicated', { sourceId, targetId, scenario: duplicate });
  saveToStorage();
  
  return duplicate;
}

/**
 * Wendet ein Preset auf das aktive Szenario an
 */
export function applyPreset(presetKey) {
  const preset = SCENARIO_PRESETS[presetKey];
  if (!preset) return false;
  
  const activeId = state.activeScenarioId;
  const current = state.scenarios[activeId];
  
  state.scenarios[activeId] = {
    ...current,
    ...preset.values,
    name: preset.name,
    updatedAt: new Date().toISOString(),
  };
  
  notifyListeners('presetApplied', { presetKey, scenario: state.scenarios[activeId] });
  saveToStorage();
  
  return true;
}

/**
 * Setzt ein Szenario zurück
 */
export function resetScenario(id) {
  const name = `Szenario ${id}`;
  state.scenarios[id] = createScenario(name);
  notifyListeners('scenarioReset', { id });
  saveToStorage();
}

// ============ ERGEBNIS-FUNKTIONEN ============

/**
 * Speichert Simulationsergebnisse für ein Szenario
 */
export function setResults(id, history) {
  state.results[id] = history;
  notifyListeners('resultsUpdated', { id });
}

/**
 * Gibt Simulationsergebnisse zurück
 */
export function getResults(id) {
  return state.results[id];
}

/**
 * Speichert MC-Ergebnisse für ein Szenario
 */
export function setMcResults(id, results) {
  state.mcResults[id] = results;
  notifyListeners('mcResultsUpdated', { id });
}

/**
 * Gibt MC-Ergebnisse zurück
 */
export function getMcResults(id) {
  return state.mcResults[id];
}

// ============ UI-MODUS ============

/**
 * Gibt den aktuellen UI-Modus zurück
 */
export function getUiMode() {
  return state.uiMode;
}

/**
 * Setzt den UI-Modus
 */
export function setUiMode(mode) {
  if (mode === UI_MODE_SIMPLE || mode === UI_MODE_EXPERT) {
    state.uiMode = mode;
    notifyListeners('uiModeChanged', { mode });
    saveToStorage();
  }
}

/**
 * Wechselt den UI-Modus
 */
export function toggleUiMode() {
  const newMode = state.uiMode === UI_MODE_SIMPLE ? UI_MODE_EXPERT : UI_MODE_SIMPLE;
  setUiMode(newMode);
  return newMode;
}

// ============ THEME ============

/**
 * Gibt das aktuelle Theme zurück
 */
export function getTheme() {
  return state.theme;
}

/**
 * Setzt das Theme
 */
export function setTheme(theme) {
  state.theme = theme;
  notifyListeners('themeChanged', { theme });
  
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (e) { /* ignore */ }
}

/**
 * Wechselt das Theme
 */
export function toggleTheme() {
  const newTheme = state.theme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
  return newTheme;
}

// ============ LISTENER ============

/**
 * Registriert einen Listener für State-Änderungen
 */
export function addListener(callback) {
  state.listeners.push(callback);
  return () => {
    const idx = state.listeners.indexOf(callback);
    if (idx > -1) state.listeners.splice(idx, 1);
  };
}

/**
 * Benachrichtigt alle Listener
 */
function notifyListeners(event, data) {
  state.listeners.forEach(cb => {
    try {
      cb(event, data);
    } catch (e) {
      console.error('State listener error:', e);
    }
  });
}

// ============ LOCALSTORAGE ============

/**
 * Speichert den State im LocalStorage
 */
export function saveToStorage() {
  try {
    const data = {
      version: SCENARIO_VERSION,
      activeScenarioId: state.activeScenarioId,
      scenarios: state.scenarios,
      uiMode: state.uiMode,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

/**
 * Lädt den State aus dem LocalStorage
 */
export function loadFromStorage() {
  try {
    // Versuche zuerst v2 zu laden
    const v2Data = localStorage.getItem(STORAGE_KEY_V2);
    if (v2Data) {
      const parsed = JSON.parse(v2Data);
      return restoreFromV2(parsed);
    }
    
    // Fallback: v1 migrieren
    const v1Data = localStorage.getItem(STORAGE_KEY_V1);
    if (v1Data) {
      const parsed = JSON.parse(v1Data);
      return migrateFromV1(parsed);
    }
    
    return null;
  } catch (e) {
    console.error('Failed to load state:', e);
    return null;
  }
}

/**
 * Stellt State aus v2-Daten wieder her
 */
function restoreFromV2(data) {
  if (!data.scenarios) return null;
  
  state.activeScenarioId = data.activeScenarioId || 'A';
  state.uiMode = data.uiMode || UI_MODE_EXPERT;
  
  // Szenarien wiederherstellen
  ['A', 'B', 'C'].forEach(id => {
    if (data.scenarios[id]) {
      // Fehlende Felder mit Defaults auffüllen
      state.scenarios[id] = {
        ...deepClone(DEFAULT_SCENARIO),
        ...data.scenarios[id],
      };
    } else if (id === 'A') {
      // Szenario A muss existieren
      state.scenarios[id] = createScenario('Szenario A');
    }
  });
  
  return state;
}

/**
 * Migriert v1-Daten zu v2-Format
 */
function migrateFromV1(v1Data) {
  console.log('Migrating from v1 to v2...');
  
  // Mapping v1 -> v2 Feldnamen
  const fieldMap = {
    start_savings: 'start_savings',
    start_etf: 'start_etf',
    start_etf_cost_basis: 'start_etf_cost_basis',
    savings_rate: 'savings_rate_pa',
    etf_rate: 'etf_rate_pa',
    etf_ter: 'etf_ter_pa',
    savings_target: 'savings_target',
    years_save: 'savings_years',
    monthly_savings: 'monthly_savings',
    monthly_etf: 'monthly_etf',
    annual_raise: 'annual_raise_percent',
    special_savings: 'special_payout_net_savings',
    special_savings_interval: 'special_interval_years_savings',
    inflation_adjust_special_savings: 'inflation_adjust_special_savings',
    years_withdraw: 'withdrawal_years',
    rent_eur: 'monthly_payout_net',
    rent_percent: 'monthly_payout_percent',
    withdrawal_min: 'withdrawal_min',
    withdrawal_max: 'withdrawal_max',
    inflation_adjust_withdrawal: 'inflation_adjust_withdrawal',
    special_withdraw: 'special_payout_net_withdrawal',
    special_withdraw_interval: 'special_interval_years_withdrawal',
    inflation_adjust_special_withdrawal: 'inflation_adjust_special_withdrawal',
    inflation_rate: 'inflation_rate_pa',
    sparerpauschbetrag: 'sparerpauschbetrag',
    kirchensteuer: 'kirchensteuer',
    fondstyp: 'fondstyp',
    basiszins: 'basiszins',
    use_lifo: 'use_lifo',
    capital_preservation_enabled: 'capital_preservation_enabled',
    capital_preservation_threshold: 'capital_preservation_threshold',
    capital_preservation_reduction: 'capital_preservation_reduction',
    capital_preservation_recovery: 'capital_preservation_recovery',
    loss_pot: 'loss_pot',
    rent_mode: 'rent_mode',
  };
  
  // Erstelle Szenario A aus v1-Daten
  const scenarioA = createScenario('Szenario A');
  
  for (const [v1Key, v2Key] of Object.entries(fieldMap)) {
    if (v1Data[v1Key] !== undefined && v1Data[v1Key] !== null) {
      scenarioA[v2Key] = v1Data[v1Key];
    }
  }
  
  // Spezieller Fall: savings_rate und ähnliche waren in v1 anders benannt
  if (v1Data.savings_rate_pa !== undefined) scenarioA.savings_rate_pa = v1Data.savings_rate_pa;
  if (v1Data.etf_rate_pa !== undefined) scenarioA.etf_rate_pa = v1Data.etf_rate_pa;
  
  state.scenarios.A = scenarioA;
  state.activeScenarioId = 'A';
  
  // Speichere im neuen Format
  saveToStorage();
  
  // Lösche alte Daten
  try {
    localStorage.removeItem(STORAGE_KEY_V1);
  } catch (e) { /* ignore */ }
  
  console.log('Migration complete');
  return state;
}

/**
 * Initialisiert den State
 */
export function initState() {
  // Theme laden
  try {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme) {
      state.theme = storedTheme;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      state.theme = 'light';
    }
  } catch (e) { /* ignore */ }
  
  // State laden oder initialisieren
  const loaded = loadFromStorage();
  
  if (!loaded) {
    // Kein gespeicherter State - initialisiere mit Defaults
    state.scenarios.A = createScenario('Szenario A');
  }
  
  return state;
}

// ============ EXPORT/IMPORT ============

/**
 * Exportiert ein Szenario als JSON
 */
export function exportScenarioAsJson(id) {
  const scenario = state.scenarios[id];
  if (!scenario) return null;
  
  return JSON.stringify({
    version: SCENARIO_VERSION,
    exportedAt: new Date().toISOString(),
    scenario: deepClone(scenario),
  }, null, 2);
}

/**
 * Importiert ein Szenario aus JSON
 */
export function importScenarioFromJson(json, targetId) {
  try {
    const data = JSON.parse(json);
    if (!data.scenario) throw new Error('Invalid scenario format');
    
    const imported = {
      ...deepClone(DEFAULT_SCENARIO),
      ...data.scenario,
      id: generateId(),
      updatedAt: new Date().toISOString(),
    };
    
    state.scenarios[targetId] = imported;
    notifyListeners('scenarioImported', { id: targetId, scenario: imported });
    saveToStorage();
    
    return imported;
  } catch (e) {
    console.error('Failed to import scenario:', e);
    return null;
  }
}

/**
 * Generiert eine Share-URL für ein Szenario
 */
export function generateShareUrl(id) {
  const scenario = state.scenarios[id];
  if (!scenario) return null;
  
  // Nur die wichtigsten Parameter serialisieren
  const shareParams = {
    ss: scenario.start_savings,
    se: scenario.start_etf,
    sr: scenario.savings_rate_pa,
    er: scenario.etf_rate_pa,
    st: scenario.savings_target,
    ys: scenario.savings_years,
    yw: scenario.withdrawal_years,
    ms: scenario.monthly_savings,
    me: scenario.monthly_etf,
    ar: scenario.annual_raise_percent,
    rm: scenario.rent_mode,
    rn: scenario.monthly_payout_net,
    rp: scenario.monthly_payout_percent,
    ir: scenario.inflation_rate_pa,
    sp: scenario.sparerpauschbetrag,
  };
  
  try {
    const encoded = btoa(JSON.stringify(shareParams));
    const baseUrl = window.location.origin + window.location.pathname;
    const url = `${baseUrl}?s=${encoded}`;
    
    // Prüfe URL-Länge (max 2000 Zeichen empfohlen)
    if (url.length > 2000) {
      return { success: false, error: 'URL zu lang', url: null };
    }
    
    return { success: true, url };
  } catch (e) {
    return { success: false, error: e.message, url: null };
  }
}

/**
 * Lädt ein Szenario aus URL-Parametern
 */
export function loadFromShareUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('s');
    if (!encoded) return null;
    
    const decoded = JSON.parse(atob(encoded));
    
    // Mappe zurück auf vollständige Feldnamen
    const paramMap = {
      ss: 'start_savings',
      se: 'start_etf',
      sr: 'savings_rate_pa',
      er: 'etf_rate_pa',
      st: 'savings_target',
      ys: 'savings_years',
      yw: 'withdrawal_years',
      ms: 'monthly_savings',
      me: 'monthly_etf',
      ar: 'annual_raise_percent',
      rm: 'rent_mode',
      rn: 'monthly_payout_net',
      rp: 'monthly_payout_percent',
      ir: 'inflation_rate_pa',
      sp: 'sparerpauschbetrag',
    };
    
    const scenario = createScenario('Geteiltes Szenario');
    
    for (const [shortKey, value] of Object.entries(decoded)) {
      const fullKey = paramMap[shortKey];
      if (fullKey && value !== undefined) {
        scenario[fullKey] = value;
      }
    }
    
    // Als Szenario A setzen
    state.scenarios.A = scenario;
    state.activeScenarioId = 'A';
    saveToStorage();
    
    // URL bereinigen
    window.history.replaceState({}, '', window.location.pathname);
    
    return scenario;
  } catch (e) {
    console.error('Failed to load from share URL:', e);
    return null;
  }
}

// ============ HILFSFUNKTIONEN FÜR SIMULATION ============

/**
 * Konvertiert ein Szenario in Simulationsparameter
 */
export function scenarioToParams(scenario) {
  if (!scenario) return null;
  
  return {
    start_savings: scenario.start_savings,
    start_etf: scenario.start_etf,
    start_etf_cost_basis: scenario.start_etf_cost_basis,
    monthly_savings: scenario.monthly_savings,
    monthly_etf: scenario.monthly_etf,
    savings_rate_pa: scenario.savings_rate_pa,
    etf_rate_pa: scenario.etf_rate_pa,
    etf_ter_pa: scenario.etf_ter_pa,
    savings_target: scenario.savings_target,
    annual_raise_percent: scenario.annual_raise_percent,
    savings_years: scenario.savings_years,
    withdrawal_years: scenario.withdrawal_years,
    monthly_payout_net: scenario.rent_mode === 'eur' ? scenario.monthly_payout_net : null,
    monthly_payout_percent: scenario.rent_mode === 'percent' ? scenario.monthly_payout_percent : null,
    withdrawal_min: scenario.withdrawal_min,
    withdrawal_max: scenario.withdrawal_max,
    rent_is_gross: scenario.rent_is_gross,
    inflation_adjust_withdrawal: scenario.inflation_adjust_withdrawal,
    special_payout_net_savings: scenario.special_payout_net_savings,
    special_interval_years_savings: scenario.special_interval_years_savings,
    inflation_adjust_special_savings: scenario.inflation_adjust_special_savings,
    special_payout_net_withdrawal: scenario.special_payout_net_withdrawal,
    special_interval_years_withdrawal: scenario.special_interval_years_withdrawal,
    inflation_adjust_special_withdrawal: scenario.inflation_adjust_special_withdrawal,
    inflation_rate_pa: scenario.inflation_rate_pa,
    sparerpauschbetrag: scenario.sparerpauschbetrag,
    kirchensteuer: scenario.kirchensteuer,
    basiszins: scenario.basiszins,
    use_lifo: scenario.use_lifo,
    capital_preservation_enabled: scenario.capital_preservation_enabled,
    capital_preservation_threshold: scenario.capital_preservation_threshold,
    capital_preservation_reduction: scenario.capital_preservation_reduction,
    capital_preservation_recovery: scenario.capital_preservation_recovery,
    loss_pot: scenario.loss_pot,
    fondstyp: scenario.fondstyp,
  };
}

/**
 * Gibt MC-Optionen aus einem Szenario zurück
 */
export function scenarioToMcOptions(scenario) {
  if (!scenario) return {};
  
  return {
    iterations: scenario.mc_iterations,
    volatility: scenario.mc_volatility,
    showIndividual: scenario.mc_show_individual,
    successThreshold: scenario.mc_success_threshold,
    ruinThresholdPercent: scenario.mc_ruin_threshold,
    seed: scenario.mc_seed || 0,
    stressScenario: scenario.stress_scenario || 'none',
  };
}
