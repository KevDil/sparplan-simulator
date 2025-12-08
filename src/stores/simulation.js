import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useScenarioStore } from './scenario'
import { simulate, analyzeHistory } from '../core/simulation-core'

export const useSimulationStore = defineStore('simulation', () => {
  // State
  const history = ref([])
  const stats = ref(null)
  const isRunning = ref(false)
  const error = ref(null)

  // Computed
  const hasResults = computed(() => history.value.length > 0)
  
  const endWealth = computed(() => {
    if (!history.value.length) return 0
    const last = history.value[history.value.length - 1]
    return last.total
  })

  const endWealthReal = computed(() => {
    if (!history.value.length) return 0
    const last = history.value[history.value.length - 1]
    return last.totalReal
  })

  // Actions
  function runSimulation() {
    const scenarioStore = useScenarioStore()
    const scenario = scenarioStore.activeScenario
    
    isRunning.value = true
    error.value = null
    
    try {
      // Build params from scenario
      const params = buildSimulationParams(scenario)
      
      // Run simulation (volatility=0 for deterministic, options={})
      const simulationHistory = simulate(params, 0, {})
      
      // Map history to UI-expected field names (snake_case → camelCase)
      history.value = mapHistoryForUi(simulationHistory)
      
      // Analyze results and map to UI-expected field names
      const rawStats = analyzeHistory(simulationHistory, params)
      stats.value = mapStatsForUi(rawStats, simulationHistory, params)
    } catch (e) {
      console.error('Simulation error:', e)
      error.value = e.message
    } finally {
      isRunning.value = false
    }
  }

  /**
   * Maps history entries from snake_case to camelCase and normalizes phase names
   */
  function mapHistoryForUi(rawHistory) {
    return rawHistory.map(entry => ({
      ...entry,
      // Map snake_case to camelCase for UI components
      totalReal: entry.total_real,
      savingsContrib: entry.savings_contrib,
      etfContrib: entry.etf_contrib,
      savingsInterest: entry.savings_interest,
      withdrawalReal: entry.withdrawal_real,
      withdrawalNet: entry.withdrawal_net,
      withdrawalNetReal: entry.withdrawal_net_real,
      withdrawalRequested: entry.withdrawal_requested,
      taxShortfall: entry.tax_shortfall,
      monthlyPayout: entry.monthly_payout,
      monthlyPayoutReal: entry.monthly_payout_real,
      taxPaid: entry.tax_paid,
      vorabpauschaleTax: entry.vorabpauschale_tax,
      payoutValue: entry.payout_value,
      payoutPercentPa: entry.payout_percent_pa,
      returnGain: entry.return_gain,
      cumulativeInflation: entry.cumulative_inflation,
      capitalPreservationActive: entry.capital_preservation_active,
      yearlyUsedFreibetrag: entry.yearly_used_freibetrag,
      lossPot: entry.loss_pot,
      // Normalize phase names: "Anspar" → "saving", "Entnahme" → "withdrawal"
      phase: entry.phase === 'Anspar' ? 'saving' : 'withdrawal'
    }))
  }

  /**
   * Maps analyzeHistory output to UI-expected field names and adds derived stats
   */
  function mapStatsForUi(rawStats, history, params) {
    if (!rawStats) return null
    
    const totalYears = params.savings_years + params.withdrawal_years
    const lastRow = history[history.length - 1]
    const cumulativeInflation = lastRow?.cumulative_inflation || 1
    
    // Calculate real values
    const totalReturnReal = rawStats.totalReturn / cumulativeInflation
    const totalWithdrawalsReal = rawStats.totalWithdrawals / cumulativeInflation
    const avgWithdrawalReal = rawStats.avgWithdrawal / cumulativeInflation
    
    // Calculate effective withdrawal rate (at retirement)
    let effectiveWithdrawalRate = 0
    if (rawStats.retirementTotal > 0 && rawStats.avgWithdrawal > 0) {
      effectiveWithdrawalRate = (rawStats.avgWithdrawal * 12 / rawStats.retirementTotal) * 100
    }
    
    // Calculate purchasing power loss
    const purchasingPowerLoss = ((cumulativeInflation - 1) / cumulativeInflation) * 100
    
    // Calculate real return p.a. (geometric mean)
    // Note: rawStats.totalInvested already includes start_savings + start_etf, so don't add them again
    const totalInitial = rawStats.totalInvested
    let realReturnPa = 0
    if (totalInitial > 0 && totalYears > 0) {
      const totalEndReal = rawStats.endTotalReal + totalWithdrawalsReal
      const growthFactor = totalEndReal / totalInitial
      realReturnPa = (Math.pow(growthFactor, 1 / totalYears) - 1) * 100
    }
    
    return {
      // Original fields (mapped names for UI compatibility)
      endTotal: rawStats.endTotal,
      endTotalReal: rawStats.endTotalReal,
      retirementWealth: rawStats.retirementTotal,      // Alias for UI
      retirementWealthReal: rawStats.retirementTotalReal,
      retirementTotal: rawStats.retirementTotal,       // Keep original
      retirementTotalReal: rawStats.retirementTotalReal,
      totalInvested: rawStats.totalInvested,
      totalReturn: rawStats.totalReturn,
      totalTax: rawStats.totalTax,
      totalVorabpauschale: rawStats.totalVorabpauschale,
      avgMonthlyWithdrawal: rawStats.avgWithdrawal,    // Alias for UI
      avgWithdrawal: rawStats.avgWithdrawal,           // Keep original
      minWithdrawal: rawStats.minWithdrawal,
      maxWithdrawal: rawStats.maxWithdrawal,
      totalWithdrawals: rawStats.totalWithdrawals,
      hasShortfall: rawStats.hasShortfall,
      shortfallMonths: rawStats.shortfallMonths,
      capitalPreservationMonths: rawStats.capitalPreservationMonths,
      finalLossPot: rawStats.finalLossPot,
      cumulativeInflation: rawStats.cumulativeInflation,
      
      // Derived real values
      totalReturnReal,
      totalWithdrawalsReal,
      avgMonthlyWithdrawalReal: avgWithdrawalReal,
      
      // Derived metrics
      effectiveWithdrawalRate,
      purchasingPowerLoss,
      realReturnPa
    }
  }

  function buildSimulationParams(scenario) {
    // Build params with snake_case names as expected by simulation-core.js
    // CRITICAL: Respect rentMode - only set the relevant payout field, set other to null
    // This matches legacy behavior in legacy/state.js:634-635
    const isEurMode = scenario.rentMode === 'eur'
    
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
      monthly_payout_net: isEurMode ? scenario.rentEur : null,
      monthly_payout_percent: isEurMode ? null : scenario.rentPercent,
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

  function clearResults() {
    history.value = []
    stats.value = null
    error.value = null
  }

  return {
    // State
    history,
    stats,
    isRunning,
    error,
    // Computed
    hasResults,
    endWealth,
    endWealthReal,
    // Actions
    runSimulation,
    buildSimulationParams,
    clearResults
  }
})
