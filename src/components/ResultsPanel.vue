<script setup>
import { useUiStore } from '../stores/ui'
import { useMonteCarloStore } from '../stores/monteCarlo'
import StandardTab from './StandardTab.vue'
import MonteCarloTab from './MonteCarloTab.vue'
import YearlyTableTab from './YearlyTableTab.vue'

const uiStore = useUiStore()
const mcStore = useMonteCarloStore()

const tabs = [
  { id: 'standard', label: 'Standard', icon: 'chart' },
  { id: 'tabelle', label: 'Jahresübersicht', icon: 'table' },
  { id: 'monte-carlo', label: 'Monte-Carlo', icon: 'dice' }
]

function handleStartOptimizer() {
  // TODO: Optimizer-Logik implementieren
  uiStore.showOptimizerModal = true
}
</script>

<template>
  <section aria-label="Simulationsergebnisse">
    <!-- Tab Navigation -->
    <div class="tabs" role="tablist" aria-label="Ergebnis-Ansichten">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab"
        :class="{ 'tab--active': uiStore.activeTab === tab.id }"
        role="tab"
        :aria-selected="uiStore.activeTab === tab.id"
        @click="uiStore.setActiveTab(tab.id)"
      >
        <svg v-if="tab.icon === 'chart'" class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3v18h18"/><path d="M18 9l-5 5-4-4-3 3"/>
        </svg>
        <svg v-else-if="tab.icon === 'table'" class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>
        </svg>
        <svg v-else-if="tab.icon === 'dice'" class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
        </svg>
        {{ tab.label }}
        <span v-if="tab.id === 'monte-carlo' && mcStore.hasResults" class="tab-badge">✓</span>
      </button>
    </div>

    <!-- Tab Contents -->
    <StandardTab v-show="uiStore.activeTab === 'standard'" />
    <YearlyTableTab v-show="uiStore.activeTab === 'tabelle'" />
    <MonteCarloTab v-show="uiStore.activeTab === 'monte-carlo'" @start-optimizer="handleStartOptimizer" />
  </section>
</template>
