import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useUiStore = defineStore('ui', () => {
  // State
  const theme = ref('dark')
  const activeTab = ref('standard')
  const showInfoModal = ref(false)
  const showFormulaModal = ref(false)
  const showWizardModal = ref(false)
  const showOptimizerModal = ref(false)
  const showBavComparisonModal = ref(false)
  const expertMode = ref(false)
  const standardChartLogScale = ref(false)
  const mcChartLogScale = ref(true)
  const showStatsNominal = ref(true)
  const showMcStatsNominal = ref(true)

  // Computed
  const isDarkTheme = computed(() => theme.value === 'dark')

  // Actions
  function initTheme() {
    const saved = localStorage.getItem('theme')
    if (saved) {
      theme.value = saved
    } else {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      theme.value = prefersDark ? 'dark' : 'light'
    }
    applyTheme()
  }

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    localStorage.setItem('theme', theme.value)
    applyTheme()
  }

  function applyTheme() {
    document.body.classList.toggle('theme-light', theme.value === 'light')
  }

  function setActiveTab(tab) {
    activeTab.value = tab
  }

  function closeAllModals() {
    showInfoModal.value = false
    showFormulaModal.value = false
    showWizardModal.value = false
    showOptimizerModal.value = false
    showBavComparisonModal.value = false
  }

  function toggleExpertMode() {
    expertMode.value = !expertMode.value
  }

  function toggleStandardChartScale() {
    standardChartLogScale.value = !standardChartLogScale.value
  }

  function toggleMcChartScale() {
    mcChartLogScale.value = !mcChartLogScale.value
  }

  return {
    // State
    theme,
    activeTab,
    showInfoModal,
    showFormulaModal,
    showWizardModal,
    showOptimizerModal,
    showBavComparisonModal,
    expertMode,
    standardChartLogScale,
    mcChartLogScale,
    showStatsNominal,
    showMcStatsNominal,
    // Computed
    isDarkTheme,
    // Actions
    initTheme,
    toggleTheme,
    setActiveTab,
    closeAllModals,
    toggleExpertMode,
    toggleStandardChartScale,
    toggleMcChartScale
  }
})
