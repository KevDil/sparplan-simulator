<script setup>
import { computed, watch, ref } from 'vue'
import { useScenarioStore } from '../stores/scenario'
import { useSimulationStore } from '../stores/simulation'
import { useMonteCarloStore } from '../stores/monteCarlo'
import { useUiStore } from '../stores/ui'
import { SCENARIO_PRESETS, STRESS_SCENARIOS } from '../core/constants'

const scenarioStore = useScenarioStore()
const simulationStore = useSimulationStore()
const mcStore = useMonteCarloStore()
const uiStore = useUiStore()

const scenario = computed(() => scenarioStore.activeScenario)

// Refs for file input and share status
const fileInput = ref(null)
const shareStatus = ref('')
const isToolsMenuOpen = ref(false)

// Update scenario field
function updateField(field, value) {
  scenarioStore.updateScenario({ [field]: value })
}

// Handle file import
async function handleFileImport(event) {
  const file = event.target.files?.[0]
  if (!file) return
  
  try {
    await scenarioStore.importScenarioFromJson(file)
    simulationStore.runSimulation()
    shareStatus.value = 'Import erfolgreich!'
    setTimeout(() => shareStatus.value = '', 3000)
  } catch (err) {
    shareStatus.value = err.message
    setTimeout(() => shareStatus.value = '', 5000)
  }
  
  // Reset file input
  event.target.value = ''
}

// Handle share URL copy
async function handleShareUrl() {
  const result = await scenarioStore.copyShareUrl()
  if (result.success) {
    shareStatus.value = 'Link kopiert!'
  } else {
    // Fallback: show URL in prompt
    prompt('Share-URL:', result.url)
    shareStatus.value = ''
  }
  setTimeout(() => shareStatus.value = '', 3000)
}

function toggleToolsMenu() {
  isToolsMenuOpen.value = !isToolsMenuOpen.value
}

function closeToolsMenu() {
  isToolsMenuOpen.value = false
}

function handleExportClick() {
  scenarioStore.exportScenarioAsJson()
  closeToolsMenu()
}

function openFilePicker() {
  if (fileInput.value) {
    fileInput.value.click()
  }
  closeToolsMenu()
}

async function handleShareClick() {
  await handleShareUrl()
  closeToolsMenu()
}

// Handle form submit
function handleSubmit() {
  simulationStore.runSimulation()
}

