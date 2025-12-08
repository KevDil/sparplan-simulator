<script setup>
import { computed } from 'vue'
import { useMonteCarloStore } from '../stores/monteCarlo'
import { useScenarioStore } from '../stores/scenario'
import { useSimulationStore } from '../stores/simulation'
import { useUiStore } from '../stores/ui'
import { useFormatting } from '../composables/useFormatting'
import { exportMonteCarloToCsv } from '../core/export'
import { generateMcSummaryText } from '../core/mc-analysis'
import StatsCard from './StatsCard.vue'
import MonteCarloChart from './MonteCarloChart.vue'

const mcStore = useMonteCarloStore()
const scenarioStore = useScenarioStore()
const simulationStore = useSimulationStore()
const uiStore = useUiStore()
const { formatCurrency, formatPercent } = useFormatting()

// Generate summary text from MC results
const summaryText = computed(() => {
  if (!mcStore.results) return ''
  const params = simulationStore.buildSimulationParams(scenarioStore.activeScenario)
  return generateMcSummaryText(mcStore.results, params)
})

// Export handler
function handleMcCsvExport() {
  if (!mcStore.results) return
  try {
    exportMonteCarloToCsv(mcStore.results, scenarioStore.activeScenario)
  } catch (err) {
    alert(err.message)
  }
}

// Success rate class
const successRateClass = computed(() => {
  const rate = mcStore.successRate
  if (rate >= 95) return 'success-high'
  if (rate >= 80) return 'success-medium'
  return 'success-low'
})

// SoRR explanation text (adapted from legacy updateMcStats)
const sorrExplanation = computed(() => {
  const sorr = mcStore.results?.sorr
  if (!sorr) return ''
  const windowYears = sorr.vulnerabilityWindow || 5
  return `Die SoRR-Auswertung betrachtet die ersten ${windowYears} Jahre der Entnahmephase und vergleicht frühe Crash- vs. Boom-Szenarien. Hohe Werte bedeuten, dass die Reihenfolge der Renditen einen starken Einfluss auf das Endvermögen hat.`
})

const showNominal = computed(() => uiStore.showMcStatsNominal)

defineEmits(['start-optimizer'])
</script>

