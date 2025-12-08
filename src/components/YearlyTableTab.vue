<script setup>
import { computed } from 'vue'
import { useSimulationStore } from '../stores/simulation'
import { useScenarioStore } from '../stores/scenario'
import { useFormatting } from '../composables/useFormatting'
import { exportYearlyToCsv } from '../core/export'

const simulationStore = useSimulationStore()
const scenarioStore = useScenarioStore()
const { formatCurrency } = useFormatting()

// Group history by year
const yearlyData = computed(() => {
  const history = simulationStore.history
  if (!history.length) return []
  
  const years = []
  for (let i = 0; i < history.length; i += 12) {
    const yearEnd = history[Math.min(i + 11, history.length - 1)]
    const yearStart = i > 0 ? history[i - 1] : { total: 0, savings: 0, etf: 0 }
    
    const yearNumber = Math.floor(i / 12) + 1
    const yearData = {
      year: yearNumber,
      phase: yearEnd.phase === 'saving' ? 'Anspar' : 'Entnahme',
      savingsEnd: yearEnd.savings,
      etfEnd: yearEnd.etf,
      totalEnd: yearEnd.total,
      totalReal: yearEnd.totalReal,
      deposited: 0,
      withdrawn: 0,
      taxPaid: 0
    }
    
    // Sum up values for this year
    for (let m = i; m < Math.min(i + 12, history.length); m++) {
      const month = history[m]
      yearData.deposited += (month.savingsContrib || 0) + (month.etfContrib || 0)
      yearData.withdrawn += (month.withdrawal || 0)
      yearData.taxPaid += (month.taxPaid || 0)
    }
    
    years.push(yearData)
  }
  
  return years
})

// Export yearly overview as CSV
function handleYearlyCsvExport() {
  const history = simulationStore.history
  const scenario = scenarioStore.activeScenario
  try {
    exportYearlyToCsv(history, scenario)
  } catch (err) {
    alert(err.message)
  }
}
</script>

<template>
  <div class="tab-content" role="tabpanel">
    <div class="result-header">
      <div>
        <p class="eyebrow">Detailansicht</p>
        <h2>Jahresübersicht</h2>
      </div>
      <div class="chart-controls">
        <button
          type="button"
          class="btn btn--small btn--ghost"
          @click="handleYearlyCsvExport"
          title="Jahresübersicht als CSV exportieren"
          :disabled="yearlyData.length === 0"
        >
          CSV
        </button>
      </div>
    </div>
    
    <div v-if="yearlyData.length === 0" class="mc-empty-state">
      <h3>Keine Daten vorhanden</h3>
      <p>Starte eine Simulation um die Jahresübersicht zu sehen.</p>
    </div>
    
    <div v-else class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Jahr</th>
            <th>Phase</th>
            <th>Tagesgeld</th>
            <th>ETF</th>
            <th>Gesamt</th>
            <th>Gesamt (real)</th>
            <th>Eingezahlt</th>
            <th>Entnommen</th>
            <th>Steuern</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in yearlyData" :key="row.year">
            <td>{{ row.year }}</td>
            <td>{{ row.phase }}</td>
            <td>{{ formatCurrency(row.savingsEnd) }}</td>
            <td>{{ formatCurrency(row.etfEnd) }}</td>
            <td>{{ formatCurrency(row.totalEnd) }}</td>
            <td>{{ formatCurrency(row.totalReal) }}</td>
            <td>{{ formatCurrency(row.deposited) }}</td>
            <td>{{ formatCurrency(row.withdrawn) }}</td>
            <td>{{ formatCurrency(row.taxPaid) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
