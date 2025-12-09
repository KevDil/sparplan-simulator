import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useScenarioStore } from './scenario'
import { useSimulationStore } from './simulation'

export const useMonteCarloStore = defineStore('monteCarlo', () => {
  // State
  const results = ref(null)
  const isRunning = ref(false)
  const progress = ref(0)
  const progressText = ref('')
  const error = ref(null)
  const worker = ref(null)

  // Computed
  const hasResults = computed(() => results.value !== null)
  
  const successRate = computed(() => {
    if (!results.value) return 0
    return results.value.successRate
  })

  const ruinProbability = computed(() => {
    if (!results.value) return 0
    return results.value.ruinProbability
  })

  // Actions
  function startSimulation() {
    const scenarioStore = useScenarioStore()
    const simulationStore = useSimulationStore()
    const scenario = scenarioStore.activeScenario
    
    isRunning.value = true
    error.value = null
    progress.value = 0
    progressText.value = 'Starte Monte-Carlo-Simulation...'
    console.log('[MC] startSimulation', { scenario })

    // Create worker if not exists
    if (!worker.value) {
      worker.value = new Worker(new URL('../core/mc-worker-entry.js', import.meta.url), { type: 'module' })
      console.log('[MC] Worker created')

      // Message-Protokoll siehe src/core/mc-worker-entry.js
      // - progress: { type: 'progress', current, total, percent }
      // - complete: { type: 'complete', results }
      // - error:   { type: 'error', message }
      worker.value.onmessage = (e) => {
        const msg = e.data || {}
        const { type } = msg

        console.log('[MC] Worker message', msg)

        switch (type) {
          case 'progress': {
            const { percent = 0, eta } = msg
            progress.value = percent
            progressText.value = `${percent.toFixed(0)}% - ${eta || 'Berechne...'}`
            break
          }
          case 'complete': {
            const { results: payload } = msg
            results.value = payload || null
            isRunning.value = false
            progress.value = 100
            progressText.value = 'Fertig!'
            break
          }
          case 'error': {
            const { message } = msg
            error.value = message || 'Unbekannter Fehler bei der Monte-Carlo-Simulation'
            isRunning.value = false
            break
          }
        }
      }

      worker.value.onerror = (e) => {
        console.error('[MC] Worker onerror', e)
        error.value = e.message
        isRunning.value = false
      }
    }

    // Build params using simulation store's builder (snake_case as expected by simulation-core.js)
    const params = simulationStore.buildSimulationParams(scenario)

    // MC-spezifische Optionen gemäß Protokoll in mc-worker-entry.js
    const iterations = scenario.mcIterations || 1000
    const volatility = scenario.mcVolatility || 15
    const mcOptions = {
      seed: scenario.mcSeed || undefined,
      successThreshold: scenario.mcSuccessThreshold,
      ruinThresholdPercent: (scenario.mcRuinThreshold ?? 10),
      showIndividualPaths: !!scenario.mcShowIndividual,
      stressScenario: scenario.stressScenario || 'none',
      // MC-Erweiterte Risiken
      inflationMode: scenario.mcInflationMode || 'deterministic',
      inflationVolatility: scenario.mcInflationVolatility ?? 1.5,
      inflationFloor: scenario.mcInflationFloor ?? -1.0,
      inflationCap: scenario.mcInflationCap ?? 10.0,
      cashRateMode: scenario.mcCashRateMode || 'deterministic',
      cashRateVolatility: scenario.mcCashRateVolatility ?? 1.0,
      corrInflationCash: scenario.mcCorrInflationCash ?? 0.7,
      corrReturnInflation: scenario.mcCorrReturnInflation ?? -0.1,
      savingShockMode: scenario.mcSavingShockMode || 'off',
      savingShockPNeg: scenario.mcSavingShockPNeg ?? 0.03,
      savingShockPPos: scenario.mcSavingShockPPos ?? 0.05,
      savingShockFactorNeg: scenario.mcSavingShockFactorNeg ?? 0.0,
      savingShockFactorPos: scenario.mcSavingShockFactorPos ?? 1.15,
      savingShockDurationNeg: scenario.mcSavingShockDurationNeg ?? 12,
      extraExpenseMode: scenario.mcExtraExpenseMode || 'off',
      extraExpenseProbability: scenario.mcExtraExpenseProbability ?? 0.05,
      extraExpensePercent: scenario.mcExtraExpensePercent ?? 5.0,
      extraExpenseFixed: scenario.mcExtraExpenseFixed ?? 10000,
      crashMode: scenario.mcCrashMode || 'off',
      crashProbability: scenario.mcCrashProbability ?? 0.03,
      crashDropMin: scenario.mcCrashDropMin ?? -0.25,
      crashDropMax: scenario.mcCrashDropMax ?? -0.45,
    }

    console.log('[MC] postMessage start', { params, iterations, volatility, mcOptions })
    worker.value.postMessage({ type: 'start', params, iterations, volatility, mcOptions })
  }

  function abortSimulation() {
    if (worker.value) {
      worker.value.postMessage({ type: 'abort' })
      isRunning.value = false
      progressText.value = 'Abgebrochen'
    }
  }

  function clearResults() {
    results.value = null
    error.value = null
    progress.value = 0
    progressText.value = ''
  }

  return {
    // State
    results,
    isRunning,
    progress,
    progressText,
    error,
    // Computed
    hasResults,
    successRate,
    ruinProbability,
    // Actions
    startSimulation,
    abortSimulation,
    clearResults
  }
})