<template>
  <div class="tab-content" role="tabpanel">
    <!-- Empty State -->
    <div v-if="!mcStore.hasResults && !mcStore.isRunning" class="mc-empty-state">
      <div class="mc-empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </div>
      <h3>Monte-Carlo-Simulation starten</h3>
      <p>Klicke auf "Monte-Carlo starten" um eine stochastische Analyse mit variabler ETF-Rendite durchzuführen.</p>
      <p class="mc-empty-hint">Die Simulation führt hunderte Durchläufe mit zufälligen Renditen durch und zeigt die Erfolgswahrscheinlichkeit deiner Entnahme-Strategie.</p>
    </div>

    <!-- Results -->
    <div v-else class="mc-results">
      <!-- Progress Bar -->
      <div v-if="mcStore.isRunning" class="mc-progress-bar">
        <progress :value="mcStore.progress" max="100"></progress>
        <span>{{ mcStore.progressText }}</span>
      </div>

      <!-- Highlight: Success Rate -->
      <div v-if="mcStore.hasResults" class="mc-highlight">
        <div class="mc-highlight-main">
          <span class="mc-highlight-label">Erfolgswahrscheinlichkeit</span>
          <span class="mc-highlight-value" :class="successRateClass">
            {{ formatPercent(mcStore.successRate) }}
          </span>
          <span class="mc-highlight-hint">
            Keine Entnahme-Shortfalls & Endvermögen > Schwelle
          </span>
        </div>
        <div class="mc-highlight-meta">
          {{ mcStore.results?.iterations || '-' }} Simulationen durchgeführt
        </div>
      </div>

      <!-- Summary Text (like legacy green info box) -->
      <div v-if="mcStore.hasResults && summaryText" class="mc-summary-box">
        <div class="mc-summary-icon">💡</div>
        <div class="mc-summary-text" v-html="summaryText"></div>
      </div>

      <!-- Chart -->
      <template v-if="mcStore.hasResults">
        <div class="result-header">
          <div>
            <p class="eyebrow">Visualisierung</p>
            <h2>Vermögensverteilung über Zeit</h2>
          </div>
          <div class="chart-controls">
            <button
              type="button"
              class="btn btn--small btn--ghost"
              @click="handleMcCsvExport"
              title="MC-Ergebnisse als CSV exportieren"
            >
              📊 CSV Export
            </button>
            <span class="divider"></span>
            <button
              type="button"
              class="btn-scale"
              :class="{ 'btn-scale--active': uiStore.mcChartLogScale }"
              @click="uiStore.mcChartLogScale = true"
              title="Logarithmische Skala"
            >
              Log
            </button>
            <button
              type="button"
              class="btn-scale"
              :class="{ 'btn-scale--active': !uiStore.mcChartLogScale }"
              @click="uiStore.mcChartLogScale = false"
              title="Lineare Skala"
            >
              Linear
            </button>
          </div>
        </div>
        
        <div class="mc-legend">
          <span class="legend__item"><span class="dot dot--mc-median"></span>Median (50%)</span>
          <span class="legend__item"><span class="dot dot--mc-50"></span>25%-75%</span>
          <span class="legend__item"><span class="dot dot--mc-80"></span>10%-90%</span>
          <span class="legend__item"><span class="dot dot--mc-p5"></span>5% (Worst)</span>
          <span class="legend__item"><span class="dot dot--mc-p95"></span>95% (Best)</span>
        </div>
        
        <div class="graph-wrapper">
          <MonteCarloChart
            :results="mcStore.results"
            :log-scale="uiStore.mcChartLogScale"
          />
        </div>

        <!-- Stats -->
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
              @click="uiStore.showMcStatsNominal = true"
            >
              Nominal
            </button>
            <button
              type="button"
              class="stats-toggle-btn"
              :class="{ 'stats-toggle-btn--active': !showNominal }"
              @click="uiStore.showMcStatsNominal = false"
            >
              Inflationsbereinigt
            </button>
          </div>
        </div>
        
        <!-- Nominal Stats -->
        <div v-show="showNominal" class="stats-section">
          <div class="mc-stats-section">
            <h4 class="mc-stats-title">Endvermögen</h4>
            <div class="stats-grid stats-grid--mc">
              <StatsCard
                label="Median (50%)"
                :value="formatCurrency(mcStore.results?.medianEnd)"
                variant="mc"
                hint="Typischer Verlauf"
              />
              <StatsCard
                label="Spanne (10%-90%)"
                :value="`${formatCurrency(mcStore.results?.p10End)} - ${formatCurrency(mcStore.results?.p90End)}`"
                variant="mc"
                hint="80% Konfidenzintervall"
              />
              <StatsCard
                label="Konservativ (25%)"
                :value="formatCurrency(mcStore.results?.p25End)"
                variant="worst"
                hint="Jeder 4. Fall ist schlechter"
              />
              <StatsCard
                label="Optimistisch (75%)"
                :value="formatCurrency(mcStore.results?.p75End)"
                variant="best"
                hint="Jeder 4. Fall ist besser"
              />
            </div>
          </div>

          <div class="mc-stats-section">
            <h4 class="mc-stats-title">Entnahmen & Rente</h4>
            <div class="stats-grid stats-grid--mc">
              <StatsCard
                label="Ø Monatliche Rente"
                :value="formatCurrency(mcStore.results?.medianAvgWithdrawalNet)"
                variant="mc"
                hint="Median über alle Simulationen"
              />
              <StatsCard
                label="Entnahmen Gesamt"
                :value="formatCurrency(mcStore.results?.medianTotalWithdrawalGross)"
                variant="mc"
                hint="Median Gesamtentnahme"
              />
              <StatsCard
                label="Vermögen bei Rentenbeginn"
                :value="formatCurrency(mcStore.results?.retirementMedian)"
                variant="best"
                hint="Median zu Start der Entnahme"
              />
              <StatsCard
                label="Durchschnittl. Endvermögen"
                :value="formatCurrency(mcStore.results?.meanEnd)"
                variant="mc"
                hint="Arithmetisches Mittel"
              />
            </div>
          </div>

          <div class="mc-stats-section">
            <h4 class="mc-stats-title">Risikokennzahlen</h4>
            <div class="stats-grid stats-grid--mc">
              <StatsCard
                label="Kapitalerhalt (nominal)"
                :value="formatPercent(mcStore.results?.capitalPreservationRate)"
                variant="mc"
                hint="Endvermögen ≥ Startvermögen (ohne Inflationsausgleich)"
              />
              <StatsCard
                label="Pleite-Risiko (P&D)"
                :value="formatPercent(mcStore.ruinProbability)"
                variant="mc"
                hint="Vermögen unter Ruin-Schwelle oder Shortfall in Entnahmephase"
              />
              <StatsCard
                label="Shortfall-Quote (Entnahme)"
                :value="formatPercent(mcStore.results?.entnahmeShortfallRate)"
                variant="mc"
                hint="Entnahme < Ziel (Min. SWR unter 2+ Jahre Delay)"
              />
            </div>
          </div>

          <div class="mc-stats-section" v-if="mcStore.results?.emergencyFillProbability > 0">
            <h4 class="mc-stats-title">Notgroschen (Monte-Carlo)</h4>
            <div class="stats-grid stats-grid--mc">
              <StatsCard
                label="Wird gefüllt"
                :value="formatPercent(mcStore.results?.emergencyFillProbability)"
                variant="mc"
                hint="Anteil der Pfade mit erreichtem TG-Ziel"
              />
              <StatsCard
                v-if="mcStore.results?.emergencyMedianFillYears"
                label="Zeit bis voll"
                :value="`${mcStore.results?.emergencyMedianFillYears?.toFixed(1)} Jahre`"
                variant="mc"
                hint="Median Zeit-Phase, in denen er gefüllt wird"
              />
            </div>
          </div>
        </div>
        
        <!-- Real Stats -->
        <div v-show="!showNominal" class="stats-section">
          <div class="mc-stats-section">
            <h4 class="mc-stats-title">Endvermögen (Kaufkraft heute)</h4>
            <div class="stats-grid stats-grid--mc">
              <StatsCard
                label="Median (50%)"
                :value="formatCurrency(mcStore.results?.medianEndReal)"
                variant="mc"
                highlight
                hint="Typischer Verlauf in heutiger Kaufkraft"
              />
              <StatsCard
                label="Spanne (10%-90%)"
                :value="`${formatCurrency(mcStore.results?.p10EndReal)} - ${formatCurrency(mcStore.results?.p90EndReal)}`"
                variant="mc"
                hint="80% Konfidenzintervall"
              />
              <StatsCard
                label="Konservativ (25%)"
                :value="formatCurrency(mcStore.results?.p25EndReal)"
                variant="worst"
                hint="In heutiger Kaufkraft"
              />
              <StatsCard
                label="Optimistisch (75%)"
                :value="formatCurrency(mcStore.results?.p75EndReal)"
                variant="best"
                hint="In heutiger Kaufkraft (75%-Perzentil)"
              />
            </div>
          </div>

          <div class="mc-stats-section">
            <h4 class="mc-stats-title">Entnahmen & Rente (real)</h4>
            <div class="stats-grid stats-grid--mc">
              <StatsCard
                label="Ø Monatliche Rente"
                :value="formatCurrency(mcStore.results?.medianAvgWithdrawalNetReal)"
                variant="mc"
                hint="Median über alle Simulationen (real)"
              />
              <StatsCard
                label="Entnahmen Gesamt"
                :value="formatCurrency(mcStore.results?.medianTotalWithdrawalGrossReal)"
                variant="mc"
                hint="Median Gesamtentnahme (real)"
              />
              <StatsCard
                label="Vermögen bei Rentenbeginn"
                :value="formatCurrency(mcStore.results?.retirementMedianReal)"
                variant="best"
                hint="Median zu Start der Entnahme (real)"
              />
              <StatsCard
                label="Durchschnittl. Endvermögen"
                :value="formatCurrency(mcStore.results?.meanEndReal)"
                variant="mc"
                hint="Arithmetisches Mittel (inflationsbereinigt)"
              />
            </div>
          </div>

          <div class="mc-stats-section">
            <h4 class="mc-stats-title">Risikokennzahlen</h4>
            <div class="stats-grid stats-grid--mc">
              <StatsCard
                label="Kapitalerhalt (real)"
                :value="formatPercent(mcStore.results?.capitalPreservationRateReal)"
                variant="mc"
                hint="Kaufkraft erhalten"
              />
              <StatsCard
                label="Pleite-Risiko (P&D)"
                :value="formatPercent(mcStore.ruinProbability)"
                variant="mc"
                hint="Vermögen unter Ruin-Schwelle oder Shortfall in Entnahmephase"
              />
              <StatsCard
                label="Shortfall-Quote (Entnahme)"
                :value="formatPercent(mcStore.results?.entnahmeShortfallRate)"
                variant="mc"
                hint="Entnahme < Ziel (Min. SWR unter 2+ Jahre Delay)"
              />
            </div>
          </div>
        </div>

        <!-- Sequence-of-Returns Risk (SoRR) -->
        <div v-if="mcStore.results?.sorr" class="mc-stats-section mc-additional-stats">
          <h4 class="mc-stats-title">Sequence-of-Returns-Risk (SoRR)</h4>
          <p class="mc-stats-desc">{{ sorrExplanation }}</p>

          <div class="stats-grid stats-grid--sorr">
            <StatsCard
              label="SoRR-Spreizung"
              :value="formatPercent(mcStore.results?.sorr?.sorRiskScore || 0)"
              variant="sorr-main"
              hint="Unterschied beste vs. schlechteste Sequenz"
            />
            <StatsCard
              label="Früher Crash-Effekt"
              :value="formatCurrency(mcStore.results?.sorr?.worstSequenceEnd || 0)"
              variant="worst"
              hint="Endvermögen-Reduktion bei frühem Crash"
            />
            <StatsCard
              label="Früher Boom-Effekt"
              :value="formatCurrency(mcStore.results?.sorr?.bestSequenceEnd || 0)"
              variant="best"
              hint="Endvermögen-Bonus bei frühen Boom"
            />
            <StatsCard
              label="Korrelation (frühe Rendite → Ende)"
              :value="formatPercent(Math.abs(mcStore.results?.sorr?.correlationEarlyReturns || 0) * 100)"
              variant="mc"
              hint="Wie stark beeinflusst 'frühe Jahre' das Ergo"
            />
            <StatsCard
              label="Endvermögen (schlechte Sequenz)"
              :value="formatCurrency(mcStore.results?.sorr?.worstSequenceEnd || 0)"
              variant="worst"
              hint="Ø bei schlechten frühen Renditen"
            />
            <StatsCard
              label="Endvermögen (gute Sequenz)"
              :value="formatCurrency(mcStore.results?.sorr?.bestSequenceEnd || 0)"
              variant="best"
              hint="Ø bei guten frühen Renditen"
            />
            <StatsCard
              label="Kritisches Fenster"
              :value="String(mcStore.results?.sorr?.vulnerabilityWindow || 5)"
              variant="mc"
              hint="Höchste Sensitivität in diesen Jahren"
            />
          </div>
        </div>

        <!-- Parameter optimieren Button -->
        <div v-if="mcStore.hasResults" class="mc-optimize-section">
          <button
            type="button"
            class="btn btn--primary btn--optimize"
            @click="$emit('start-optimizer')"
          >
            Parameter optimieren
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
