import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { SCENARIO_PRESETS } from '../core/constants'

// Default scenario values
const createDefaultScenario = (id = 'A', name = 'Szenario A') => ({
  id,
  name,
  // Base data & interest
  startSavings: 4000,
  startEtf: 100,
  startEtfCostBasis: 0,
  savingsRate: 3.0,
  etfRate: 6.0,
  etfTer: 0.2,
  savingsTarget: 5000,
  inflationRate: 2.0,
  isMarried: false,
  sparerpauschbetrag: 1000,
  kirchensteuer: 'keine',
  basiszins: 2.53,
  fondstyp: 'aktien',
  lossPot: 0,
  useLifo: false,
  
  // Accumulation phase
  yearsSave: 36,
  monthlySavings: 100,
  monthlyEtf: 150,
  annualRaise: 3.0,
  specialSavings: 15000,
  specialSavingsInterval: 10,
  inflationAdjustSpecialSavings: true,
  
  // Withdrawal phase
  yearsWithdraw: 30,
  rentMode: 'eur',
  rentEur: 1000,
  rentPercent: 4.0,
  rentIsGross: false,
  withdrawalMin: 0,
  withdrawalMax: 0,
  inflationAdjustWithdrawal: true,
  specialWithdraw: 15000,
  specialWithdrawInterval: 10,
  inflationAdjustSpecialWithdrawal: true,
  
  // Capital preservation
  capitalPreservationEnabled: false,
  capitalPreservationThreshold: 80,
  capitalPreservationReduction: 25,
  capitalPreservationRecovery: 10,
  
  // Monte Carlo options
  mcIterations: 1000,
  mcVolatility: 15.0,
  mcShowIndividual: false,
  mcSuccessThreshold: 100,
  mcRuinThreshold: 10,
  mcSeed: 0,
  stressScenario: 'none'
})

