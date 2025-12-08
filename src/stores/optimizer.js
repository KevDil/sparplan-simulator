import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useScenarioStore } from './scenario'
import { useSimulationStore } from './simulation'

/**
 * Optimizer Store
 * Grid-Suche über TG/ETF-Ratio und Entnahmerate
 */
export const useOptimizerStore = defineStore('optimizer', () => {
  // State
  const isRunning = ref(false)
  const progress = ref(0)
  const progressText = ref('')
  const results = ref(null)
  const error = ref(null)
  const abortController = ref(null)

  // Config
  const config = ref({
    mode: 'maximize_rent', // 'maximize_rent' oder 'minimize_budget'
    targetSuccessRate: 90,
    iterations: 500, // MC iterations per candidate
    tgRatioSteps: [0, 0.1, 0.2, 0.3, 0.4, 0.5], // TG ratio of total budget
    rentSteps: 5, // How many rent values to test around current
    rentRange: 0.3, // +/- range around current rent
  })

  // Computed
  const hasResults = computed(() => results.value !== null)
  const bestCandidate = computed(() => results.value?.best || null)

  // Worker instance
  let worker = null

  /**
   * Starts the optimization
   */
  async function startOptimization() {
    const scenarioStore = useScenarioStore()
    const simulationStore = useSimulationStore()
    const scenario = scenarioStore.activeScenario

    isRunning.value = true
    progress.value = 0
    progressText.value = 'Initialisiere...'
    error.value = null
    results.value = null

    try {
      // Generate candidates
      const candidates = generateCandidates(scenario, config.value)
      progressText.value = `${candidates.length} Kandidaten generiert`

      // Create worker
      worker = new Worker(
        new URL('../core/mc-worker-entry.js', import.meta.url),
        { type: 'module' }
      )

      const evaluated = []
      let completed = 0

      // Evaluate each candidate
      for (const candidate of candidates) {
        if (abortController.value?.signal.aborted) {
          break
        }

        const mcResult = await runMcForCandidate(candidate, config.value.iterations)
        
        const score = scoreCandidate(candidate, mcResult, config.value)
        evaluated.push({
          candidate,
          mcResult,
          score,
          isValid: score > -Infinity
        })

        completed++
        progress.value = Math.round((completed / candidates.length) * 100)
        progressText.value = `${completed}/${candidates.length} Kandidaten bewertet`
      }

      // Sort by score and get best
      const validResults = evaluated.filter(r => r.isValid)
      validResults.sort((a, b) => b.score - a.score)

      results.value = {
        candidates: validResults.slice(0, 10), // Top 10
        best: validResults[0] || null,
        totalEvaluated: candidates.length,
        validCount: validResults.length
      }

      progressText.value = `Fertig! ${validResults.length} gültige Ergebnisse`

    } catch (e) {
      console.error('Optimizer error:', e)
      error.value = e.message
    } finally {
      isRunning.value = false
      if (worker) {
        worker.terminate()
        worker = null
      }
    }
  }

  /**
   * Runs MC simulation for a candidate
   */
  function runMcForCandidate(candidate, iterations) {
    return new Promise((resolve, reject) => {
      const params = buildSimulationParams(candidate)
      
      worker.onmessage = (e) => {
        const msg = e.data || {}
        const { type, results, message } = msg
        if (type === 'complete') {
          resolve(results)
        } else if (type === 'error') {
          reject(new Error(message || 'Unbekannter Fehler bei der Monte-Carlo-Simulation'))
        }
        // "progress"-Nachrichten werden hier bewusst ignoriert
      }

      worker.onerror = (e) => {
        reject(new Error(e.message || 'Unbekannter Worker-Fehler'))
      }

      worker.postMessage({
        type: 'start',
        params,
        iterations,
        volatility: candidate.mcVolatility || 15,
        mcOptions: {
          successThreshold: candidate.mcSuccessThreshold || 100,
          ruinThresholdPercent: candidate.mcRuinThreshold || 10,
          stressScenario: 'none'
        }
      })
    })
  }

  /**
   * Generates candidate parameter sets
   */
  function generateCandidates(scenario, cfg) {
    const candidates = []
    const totalBudget = scenario.monthlySavings + scenario.monthlyEtf

    // TG/ETF ratio variations
    for (const tgRatio of cfg.tgRatioSteps) {
      const monthlySavings = Math.round(totalBudget * tgRatio)
      const monthlyEtf = totalBudget - monthlySavings

      if (cfg.mode === 'maximize_rent') {
        // Vary rent around current value
        const baseRent = scenario.rentMode === 'percent' 
          ? scenario.rentPercent 
          : scenario.rentEur
        
        for (let i = 0; i <= cfg.rentSteps; i++) {
          const factor = 1 - cfg.rentRange + (2 * cfg.rentRange * i / cfg.rentSteps)
          const rentValue = Math.round(baseRent * factor)

          candidates.push({
            ...scenario,
            monthlySavings,
            monthlyEtf,
            ...(scenario.rentMode === 'percent' 
              ? { rentPercent: Math.round(rentValue * 100) / 100 }
              : { rentEur: rentValue }
            )
          })
        }
      } else {
        // minimize_budget mode - just vary TG ratio
        candidates.push({
          ...scenario,
          monthlySavings,
          monthlyEtf
        })
      }
    }

    return candidates
  }

  /**
   * Builds snake_case params for simulation
   */
  function buildSimulationParams(scenario) {
    return {
      start_savings: scenario.startSavings,
      start_etf: scenario.startEtf,
      start_etf_cost_basis: scenario.startEtfCostBasis || 0,
      savings_target: scenario.savingsTarget,
      savings_years: scenario.yearsSave,
      withdrawal_years: scenario.yearsWithdraw,
      monthly_savings: scenario.monthlySavings,
      monthly_etf: scenario.monthlyEtf,
      savings_rate_pa: scenario.savingsRate,
      etf_rate_pa: scenario.etfRate,
      etf_ter_pa: scenario.etfTer,
      annual_raise_percent: scenario.annualRaise,
      monthly_payout_net: scenario.rentEur,
      monthly_payout_percent: scenario.rentPercent,
      rent_mode: scenario.rentMode,
      rent_is_gross: scenario.rentIsGross,
      withdrawal_min: scenario.withdrawalMin,
      withdrawal_max: scenario.withdrawalMax,
      inflation_adjust_withdrawal: scenario.inflationAdjustWithdrawal,
      special_payout_net_savings: scenario.specialSavings,
      special_interval_years_savings: scenario.specialSavingsInterval,
      inflation_adjust_special_savings: scenario.inflationAdjustSpecialSavings,
      special_payout_net_withdrawal: scenario.specialWithdraw,
      special_interval_years_withdrawal: scenario.specialWithdrawInterval,
      inflation_adjust_special_withdrawal: scenario.inflationAdjustSpecialWithdrawal,
      capital_preservation_enabled: scenario.capitalPreservationEnabled,
      capital_preservation_threshold: scenario.capitalPreservationThreshold,
      capital_preservation_reduction: scenario.capitalPreservationReduction,
      capital_preservation_recovery: scenario.capitalPreservationRecovery,
      sparerpauschbetrag: scenario.sparerpauschbetrag,
      kirchensteuer: scenario.kirchensteuer,
      basiszins: scenario.basiszins,
      use_lifo: scenario.useLifo,
      loss_pot: scenario.lossPot,
      fondstyp: scenario.fondstyp,
      inflation_rate_pa: scenario.inflationRate
    }
  }

  /**
   * Scores a candidate based on MC results
   */
  function scoreCandidate(candidate, mcResult, cfg) {
    // Hard constraint: success rate
    if (mcResult.successRate < cfg.targetSuccessRate) {
      return -Infinity
    }

    let score = 0

    if (cfg.mode === 'maximize_rent') {
      // Higher rent = better
      if (candidate.rentMode === 'percent') {
        score += (candidate.rentPercent || 0) * 1000
      } else {
        score += (candidate.rentEur || 0) * 10
      }
    } else {
      // Lower budget = better
      const budget = candidate.monthlySavings + candidate.monthlyEtf
      score -= budget * 10
    }

    // Secondary: higher median end wealth (real)
    score += (mcResult.medianEndReal || 0) / 10000

    // Penalty: ruin probability
    score -= (mcResult.ruinProbability || 0) * 2

    return score
  }

  /**
   * Applies best result to scenario
   */
  function applyBestResult() {
    if (!bestCandidate.value) return

    const scenarioStore = useScenarioStore()
    const simulationStore = useSimulationStore()
    const best = bestCandidate.value.candidate

    scenarioStore.updateScenario({
      monthlySavings: best.monthlySavings,
      monthlyEtf: best.monthlyEtf,
      rentEur: best.rentEur,
      rentPercent: best.rentPercent
    })

    simulationStore.runSimulation()
  }

  /**
   * Aborts running optimization
   */
  function abort() {
    if (worker) {
      worker.terminate()
      worker = null
    }
    isRunning.value = false
    progressText.value = 'Abgebrochen'
  }

  /**
   * Clears results
   */
  function clearResults() {
    results.value = null
    error.value = null
    progress.value = 0
    progressText.value = ''
  }

  return {
    // State
    isRunning,
    progress,
    progressText,
    results,
    error,
    config,
    // Computed
    hasResults,
    bestCandidate,
    // Actions
    startOptimization,
    applyBestResult,
    abort,
    clearResults
  }
})
