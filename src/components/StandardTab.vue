<script setup>
import { computed } from 'vue'
import { useSimulationStore } from '../stores/simulation'
import { useScenarioStore } from '../stores/scenario'
import { useMonteCarloStore } from '../stores/monteCarlo'
import { useUiStore } from '../stores/ui'
import { useFormatting } from '../composables/useFormatting'
import { exportStandardToCsv, openHtmlReportForPrint } from '../core/export'
import StatsCard from './StatsCard.vue'
import StandardChart from './StandardChart.vue'

const simulationStore = useSimulationStore()
const scenarioStore = useScenarioStore()
const mcStore = useMonteCarloStore()
const uiStore = useUiStore()
const { formatCurrency, formatPercent } = useFormatting()

// Export handlers
function handleCsvExport() {
  // Need raw history with snake_case for export
  // The simulationStore.history is already transformed, we need to re-run or use different approach
  // For now, use the transformed history - export.js handles both formats
  const history = simulationStore.history
  const scenario = scenarioStore.activeScenario
  try {
    exportStandardToCsv(history, scenario)
  } catch (err) {
    alert(err.message)
  }
}

function handlePdfExport() {
  const history = simulationStore.history
  const mcResults = mcStore.hasResults ? mcStore.results : null
  const scenario = scenarioStore.activeScenario
  try {
    openHtmlReportForPrint(history, mcResults, scenario)
  } catch (err) {
    alert(err.message)
  }
}

// Computed stats
const stats = computed(() => simulationStore.stats)
const showNominal = computed(() => uiStore.showStatsNominal)

// Warning message based on results
const warningMessage = computed(() => {
  if (!stats.value) return null
  const lastEntry = simulationStore.history[simulationStore.history.length - 1]
  if (!lastEntry) return null
  
  if (lastEntry.total <= 0) {
    return { type: 'critical', text: '⚠️ Das Vermögen ist aufgebraucht!' }
  }
  if (lastEntry.totalReal < 10000) {
    return { type: 'warning', text: '⚠️ Das Endvermögen (real) ist sehr gering.' }
  }
  return { type: 'ok', text: '✅ Das Vermögen reicht über den gesamten Zeitraum.' }
})
</script>

<template>
  <div class="tab-content tab-content--active" role="tabpanel">
    <div class="result-header">
      <div>
        <p class="eyebrow">Visualisierung</p>
        <h2>Vermögensverlauf</h2>
      </div>
      <div class="chart-controls">
        <button
          type="button"
          class="btn btn--small btn--ghost"
          @click="handleCsvExport"
          title="Als CSV exportieren"
          :disabled="!simulationStore.hasResults"
        >
          📊 CSV
        </button>
        <button
          type="button"
          class="btn btn--small btn--ghost"
          @click="handlePdfExport"
          title="Als PDF drucken"
          :disabled="!simulationStore.hasResults"
        >
          🖨️ PDF
        </button>
        <span class="divider"></span>
        <button
          type="button"
          class="btn-scale"
          :class="{ 'btn-scale--active': uiStore.standardChartLogScale }"
          @click="uiStore.standardChartLogScale = true"
          title="Logarithmische Skala"
        >
          Log
        </button>
        <button
          type="button"
          class="btn-scale"
          :class="{ 'btn-scale--active': !uiStore.standardChartLogScale }"
          @click="uiStore.standardChartLogScale = false"
          title="Lineare Skala"
        >
          Linear
        </button>
      </div>
    </div>
    
    <div class="mc-legend">
      <span class="legend__item"><span class="dot dot--total"></span>Gesamtvermögen</span>
      <span class="legend__item"><span class="dot dot--real"></span>Gesamt (inflationsbereinigt)</span>
    </div>
    
    <div class="graph-wrapper">
      <StandardChart
        :history="simulationStore.history"
        :log-scale="uiStore.standardChartLogScale"
      />
    </div>

    <div class="result-header result-header--stats">
      <div>
        <p class="eyebrow">Zusammenfassung</p>
        <h2>Simulationsergebnisse</h2>
      </div>
      <div class="stats-toggle">
        <button
          type="button"
          class="stats-toggle-btn"
          :class="{ 'stats-toggle-btn--active': showNominal }"
          @click="uiStore.showStatsNominal = true"
        >
          Nominal
        </button>
        <button
          type="button"
          class="stats-toggle-btn"
          :class="{ 'stats-toggle-btn--active': !showNominal }"
          @click="uiStore.showStatsNominal = false"
        >
          Inflationsbereinigt
        </button>
      </div>
    </div>
    
    <div class="stats-panel">
      <!-- Nominale Werte -->
      <div v-show="showNominal" class="stats-section">
        <div class="stats-grid">
          <StatsCard
            label="Endvermögen"
            :value="formatCurrency(simulationStore.endWealth)"
          />
          <StatsCard
            label="Vermögen bei Rentenbeginn"
            :value="formatCurrency(stats?.retirementWealth)"
          />
          <StatsCard
            label="Eingezahlt gesamt"
            :value="formatCurrency(stats?.totalInvested)"
          />
          <StatsCard
            label="Rendite gesamt"
            :value="formatCurrency(stats?.totalReturn)"
          />
          <StatsCard
            label="Ø Entnahme/Monat"
            :value="formatCurrency(stats?.avgMonthlyWithdrawal)"
          />
          <StatsCard
            label="Entnahmen gesamt"
            :value="formatCurrency(stats?.totalWithdrawals)"
          />
          <StatsCard
            label="Steuern gesamt"
            :value="formatCurrency(stats?.totalTax)"
          />
          <StatsCard
            label="davon Vorabpauschale"
            :value="formatCurrency(stats?.totalVorabpauschale)"
          />
          <StatsCard
            label="Effektive Entnahmerate"
            :value="formatPercent(stats?.effectiveWithdrawalRate)"
          />
        </div>
      </div>
      
      <!-- Inflationsbereinigte Werte -->
      <div v-show="!showNominal" class="stats-section">
        <div class="stats-grid">
          <StatsCard
            label="Endvermögen (Kaufkraft heute)"
            :value="formatCurrency(simulationStore.endWealthReal)"
            highlight
          />
          <StatsCard
            label="Vermögen bei Rentenbeginn"
            :value="formatCurrency(stats?.retirementWealthReal)"
            highlight
          />
          <StatsCard
            label="Eingezahlt gesamt"
            :value="formatCurrency(stats?.totalInvested)"
            hint="Nominal, nicht inflationsbereinigt"
          />
          <StatsCard
            label="Rendite gesamt (real)"
            :value="formatCurrency(stats?.totalReturnReal)"
          />
          <StatsCard
            label="Ø Entnahme/Monat"
            :value="formatCurrency(stats?.avgMonthlyWithdrawalReal)"
            highlight
          />
          <StatsCard
            label="Entnahmen gesamt (real)"
            :value="formatCurrency(stats?.totalWithdrawalsReal)"
          />
          <StatsCard
            label="Kaufkraftverlust"
            :value="formatPercent(stats?.purchasingPowerLoss)"
            hint="Durch Inflation über die Laufzeit"
          />
          <StatsCard
            label="Reale Rendite p.a."
            :value="formatPercent(stats?.realReturnPa)"
            hint="Nach Abzug der Inflation"
          />
        </div>
      </div>
      
      <div
        v-if="warningMessage"
        class="stat-warning"
        :class="`stat-warning--${warningMessage.type}`"
      >
        {{ warningMessage.text }}
      </div>
    </div>
  </div>
</template>