// Handle Monte Carlo start
function handleMonteCarlo() {
  if (mcStore.isRunning) {
    mcStore.abortSimulation()
  } else {
    mcStore.startSimulation()
    uiStore.setActiveTab('monte-carlo')
    setTimeout(() => {
      const resultsPanel = document.querySelector('.panel--results')
      if (resultsPanel && typeof resultsPanel.scrollIntoView === 'function') {
        resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 0)
  }
}

function handleRenameScenario(id) {
  const current = scenarioStore.scenarios[id]?.name || `Szenario ${id}`
  const next = prompt('Szenario umbenennen', current)
  if (!next) return
  const trimmed = next.trim()
  if (!trimmed) return
  scenarioStore.renameScenario(id, trimmed)
}

function handleRemoveScenario(id) {
  if (!scenarioStore.hasMultipleScenarios) return
  const name = scenarioStore.scenarios[id]?.name || `Szenario ${id}`
  if (confirm(`Szenario "${name}" wirklich löschen?`)) {
    scenarioStore.removeScenario(id)
  }
}

// Handle reset
function handleReset() {
  scenarioStore.resetScenario()
  simulationStore.runSimulation()
}

// Auto-update sparerpauschbetrag when married status changes
watch(() => scenario.value?.isMarried, (isMarried) => {
  if (isMarried !== undefined) {
    updateField('sparerpauschbetrag', isMarried ? 2000 : 1000)
  }
})

// Available presets
const presets = computed(() => Object.entries(SCENARIO_PRESETS || {}).map(([key, preset]) => ({
  key,
  ...preset
})))

// Available stress scenarios
const stressScenarios = computed(() => Object.entries(STRESS_SCENARIOS || {}).map(([key, scenario]) => ({
  key,
  ...scenario
})))
</script>

<template>
  <section aria-label="Eingabeparameter">
    <!-- Szenario-Tabs -->
    <div class="scenario-header">
      <div class="scenario-tabs">
        <button
          v-for="id in scenarioStore.scenarioIds"
          :key="id"
          class="scenario-tab"
          :class="{ 'scenario-tab--active': scenarioStore.activeScenarioId === id }"
          @click="scenarioStore.setActiveScenario(id)"
        >
          <span class="scenario-tab-label">
            {{ scenarioStore.scenarios[id]?.name || `Szenario ${id}` }}
          </span>
          <span
            class="scenario-tab-icon"
            role="button"
            aria-label="Szenario umbenennen"
            @click.stop="handleRenameScenario(id)"
          >
            ✎
          </span>
          <span
            v-if="scenarioStore.hasMultipleScenarios"
            class="scenario-tab-icon scenario-tab-icon--danger"
            role="button"
            aria-label="Szenario löschen"
            @click.stop="handleRemoveScenario(id)"
          >
            ×
          </span>
        </button>
        <button
          v-if="scenarioStore.scenarioIds.length < 3"
          class="scenario-tab scenario-tab--add"
          @click="scenarioStore.addScenario()"
          title="Szenario hinzufügen"
        >
          +
        </button>
      </div>
      <div class="scenario-actions">
        <button
          type="button"
          class="btn btn--small btn--ghost expert-toggle"
          @click="uiStore.toggleExpertMode()"
        >
          {{ uiStore.expertMode ? 'Einfacher Modus' : 'Expertenmodus' }}
        </button>
        <div class="scenario-tools">
          <div class="scenario-tools__menu">
            <button
              type="button"
              class="btn btn--small btn--ghost scenario-tools__trigger"
              @click="toggleToolsMenu"
              :aria-expanded="isToolsMenuOpen"
              aria-haspopup="menu"
            >
              ⋯
              <span class="scenario-tools__label">Szenario-Aktionen</span>
            </button>
            <div
              v-if="isToolsMenuOpen"
              class="scenario-tools__dropdown"
              role="menu"
            >
              <button
                type="button"
                class="scenario-tools__item"
                @click="handleExportClick"
                role="menuitem"
              >
                📥 Export als JSON
              </button>
              <button
                type="button"
                class="scenario-tools__item"
                @click="openFilePicker"
                role="menuitem"
              >
                📤 Import aus JSON
              </button>
              <button
                type="button"
                class="scenario-tools__item"
                @click="handleShareClick"
                role="menuitem"
              >
                🔗 Share-Link kopieren
              </button>
            </div>
          </div>
          <input
            ref="fileInput"
            type="file"
            accept=".json"
            style="display: none"
            @change="handleFileImport"
          >
          <span v-if="shareStatus" class="share-status">{{ shareStatus }}</span>
        </div>
      </div>
    </div>

    <!-- Preset-Buttons & Wizard -->
    <div class="preset-section">
      <div class="preset-row">
        <button
          type="button"
          class="btn btn--accent wizard-btn"
          @click="uiStore.showWizardModal = true"
          title="Geführte Einrichtung mit persönlichen Fragen"
        >
          🧙 Setup-Assistent
        </button>
        <span class="preset-label">oder Vorlagen:</span>
        <div class="preset-buttons" v-if="presets.length > 0">
          <button
            v-for="preset in presets"
            :key="preset.key"
            type="button"
            class="preset-btn"
            :title="preset.description"
            @click="scenarioStore.applyPreset(preset.key)"
          >
            {{ preset.name }}
          </button>
        </div>
      </div>
    </div>

    <form id="sim-form" novalidate @submit.prevent="handleSubmit" aria-label="Sparplan-Simulation Formular">
      <!-- Basisdaten & Zinsen -->
      <div class="group">
        <div class="group__header">
          <h2>Basisdaten & Zinsen</h2>
          <p>Startwerte, Zinsen und TG-Ziel.</p>
        </div>
        <div class="grid">
          <label class="field">
            <span class="field-label" data-tooltip="Aktueller Kontostand auf deinem Tagesgeldkonto zu Beginn der Simulation.">Start Tagesgeld (EUR)</span>
            <input
              type="number"
              step="100"
              :value="scenario.startSavings"
              @input="updateField('startSavings', +$event.target.value)"
              min="0"
              max="100000000"
            >
          </label>
          <label class="field">
            <span class="field-label" data-tooltip="Aktueller Wert deines ETF-Depots zu Beginn der Simulation.">Start ETF (EUR)</span>
            <input
              type="number"
              step="100"
              :value="scenario.startEtf"
              @input="updateField('startEtf', +$event.target.value)"
              min="0"
              max="100000000"
            >
          </label>
          <label class="field" v-if="uiStore.expertMode">
            <span class="field-label" data-tooltip="Ursprünglicher Kaufpreis deines ETF-Altbestands.">Einstand Altbestand (EUR)</span>
            <input
              type="number"
              step="100"
              :value="scenario.startEtfCostBasis"
              @input="updateField('startEtfCostBasis', +$event.target.value)"
              min="0"
              max="100000000"
            >
            <small class="field-hint">0 = keine Altgewinne</small>
          </label>
          <label class="field">
            <span class="field-label" data-tooltip="Jährlicher Zinssatz für dein Tagesgeldkonto.">Tagesgeld Zins p.a. (%)</span>
            <input
              type="number"
              step="0.1"
              :value="scenario.savingsRate"
              @input="updateField('savingsRate', +$event.target.value)"
              min="-10"
              max="50"
            >
          </label>
          <label class="field">
            <span class="field-label" data-tooltip="Erwartete jährliche ETF-Rendite vor Kosten.">ETF Rendite p.a. (%)</span>
            <input
              type="number"
              step="0.1"
              :value="scenario.etfRate"
              @input="updateField('etfRate', +$event.target.value)"
              min="-50"
              max="50"
            >
          </label>
          <label class="field">
            <span class="field-label" data-tooltip="Total Expense Ratio - jährliche Fondskosten.">ETF Kosten (TER) p.a. (%)</span>
            <input
              type="number"
              step="0.01"
              :value="scenario.etfTer"
              @input="updateField('etfTer', +$event.target.value)"
              min="0"
              max="5"
            >
          </label>
          <label class="field">
            <span class="field-label" data-tooltip="Ziel-Saldo für Tagesgeld (Notgroschen).">Tagesgeld-Ziel (EUR)</span>
            <input
              type="number"
              step="100"
              :value="scenario.savingsTarget"
              @input="updateField('savingsTarget', +$event.target.value)"
              min="0"
              max="10000000"
            >
          </label>
          <label class="field">
            <span class="field-label" data-tooltip="Jährliche Inflationsrate für Kaufkraftberechnung.">Inflation p.a. (%)</span>
            <input
              type="number"
              step="0.1"
              :value="scenario.inflationRate"
              @input="updateField('inflationRate', +$event.target.value)"
              min="-10"
              max="30"
            >
          </label>
          <label class="field field--checkbox">
            <input
              type="checkbox"
              :checked="scenario.isMarried"
              @change="updateField('isMarried', $event.target.checked)"
            >
            <span class="field-label" data-tooltip="Verdoppelt den Sparerpauschbetrag auf 2.000€.">Verheiratet / gemeinsam veranlagt</span>
          </label>
          <label class="field" v-if="uiStore.expertMode">
            <span class="field-label" data-tooltip="Jährlicher steuerfreier Freibetrag.">Sparerpauschbetrag (EUR)</span>
            <input
              type="number"
              step="100"
              :value="scenario.sparerpauschbetrag"
              @input="updateField('sparerpauschbetrag', +$event.target.value)"
              min="0"
              max="10000"
            >
          </label>
          <label class="field" v-if="uiStore.expertMode">
            <span class="field-label" data-tooltip="Zusätzliche Steuer auf Kapitalerträge für Kirchenmitglieder.">Kirchensteuer</span>
            <select
              :value="scenario.kirchensteuer"
              @change="updateField('kirchensteuer', $event.target.value)"
            >
              <option value="keine">Keine Kirchensteuer</option>
              <option value="8">8% (Bayern, Baden-Württemberg)</option>
              <option value="9">9% (andere Bundesländer)</option>
            </select>
          </label>
          <label class="field" v-if="uiStore.expertMode">
            <span class="field-label" data-tooltip="Fondstyp bestimmt die Teilfreistellung.">Fondstyp (Teilfreistellung)</span>
            <select
              :value="scenario.fondstyp"
              @change="updateField('fondstyp', $event.target.value)"
            >
              <option value="aktien">Aktienfonds (30% steuerfrei)</option>
              <option value="misch">Mischfonds (15% steuerfrei)</option>
              <option value="renten">Rentenfonds/Andere (0% steuerfrei)</option>
            </select>
          </label>
          <label class="field" v-if="uiStore.expertMode">
            <span class="field-label" data-tooltip="Basiszins für Vorabpauschale (§18 InvStG). Für historische Jahre automatisch.">Basiszins (%)</span>
            <input
              type="number"
              step="0.01"
              :value="scenario.basiszins"
              @input="updateField('basiszins', +$event.target.value)"
              min="-1"
              max="10"
            >
            <small class="field-hint">2025: 2,53%</small>
          </label>
          <label class="field" v-if="uiStore.expertMode">
            <span class="field-label" data-tooltip="Verlustvortrag aus Vorjahren.">Start-Verlusttopf (EUR)</span>
            <input
              type="number"
              step="100"
              :value="scenario.lossPot"
              @input="updateField('lossPot', +$event.target.value)"
              min="0"
              max="1000000"
            >
          </label>
          <label class="field field--checkbox" v-if="uiStore.expertMode">
            <input
              type="checkbox"
              :checked="scenario.useLifo"
              @change="updateField('useLifo', $event.target.checked)"
            >
            <span class="field-label" data-tooltip="Last-In-First-Out: Verkauft zuerst die neuesten Anteile. Standard ist FIFO.">LIFO statt FIFO verwenden</span>
          </label>
        </div>
      </div>

      <!-- Ansparphase -->
      <div class="group">
        <div class="group__header">
          <h2>Ansparphase</h2>
          <p>Monatliche Raten, Dynamik und Sonderausgaben.</p>
        </div>
        <div class="grid">
          <label class="field">
            <span class="field-label" data-tooltip="Wie lange du monatlich einzahlen möchtest.">Dauer Ansparen (Jahre)</span>
            <input
              type="number"
              step="1"
              :value="scenario.yearsSave"
              @input="updateField('yearsSave', +$event.target.value)"
              min="1"
              max="100"
            >
          </label>
          <label class="field">
            <span class="field-label" data-tooltip="Monatlicher Sparbetrag auf das Tagesgeldkonto.">Monatlich Tagesgeld (EUR)</span>
            <input
              type="number"
              step="50"
              :value="scenario.monthlySavings"
              @input="updateField('monthlySavings', +$event.target.value)"
              min="0"
              max="1000000"
            >
          </label>
          <label class="field">
            <span class="field-label" data-tooltip="Monatlicher Sparplan-Betrag für den ETF.">Monatlich ETF (EUR)</span>
            <input
              type="number"
              step="50"
              :value="scenario.monthlyEtf"
              @input="updateField('monthlyEtf', +$event.target.value)"
              min="0"
              max="1000000"
            >
          </label>
          <label class="field">
            <span class="field-label" data-tooltip="Jährliche Erhöhung deiner Sparraten.">Gehaltserhöhung p.a. (%)</span>
            <input
              type="number"
              step="0.1"
              :value="scenario.annualRaise"
              @input="updateField('annualRaise', +$event.target.value)"
              min="-10"
              max="50"
            >
          </label>
          <label class="field" v-if="uiStore.expertMode">
            <span class="field-label" data-tooltip="Größere Einmalausgaben in der Ansparphase.">Sonderausgabe Anspar (EUR)</span>
            <input
              type="number"
              step="500"
              :value="scenario.specialSavings"
              @input="updateField('specialSavings', +$event.target.value)"
              min="0"
              max="10000000"
            >
          </label>
          <label class="field" v-if="uiStore.expertMode">
            <span class="field-label" data-tooltip="Alle wie viele Jahre die Sonderausgabe fällig wird.">Sonderausgabe alle X J.</span>
            <input
              type="number"
              step="1"
              :value="scenario.specialSavingsInterval"
              @input="updateField('specialSavingsInterval', +$event.target.value)"
              min="0"
              max="50"
            >
          </label>
        </div>
      </div>

      <!-- Entnahmephase -->
      <div class="group">
        <div class="group__header">
          <h2>Entnahmephase</h2>
          <p>Rentenmodus, Sonderausgaben und Dauer.</p>
        </div>
        <div class="grid grid--split">
          <label class="field">
            <span class="field-label" data-tooltip="Wie lange du monatlich Geld entnehmen möchtest.">Dauer Entnahme (Jahre)</span>
            <input
              type="number"
              step="1"
              :value="scenario.yearsWithdraw"
              @input="updateField('yearsWithdraw', +$event.target.value)"
              min="1"
              max="100"
            >
          </label>
          <div class="field">
            <span class="field-label" data-tooltip="Wähle zwischen fester monatlicher Entnahme oder prozentualem Anteil.">Wunschrente</span>
            <div class="mode-switch">
              <label>
                <input
                  type="radio"
                  name="rent_mode"
                  value="eur"
                  :checked="scenario.rentMode === 'eur'"
                  @change="updateField('rentMode', 'eur')"
                >
                EUR / Monat
              </label>
              <label>
                <input
                  type="radio"
                  name="rent_mode"
                  value="percent"
                  :checked="scenario.rentMode === 'percent'"
                  @change="updateField('rentMode', 'percent')"
                >
                % vom Vermögen (p.a.)
              </label>
            </div>
          </div>
          <label class="field" v-if="scenario.rentMode === 'eur'">
            <span class="field-label" data-tooltip="Fester monatlicher Entnahmebetrag.">Wunschrente (EUR)</span>
            <input
              type="number"
              step="50"
              :value="scenario.rentEur"
              @input="updateField('rentEur', +$event.target.value)"
              min="0"
              max="1000000"
            >
          </label>
          <label class="field" v-if="scenario.rentMode === 'percent'">
            <span class="field-label" data-tooltip="Entnahme als Prozent des Startvermögens (4%-Regel).">Wunschrente % vom Startvermögen p.a.</span>
            <input
              type="number"
              step="0.1"
              :value="scenario.rentPercent"
              @input="updateField('rentPercent', +$event.target.value)"
              min="0"
              max="100"
            >
          </label>
          <label class="field field--checkbox">
            <input
              type="checkbox"
              :checked="scenario.inflationAdjustWithdrawal"
              @change="updateField('inflationAdjustWithdrawal', $event.target.checked)"
            >
            <span class="field-label" data-tooltip="Erhöht die Entnahme jährlich um die Inflation.">Entnahme jährlich inflationsanpassen (4%-Regel)</span>
          </label>
          <label class="field field--checkbox" v-if="uiStore.expertMode">
            <input
              type="checkbox"
              :checked="scenario.rentIsGross"
              @change="updateField('rentIsGross', $event.target.checked)"
            >
            <span class="field-label" data-tooltip="Wunschrente ist Bruttobetrag (vor Steuern). Sonst Netto (nach Steuern).">Wunschrente ist Bruttobetrag</span>
          </label>
          <label class="field" v-if="uiStore.expertMode">
            <span class="field-label" data-tooltip="Minimale monatliche Entnahme (Untergrenze).">Min. Entnahme (EUR)</span>
            <input
              type="number"
              step="50"
              :value="scenario.withdrawalMin"
              @input="updateField('withdrawalMin', +$event.target.value)"
              min="0"
              max="1000000"
            >
          </label>
          <label class="field" v-if="uiStore.expertMode">
            <span class="field-label" data-tooltip="Maximale monatliche Entnahme (Obergrenze).">Max. Entnahme (EUR)</span>
            <input
              type="number"
              step="50"
              :value="scenario.withdrawalMax"
              @input="updateField('withdrawalMax', +$event.target.value)"
              min="0"
              max="1000000"
            >
          </label>
          <label class="field" v-if="uiStore.expertMode">
            <span class="field-label" data-tooltip="Größere Einmalausgaben in der Entnahmephase.">Sonderausgabe Entnahme (EUR)</span>
            <input
              type="number"
              step="500"
              :value="scenario.specialWithdraw"
              @input="updateField('specialWithdraw', +$event.target.value)"
              min="0"
              max="10000000"
            >
          </label>
          <label class="field" v-if="uiStore.expertMode">
            <span class="field-label" data-tooltip="Alle wie viele Jahre die Sonderausgabe fällig wird.">Sonderausgabe alle X J.</span>
            <input
              type="number"
              step="1"
              :value="scenario.specialWithdrawInterval"
              @input="updateField('specialWithdrawInterval', +$event.target.value)"
              min="0"
              max="50"
            >
          </label>
          <label class="field field--checkbox" v-if="uiStore.expertMode">
            <input
              type="checkbox"
              :checked="scenario.inflationAdjustSpecialWithdrawal"
              @change="updateField('inflationAdjustSpecialWithdrawal', $event.target.checked)"
            >
            <span class="field-label" data-tooltip="Erhöht die Sonderentnahme alle X Jahre um die Inflation.">Sonderausgabe Entnahme inflationsanpassen</span>
          </label>
        </div>
      </div>

      <!-- Kapitalerhalt (Expert Mode) -->
      <div class="group" v-if="uiStore.expertMode">
        <div class="group__header">
          <h2>Kapitalerhalt-Modus</h2>
          <p>Reduziert Entnahme bei drohendem Kapitalverzehr.</p>
        </div>
        <div class="grid">
          <label class="field field--checkbox">
            <input
              type="checkbox"
              :checked="scenario.capitalPreservationEnabled"
              @change="updateField('capitalPreservationEnabled', $event.target.checked)"
            >
            <span class="field-label" data-tooltip="Aktiviert automatische Entnahmekürzung bei niedrigem Kapital.">Kapitalerhalt aktivieren</span>
          </label>
          <label class="field" v-if="scenario.capitalPreservationEnabled">
            <span class="field-label" data-tooltip="Bei Unterschreitung dieses %-Werts vom Startkapital greift die Reduktion.">Schwelle (% vom Startkapital)</span>
            <input
              type="number"
              step="5"
              :value="scenario.capitalPreservationThreshold"
              @input="updateField('capitalPreservationThreshold', +$event.target.value)"
              min="10"
              max="100"
            >
          </label>
          <label class="field" v-if="scenario.capitalPreservationEnabled">
            <span class="field-label" data-tooltip="Um wie viel % die Entnahme reduziert wird, wenn Schwelle unterschritten.">Reduktion (%)</span>
            <input
              type="number"
              step="5"
              :value="scenario.capitalPreservationReduction"
              @input="updateField('capitalPreservationReduction', +$event.target.value)"
              min="5"
              max="75"
            >
          </label>
          <label class="field" v-if="scenario.capitalPreservationEnabled">
            <span class="field-label" data-tooltip="% über Schwelle, ab dem Entnahme wieder normalisiert wird.">Erholung (% über Schwelle)</span>
            <input
              type="number"
              step="5"
              :value="scenario.capitalPreservationRecovery"
              @input="updateField('capitalPreservationRecovery', +$event.target.value)"
              min="5"
              max="50"
            >
          </label>
        </div>
      </div>

      <!-- Monte-Carlo-Simulation -->
      <div class="group">
        <div class="group__header">
          <h2>Monte-Carlo-Simulation</h2>
          <p>Stochastische Analyse mit variabler ETF-Rendite.</p>
        </div>
        <div class="grid">
          <label class="field">
            <span class="field-label" data-tooltip="Wie oft die Simulation durchgeführt wird.">Anzahl Simulationen</span>
            <input
              type="number"
              step="100"
              :value="scenario.mcIterations"
              @input="updateField('mcIterations', +$event.target.value)"
              min="100"
              max="10000"
            >
            <small class="field-hint">100-10.000 Durchläufe</small>
          </label>
          <label class="field">
            <span class="field-label" data-tooltip="Standardabweichung der jährlichen ETF-Rendite.">ETF Volatilität p.a. (%)</span>
            <input
              type="number"
              step="0.5"
              :value="scenario.mcVolatility"
              @input="updateField('mcVolatility', +$event.target.value)"
              min="1"
              max="50"
            >
            <small class="field-hint">Historisch ~15-20% für Aktien-ETFs</small>
          </label>
          <label class="field field--checkbox" v-if="uiStore.expertMode">
            <input
              type="checkbox"
              :checked="scenario.mcShowIndividual"
              @change="updateField('mcShowIndividual', $event.target.checked)"
            >
            <span class="field-label" data-tooltip="Zeigt bis zu 50 einzelne Simulationspfade im Chart an.">Einzelne Pfade anzeigen (max. 50)</span>
          </label>
          <label class="field" v-if="uiStore.expertMode">
            <span class="field-label" data-tooltip="Minimales Endvermögen für 'Erfolg'.">Erfolgsschwelle (€ real)</span>
            <input
              type="number"
              step="100"
              :value="scenario.mcSuccessThreshold"
              @input="updateField('mcSuccessThreshold', +$event.target.value)"
              min="0"
              max="1000000"
            >
          </label>
          <label class="field" v-if="uiStore.expertMode">
            <span class="field-label" data-tooltip="Ruin-Schwelle als % des Vermögens bei Rentenbeginn.">Ruin-Schwelle (% Rentenbeginn)</span>
            <input
              type="number"
              step="1"
              :value="scenario.mcRuinThreshold"
              @input="updateField('mcRuinThreshold', +$event.target.value)"
              min="1"
              max="50"
            >
          </label>
          <label class="field" v-if="uiStore.expertMode">
            <span class="field-label" data-tooltip="Seed für Zufallsgenerator.">Random Seed (0=zufällig)</span>
            <input
              type="number"
              step="1"
              :value="scenario.mcSeed"
              @input="updateField('mcSeed', +$event.target.value)"
              min="0"
              max="999999"
            >
          </label>
          <label class="field">
            <span class="field-label" data-tooltip="Testet vorgegebene Marktbedingungen in den ersten Jahren der Entnahmephase.">Stress-Szenario</span>
            <select
              :value="scenario.stressScenario"
              @change="updateField('stressScenario', $event.target.value)"
            >
              <option 
                v-for="ss in stressScenarios" 
                :key="ss.key" 
                :value="ss.key"
                :title="ss.description"
              >
                {{ ss.name }}
              </option>
            </select>
            <small class="field-hint" v-if="scenario.stressScenario !== 'none'">
              {{ stressScenarios.find(s => s.key === scenario.stressScenario)?.description }}
            </small>
          </label>
        </div>
      </div>

      <!-- MC-Erweiterte Risiken (nur Expert Mode) -->
      <div class="group" v-if="uiStore.expertMode">
        <div class="group__header">
          <h2>MC-Erweiterte Risiken</h2>
          <p>Zusätzliche Schwankungsquellen für realistischere Szenarien.</p>
        </div>
        
        <!-- Stochastische Inflation -->
        <div class="grid">
          <label class="field">
            <span class="field-label" data-tooltip="Aktiviert zufällige jährliche Schwankungen der Inflationsrate.">Inflation-Modus</span>
            <select
              :value="scenario.mcInflationMode"
              @change="updateField('mcInflationMode', $event.target.value)"
            >
              <option value="deterministic">Deterministisch (fix)</option>
              <option value="random">Stochastisch (zufällig)</option>
            </select>
          </label>
          <label class="field" v-if="scenario.mcInflationMode === 'random'">
            <span class="field-label" data-tooltip="Standardabweichung der jährlichen Inflation in Prozentpunkten.">Inflation Volatilität (%-Pkt.)</span>
            <input
              type="number"
              step="0.1"
              :value="scenario.mcInflationVolatility"
              @input="updateField('mcInflationVolatility', +$event.target.value)"
              min="0.1"
              max="5"
            >
          </label>
          <label class="field" v-if="scenario.mcInflationMode === 'random'">
            <span class="field-label" data-tooltip="Minimale jährliche Inflationsrate.">Inflation Min (%)</span>
            <input
              type="number"
              step="0.5"
              :value="scenario.mcInflationFloor"
              @input="updateField('mcInflationFloor', +$event.target.value)"
              min="-5"
              max="5"
            >
          </label>
          <label class="field" v-if="scenario.mcInflationMode === 'random'">
            <span class="field-label" data-tooltip="Maximale jährliche Inflationsrate.">Inflation Max (%)</span>
            <input
              type="number"
              step="0.5"
              :value="scenario.mcInflationCap"
              @input="updateField('mcInflationCap', +$event.target.value)"
              min="2"
              max="20"
            >
          </label>
        </div>
        
        <!-- Stochastische Cashzinsen -->
        <div class="grid">
          <label class="field">
            <span class="field-label" data-tooltip="Aktiviert zufällige jährliche Schwankungen des Tagesgeldzinses.">Cashzins-Modus</span>
            <select
              :value="scenario.mcCashRateMode"
              @change="updateField('mcCashRateMode', $event.target.value)"
            >
              <option value="deterministic">Deterministisch (fix)</option>
              <option value="random">Stochastisch (zufällig)</option>
            </select>
          </label>
          <label class="field" v-if="scenario.mcCashRateMode === 'random'">
            <span class="field-label" data-tooltip="Standardabweichung des jährlichen Cashzinses in Prozentpunkten.">Cashzins Volatilität (%-Pkt.)</span>
            <input
              type="number"
              step="0.1"
              :value="scenario.mcCashRateVolatility"
              @input="updateField('mcCashRateVolatility', +$event.target.value)"
              min="0.1"
              max="3"
            >
          </label>
          <label class="field" v-if="scenario.mcCashRateMode === 'random' || scenario.mcInflationMode === 'random'">
            <span class="field-label" data-tooltip="Korrelation zwischen Inflation und Cashzins (0.7 = stark positiv).">Korr. Inflation/Cashzins</span>
            <input
              type="number"
              step="0.1"
              :value="scenario.mcCorrInflationCash"
              @input="updateField('mcCorrInflationCash', +$event.target.value)"
              min="0"
              max="1"
            >
          </label>
        </div>
        
        <!-- Sparraten-Schocks -->
        <div class="grid">
          <label class="field">
            <span class="field-label" data-tooltip="Aktiviert zufällige Einkommensschocks (Arbeitslosigkeit, Beförderung).">Einkommensschocks</span>
            <select
              :value="scenario.mcSavingShockMode"
              @change="updateField('mcSavingShockMode', $event.target.value)"
            >
              <option value="off">Aus</option>
              <option value="simple">Einfach (Ereignis-basiert)</option>
            </select>
          </label>
          <label class="field" v-if="scenario.mcSavingShockMode === 'simple'">
            <span class="field-label" data-tooltip="Wahrscheinlichkeit eines negativen Schocks pro Jahr.">Negativ-Schock (% p.a.)</span>
            <input
              type="number"
              step="0.5"
              :value="(scenario.mcSavingShockPNeg * 100)"
              @input="updateField('mcSavingShockPNeg', +$event.target.value / 100)"
              min="0"
              max="20"
            >
          </label>
          <label class="field" v-if="scenario.mcSavingShockMode === 'simple'">
            <span class="field-label" data-tooltip="Dauer eines negativen Schocks in Monaten.">Schock-Dauer (Monate)</span>
            <input
              type="number"
              step="1"
              :value="scenario.mcSavingShockDurationNeg"
              @input="updateField('mcSavingShockDurationNeg', +$event.target.value)"
              min="1"
              max="36"
            >
          </label>
          <label class="field" v-if="scenario.mcSavingShockMode === 'simple'">
            <span class="field-label" data-tooltip="Faktor auf Sparrate bei negativem Schock (0 = keine Sparleistung).">Faktor bei neg. Schock</span>
            <input
              type="number"
              step="0.1"
              :value="scenario.mcSavingShockFactorNeg"
              @input="updateField('mcSavingShockFactorNeg', +$event.target.value)"
              min="0"
              max="1"
            >
          </label>
        </div>
        
        <!-- Unerwartete Ausgaben -->
        <div class="grid">
          <label class="field">
            <span class="field-label" data-tooltip="Aktiviert zufällige Zusatzausgaben in der Entnahmephase.">Extra-Ausgaben (Entnahme)</span>
            <select
              :value="scenario.mcExtraExpenseMode"
              @change="updateField('mcExtraExpenseMode', $event.target.value)"
            >
              <option value="off">Aus</option>
              <option value="percent_of_wealth">% vom Vermögen</option>
              <option value="fixed_real">Fester Betrag (real)</option>
            </select>
          </label>
          <label class="field" v-if="scenario.mcExtraExpenseMode !== 'off'">
            <span class="field-label" data-tooltip="Wahrscheinlichkeit einer Extra-Ausgabe pro Jahr.">Wahrscheinlichkeit (% p.a.)</span>
            <input
              type="number"
              step="1"
              :value="(scenario.mcExtraExpenseProbability * 100)"
              @input="updateField('mcExtraExpenseProbability', +$event.target.value / 100)"
              min="0"
              max="30"
            >
          </label>
          <label class="field" v-if="scenario.mcExtraExpenseMode === 'percent_of_wealth'">
            <span class="field-label" data-tooltip="Höhe der Extra-Ausgabe als % des Vermögens.">Höhe (% vom Vermögen)</span>
            <input
              type="number"
              step="1"
              :value="scenario.mcExtraExpensePercent"
              @input="updateField('mcExtraExpensePercent', +$event.target.value)"
              min="1"
              max="30"
            >
          </label>
          <label class="field" v-if="scenario.mcExtraExpenseMode === 'fixed_real'">
            <span class="field-label" data-tooltip="Höhe der Extra-Ausgabe in EUR (kaufkraftbereinigt).">Höhe (EUR real)</span>
            <input
              type="number"
              step="1000"
              :value="scenario.mcExtraExpenseFixed"
              @input="updateField('mcExtraExpenseFixed', +$event.target.value)"
              min="1000"
              max="100000"
            >
          </label>
        </div>
        
        <!-- Crash-Ereignisse -->
        <div class="grid">
          <label class="field">
            <span class="field-label" data-tooltip="Aktiviert zufällige Crash-Ereignisse zusätzlich zur normalen Volatilität.">Crash-Ereignisse</span>
            <select
              :value="scenario.mcCrashMode"
              @change="updateField('mcCrashMode', $event.target.value)"
            >
              <option value="off">Aus</option>
              <option value="simple">Einfach (zufällige Crashes)</option>
            </select>
          </label>
          <label class="field" v-if="scenario.mcCrashMode === 'simple'">
            <span class="field-label" data-tooltip="Wahrscheinlichkeit eines Crashes pro Jahr.">Crash-Wahrsch. (% p.a.)</span>
            <input
              type="number"
              step="0.5"
              :value="(scenario.mcCrashProbability * 100)"
              @input="updateField('mcCrashProbability', +$event.target.value / 100)"
              min="0"
              max="15"
            >
          </label>
          <label class="field" v-if="scenario.mcCrashMode === 'simple'">
            <span class="field-label" data-tooltip="Minimale Crash-Tiefe (z.B. -25%).">Min. Crash (%)</span>
            <input
              type="number"
              step="5"
              :value="(scenario.mcCrashDropMin * 100)"
              @input="updateField('mcCrashDropMin', +$event.target.value / 100)"
              min="-60"
              max="-10"
            >
          </label>
          <label class="field" v-if="scenario.mcCrashMode === 'simple'">
            <span class="field-label" data-tooltip="Maximale Crash-Tiefe (z.B. -45%).">Max. Crash (%)</span>
            <input
              type="number"
              step="5"
              :value="(scenario.mcCrashDropMax * 100)"
              @input="updateField('mcCrashDropMax', +$event.target.value / 100)"
              min="-70"
              max="-15"
            >
          </label>
        </div>
      </div>

      <div class="actions">
        <button type="submit" class="btn btn--primary">Simulation starten</button>
        <button 
          type="button" 
          class="btn btn--accent"
          @click="handleMonteCarlo"
        >
          {{ mcStore.isRunning ? 'Abbrechen' : 'Monte-Carlo starten' }}
        </button>

        <div class="btn-group">
          <button type="button" class="btn btn--secondary" @click="handleReset">Zurücksetzen</button>
        </div>
      </div>
    </form>
  </section>
</template>

<style scoped>
.scenario-tab--add {
  background: transparent;
  border: 1px dashed var(--border);
  color: var(--muted);
}

.scenario-tab--add:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.scenario-tools {
  display: flex;
  gap: 0.25rem;
  align-items: center;
  flex-wrap: wrap;
}

.scenario-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.expert-toggle {
  white-space: nowrap;
}

.scenario-tools__menu {
  position: relative;
}

.scenario-tools__trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.scenario-tools__label {
  font-size: 0.8rem;
}

.scenario-tools__dropdown {
  position: absolute;
  right: 0;
  margin-top: 0.35rem;
  min-width: 220px;
  padding: 0.25rem 0;
  background: var(--panel);
  border-radius: 0.75rem;
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  z-index: 20;
}

.scenario-tools__item {
  width: 100%;
  padding: 0.4rem 0.85rem;
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 0.8rem;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.scenario-tools__item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.share-status {
  font-size: 0.75rem;
  color: var(--accent);
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.preset-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.wizard-btn {
  flex-shrink: 0;
}

.scenario-tab-label {
  margin-right: 0.35rem;
}

.scenario-tab-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  opacity: 0.6;
  cursor: pointer;
  padding: 0 0.1rem;
}

.scenario-tab-icon:hover {
  opacity: 1;
}

.scenario-tab-icon--danger {
  color: #f87171;
}

@media (max-width: 600px) {
  .preset-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .scenario-actions {
    justify-content: space-between;
  }

  .scenario-tools__dropdown {
    right: auto;
    left: 0;
    width: 100%;
  }
}
</style>
