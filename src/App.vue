<script setup>
import { onMounted, watch, nextTick } from 'vue'
import { useScenarioStore } from './stores/scenario'
import { useSimulationStore } from './stores/simulation'
import { useMonteCarloStore } from './stores/monteCarlo'
import { useUiStore } from './stores/ui'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { updateRiskWidget, initChartTooltips } from './core/ui-charts.js'

import TopBar from './components/TopBar.vue'
import InfoModal from './components/InfoModal.vue'
import FormulaModal from './components/FormulaModal.vue'
import WizardModal from './components/WizardModal.vue'
import OptimizerModal from './components/OptimizerModal.vue'
import BavComparisonModal from './components/BavComparisonModal.vue'
import ScenarioForm from './components/ScenarioForm.vue'
import ResultsPanel from './components/ResultsPanel.vue'

const scenarioStore = useScenarioStore()
const simulationStore = useSimulationStore()
const mcStore = useMonteCarloStore()
const uiStore = useUiStore()

// Keyboard shortcuts via Composable
useKeyboardShortcuts({
  onRunSimulation: () => simulationStore.runSimulation(),
  onCloseModals: () => uiStore.closeAllModals(),
  onAbortMonteCarlo: () => {
    if (mcStore.isRunning) {
      mcStore.abortSimulation()
      return true
    }
    return false
  },
  onToggleTab: (tab) => uiStore.setActiveTab(tab)
})

onMounted(async () => {
  // Initialize theme from localStorage
  uiStore.initTheme()
  // Initialize scenarios from localStorage
  scenarioStore.initFromStorage()
  // Try to load scenario from share URL (if present)
  scenarioStore.loadFromShareUrl()

  // Ensure DOM containers exist before initializing chart helpers
  await nextTick()
  updateRiskWidget(simulationStore.history, mcStore.results)
  initChartTooltips()
})

watch(
  () => [simulationStore.history, mcStore.results],
  () => {
    updateRiskWidget(simulationStore.history, mcStore.results)
  },
  { deep: true }
)
</script>

<template>
  <a href="#sim-form" class="skip-link">Zum Formular springen</a>
  
  <TopBar />
  
  <InfoModal v-if="uiStore.showInfoModal" @close="uiStore.showInfoModal = false" />
  <FormulaModal v-if="uiStore.showFormulaModal" @close="uiStore.showFormulaModal = false" />
  <WizardModal v-if="uiStore.showWizardModal" @close="uiStore.showWizardModal = false" />
  <OptimizerModal v-if="uiStore.showOptimizerModal" @close="uiStore.showOptimizerModal = false" />
  <BavComparisonModal v-if="uiStore.showBavComparisonModal" @close="uiStore.showBavComparisonModal = false" />
  
  <main class="page" role="main">
    <ScenarioForm class="panel panel--inputs" />
    <ResultsPanel class="panel panel--results" />
  </main>

  <!-- Global tooltip & Risiko-Widget Container (for legacy-style helpers) -->
  <div id="tooltip" class="tooltip" data-visible="false"></div>
  <div class="risk-widget-container">
    <div id="risk-widget" class="risk-widget"></div>
  </div>
</template>

<style>
/* Styles are imported globally from assets/styles.css */
</style>