export const useScenarioStore = defineStore('scenario', () => {
  // State
  const scenarios = ref({
    A: createDefaultScenario('A', 'Szenario A')
  })
  const activeScenarioId = ref('A')
  
  // Computed
  const activeScenario = computed(() => scenarios.value[activeScenarioId.value])
  const scenarioIds = computed(() => Object.keys(scenarios.value))
  const hasMultipleScenarios = computed(() => scenarioIds.value.length > 1)

  // Actions
  function initFromStorage() {
    try {
      const saved = localStorage.getItem('etf_scenarios')
      if (saved) {
        const parsed = JSON.parse(saved)
        // Merge with defaults to ensure all fields exist
        for (const id of Object.keys(parsed.scenarios || {})) {
          scenarios.value[id] = { ...createDefaultScenario(id), ...parsed.scenarios[id] }
        }
        if (parsed.activeId && scenarios.value[parsed.activeId]) {
          activeScenarioId.value = parsed.activeId
        }
      }
    } catch (e) {
      console.warn('Failed to load scenarios from storage:', e)
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem('etf_scenarios', JSON.stringify({
        scenarios: scenarios.value,
        activeId: activeScenarioId.value
      }))
    } catch (e) {
      console.warn('Failed to save scenarios to storage:', e)
    }
  }

  function setActiveScenario(id) {
    if (scenarios.value[id]) {
      activeScenarioId.value = id
    }
  }

  function addScenario() {
    const ids = ['A', 'B', 'C']
    const existingIds = Object.keys(scenarios.value)
    const newId = ids.find(id => !existingIds.includes(id))
    if (newId) {
      scenarios.value[newId] = createDefaultScenario(newId, `Szenario ${newId}`)
      activeScenarioId.value = newId
      saveToStorage()
    }
  }

  function removeScenario(id) {
    if (Object.keys(scenarios.value).length <= 1) return
    delete scenarios.value[id]
    if (activeScenarioId.value === id) {
      activeScenarioId.value = Object.keys(scenarios.value)[0]
    }
    saveToStorage()
  }

  function updateScenario(updates) {
    Object.assign(scenarios.value[activeScenarioId.value], updates)
    saveToStorage()
  }

  function renameScenario(id, name) {
    if (!scenarios.value[id]) return
    scenarios.value[id].name = name
    saveToStorage()
  }

  /**
   * Maps preset values from snake_case (legacy format) to camelCase (store format)
   */
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
    }
    
    const mapped = {}
    for (const [key, value] of Object.entries(presetValues)) {
      const storeKey = mapping[key] || key
      mapped[storeKey] = value
    }
    return mapped
  }
  
  function applyPreset(presetKey) {
    const preset = SCENARIO_PRESETS[presetKey]
    if (preset) {
      const mappedValues = mapPresetToStore(preset.values)
      Object.assign(scenarios.value[activeScenarioId.value], mappedValues)
      saveToStorage()
    }
  }

  function resetScenario() {
    scenarios.value[activeScenarioId.value] = createDefaultScenario(
      activeScenarioId.value,
      `Szenario ${activeScenarioId.value}`
    )
    saveToStorage()
  }

  // ============ EXPORT / IMPORT / SHARE ============

  /**
   * Exports current scenario as JSON file download
   */
  function exportScenarioAsJson() {
    const scenario = activeScenario.value
    const exportData = {
      version: '3.0.0',
      exportedAt: new Date().toISOString(),
      scenario: { ...scenario }
    }
    
    const json = JSON.stringify(exportData, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `etf_szenario_${scenario.name.replace(/\s+/g, '_')}_${formatDate()}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  /**
   * Imports scenario from JSON file
   */
  function importScenarioFromJson(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result)
          if (!data.scenario) {
            throw new Error('Ungültiges Szenario-Format')
          }
          
          // Merge imported data with defaults to ensure all fields exist
          const imported = { ...createDefaultScenario(), ...data.scenario }
          imported.id = activeScenarioId.value
          imported.name = data.scenario.name || `Importiert ${formatDate()}`
          
          scenarios.value[activeScenarioId.value] = imported
          saveToStorage()
          resolve(imported)
        } catch (err) {
          reject(new Error(`Import fehlgeschlagen: ${err.message}`))
        }
      }
      reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'))
      reader.readAsText(file)
    })
  }

  /**
   * Generates a shareable URL with scenario encoded in hash
   */
  function generateShareUrl() {
    const scenario = activeScenario.value
    // Only include non-default values to keep URL shorter
    const defaults = createDefaultScenario()
    const diff = {}
    
    for (const [key, value] of Object.entries(scenario)) {
      if (key !== 'id' && key !== 'name' && value !== defaults[key]) {
        diff[key] = value
      }
    }
    
    // Add name always
    diff.name = scenario.name
    
    const encoded = btoa(encodeURIComponent(JSON.stringify(diff)))
    const url = `${window.location.origin}${window.location.pathname}#scenario=${encoded}`
    return url
  }

  /**
   * Copies share URL to clipboard
   */
  async function copyShareUrl() {
    const url = generateShareUrl()
    try {
      await navigator.clipboard.writeText(url)
      return { success: true, url }
    } catch (err) {
      return { success: false, url, error: err.message }
    }
  }

  /**
   * Loads scenario from URL hash if present
   */
  function loadFromShareUrl() {
    const hash = window.location.hash
    if (!hash.startsWith('#scenario=')) return false
    
    try {
      const encoded = hash.replace('#scenario=', '')
      const json = decodeURIComponent(atob(encoded))
      const data = JSON.parse(json)
      
      // Merge with defaults
      const imported = { ...createDefaultScenario(), ...data }
      imported.id = activeScenarioId.value
      
      scenarios.value[activeScenarioId.value] = imported
      saveToStorage()
      
      // Clear hash after loading
      history.replaceState(null, '', window.location.pathname)
      return true
    } catch (err) {
      console.warn('Failed to load scenario from URL:', err)
      return false
    }
  }

  /**
   * Helper: Format date for filenames
   */
  function formatDate() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  // Watch for changes and auto-save
  watch(scenarios, saveToStorage, { deep: true })

  return {
    // State
    scenarios,
    activeScenarioId,
    // Computed
    activeScenario,
    scenarioIds,
    hasMultipleScenarios,
    // Actions
    initFromStorage,
    saveToStorage,
    setActiveScenario,
    addScenario,
    removeScenario,
    renameScenario,
    updateScenario,
    applyPreset,
    resetScenario,
    // Export/Import/Share
    exportScenarioAsJson,
    importScenarioFromJson,
    generateShareUrl,
    copyShareUrl,
    loadFromShareUrl
  }
})
