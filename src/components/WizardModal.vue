<script setup>
import { ref, computed } from 'vue'
import { useScenarioStore } from '../stores/scenario'
import { useSimulationStore } from '../stores/simulation'

const emit = defineEmits(['close'])

const scenarioStore = useScenarioStore()
const simulationStore = useSimulationStore()

// Wizard steps
const currentStep = ref(0)
const steps = ['Alter & Rente', 'Budget', 'Vermögen', 'Risikoprofil', 'Zusammenfassung']

// Wizard answers
const answers = ref({
  currentAge: 30,
  retirementAge: 67,
  lifeExpectancy: 95,
  monthlyBudget: 500,
  existingSavings: 5000,
  existingEtf: 1000,
  riskProfile: 'balanced', // conservative, balanced, aggressive
  monthlyPension: 1500,
  emergencyMonths: 6
})

// Computed derived values
const yearsSave = computed(() => Math.max(1, answers.value.retirementAge - answers.value.currentAge))
const yearsWithdraw = computed(() => Math.max(1, answers.value.lifeExpectancy - answers.value.retirementAge))

const riskProfiles = {
  conservative: {
    name: 'Konservativ',
    description: 'Sicherheit vor Rendite, mehr Tagesgeld',
    savingsRatio: 0.5,
    etfRate: 5.0,
    volatility: 12
  },
  balanced: {
    name: 'Ausgewogen',
    description: 'Balance zwischen Sicherheit und Wachstum',
    savingsRatio: 0.3,
    etfRate: 6.0,
    volatility: 15
  },
  aggressive: {
    name: 'Wachstumsorientiert',
    description: 'Maximale Rendite, mehr Risiko',
    savingsRatio: 0.15,
    etfRate: 7.0,
    volatility: 18
  }
}

const selectedProfile = computed(() => riskProfiles[answers.value.riskProfile])

// Derived scenario values
const derivedScenario = computed(() => {
  const profile = selectedProfile.value
  const budget = answers.value.monthlyBudget
  
  // Split budget based on risk profile
  const monthlySavings = Math.round(budget * profile.savingsRatio)
  const monthlyEtf = budget - monthlySavings
  
  // Emergency fund target (X months of expenses)
  const monthlyExpenses = answers.value.monthlyPension || 1500
  const savingsTarget = monthlyExpenses * answers.value.emergencyMonths
  
  // Calculate monthly withdrawal need (pension gap)
  const pensionGap = Math.max(0, monthlyExpenses - answers.value.monthlyPension)
  
  return {
    yearsSave: yearsSave.value,
    yearsWithdraw: yearsWithdraw.value,
    monthlySavings,
    monthlyEtf,
    startSavings: answers.value.existingSavings,
    startEtf: answers.value.existingEtf,
    savingsTarget,
    etfRate: profile.etfRate,
    mcVolatility: profile.volatility,
    rentEur: pensionGap,
    rentMode: 'eur'
  }
})

// Navigation
function nextStep() {
  if (currentStep.value < steps.length - 1) {
    currentStep.value++
  }
}

function prevStep() {
  if (currentStep.value > 0) {
    currentStep.value--
  }
}

// Apply wizard results
function applyWizard() {
  const derived = derivedScenario.value
  scenarioStore.updateScenario(derived)
  simulationStore.runSimulation()
  emit('close')
}

// Format currency
function formatCurrency(value) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)
}
</script>

<template>
  <div class="modal-overlay active" @click.self="$emit('close')">
    <div class="modal wizard-modal" role="dialog" aria-labelledby="wizard-title">
      <header class="modal-header">
        <h2 id="wizard-title">Setup-Assistent</h2>
        <button type="button" class="modal-close" @click="$emit('close')" aria-label="Schließen">×</button>
      </header>
      
      <!-- Progress -->
      <div class="wizard-progress">
        <div 
          v-for="(step, i) in steps" 
          :key="i" 
          class="wizard-step"
          :class="{ 
            'wizard-step--active': currentStep === i,
            'wizard-step--done': currentStep > i 
          }"
        >
          <span class="wizard-step-number">{{ i + 1 }}</span>
          <span class="wizard-step-label">{{ step }}</span>
        </div>
      </div>

      <div class="modal-body wizard-body">
        <!-- Step 1: Alter & Rente -->
        <div v-show="currentStep === 0" class="wizard-page">
          <h3>Alter & Rentenplanung</h3>
          <p class="wizard-hint">Wie lange möchtest du sparen und entnehmen?</p>
          
          <div class="wizard-fields">
            <label class="field">
              <span class="field-label">Aktuelles Alter</span>
              <input type="number" v-model.number="answers.currentAge" min="18" max="80">
            </label>
            <label class="field">
              <span class="field-label">Gewünschtes Rentenalter</span>
              <input type="number" v-model.number="answers.retirementAge" min="40" max="80">
            </label>
            <label class="field">
              <span class="field-label">Lebenserwartung (Planungshorizont)</span>
              <input type="number" v-model.number="answers.lifeExpectancy" min="70" max="110">
              <small class="field-hint">Lieber großzügig planen!</small>
            </label>
          </div>
          
          <div class="wizard-summary-box">
            <p><strong>{{ yearsSave }}</strong> Jahre Ansparphase</p>
            <p><strong>{{ yearsWithdraw }}</strong> Jahre Entnahmephase</p>
          </div>
        </div>

        <!-- Step 2: Budget -->
        <div v-show="currentStep === 1" class="wizard-page">
          <h3>Monatliches Sparbudget</h3>
          <p class="wizard-hint">Wie viel kannst du monatlich für den Vermögensaufbau verwenden?</p>
          
          <div class="wizard-fields">
            <label class="field">
              <span class="field-label">Monatliches Sparbudget (EUR)</span>
              <input type="number" v-model.number="answers.monthlyBudget" min="50" max="10000" step="50">
            </label>
            <label class="field">
              <span class="field-label">Gewünschte monatliche "Rente" (EUR)</span>
              <input type="number" v-model.number="answers.monthlyPension" min="0" max="20000" step="100">
              <small class="field-hint">Wie viel möchtest du monatlich entnehmen?</small>
            </label>
            <label class="field">
              <span class="field-label">Notgroschen-Monate</span>
              <input type="number" v-model.number="answers.emergencyMonths" min="3" max="24">
              <small class="field-hint">Monatsausgaben × X als Notgroschen</small>
            </label>
          </div>
        </div>

        <!-- Step 3: Vermögen -->
        <div v-show="currentStep === 2" class="wizard-page">
          <h3>Vorhandenes Vermögen</h3>
          <p class="wizard-hint">Was bringst du bereits mit?</p>
          
          <div class="wizard-fields">
            <label class="field">
              <span class="field-label">Tagesgeld / Sparkonto (EUR)</span>
              <input type="number" v-model.number="answers.existingSavings" min="0" max="10000000" step="1000">
            </label>
            <label class="field">
              <span class="field-label">ETF-Depot (EUR)</span>
              <input type="number" v-model.number="answers.existingEtf" min="0" max="10000000" step="1000">
            </label>
          </div>
          
          <div class="wizard-summary-box">
            <p>Gesamtes Startkapital: <strong>{{ formatCurrency(answers.existingSavings + answers.existingEtf) }}</strong></p>
          </div>
        </div>

        <!-- Step 4: Risikoprofil -->
        <div v-show="currentStep === 3" class="wizard-page">
          <h3>Risikoprofil</h3>
          <p class="wizard-hint">Wie gehst du mit Kursschwankungen um?</p>
          
          <div class="risk-profiles">
            <label 
              v-for="(profile, key) in riskProfiles" 
              :key="key"
              class="risk-profile"
              :class="{ 'risk-profile--selected': answers.riskProfile === key }"
            >
              <input type="radio" v-model="answers.riskProfile" :value="key">
              <div class="risk-profile-content">
                <strong>{{ profile.name }}</strong>
                <span>{{ profile.description }}</span>
                <small>{{ Math.round((1 - profile.savingsRatio) * 100) }}% ETF / {{ Math.round(profile.savingsRatio * 100) }}% Tagesgeld</small>
              </div>
            </label>
          </div>
        </div>

        <!-- Step 5: Zusammenfassung -->
        <div v-show="currentStep === 4" class="wizard-page">
          <h3>Dein persönlicher Plan</h3>
          <p class="wizard-hint">Diese Werte werden in dein Szenario übernommen:</p>
          
          <div class="wizard-result-grid">
            <div class="wizard-result-item">
              <span class="label">Ansparphase</span>
              <span class="value">{{ derivedScenario.yearsSave }} Jahre</span>
            </div>
            <div class="wizard-result-item">
              <span class="label">Entnahmephase</span>
              <span class="value">{{ derivedScenario.yearsWithdraw }} Jahre</span>
            </div>
            <div class="wizard-result-item">
              <span class="label">Monatlich Tagesgeld</span>
              <span class="value">{{ formatCurrency(derivedScenario.monthlySavings) }}</span>
            </div>
            <div class="wizard-result-item">
              <span class="label">Monatlich ETF</span>
              <span class="value">{{ formatCurrency(derivedScenario.monthlyEtf) }}</span>
            </div>
            <div class="wizard-result-item">
              <span class="label">Tagesgeld-Ziel (Notgroschen)</span>
              <span class="value">{{ formatCurrency(derivedScenario.savingsTarget) }}</span>
            </div>
            <div class="wizard-result-item">
              <span class="label">Erwartete ETF-Rendite</span>
              <span class="value">{{ derivedScenario.etfRate }}% p.a.</span>
            </div>
            <div class="wizard-result-item">
              <span class="label">Wunschrente</span>
              <span class="value">{{ formatCurrency(derivedScenario.rentEur) }}/Monat</span>
            </div>
          </div>
        </div>
      </div>

      <footer class="modal-footer wizard-footer">
        <button 
          v-if="currentStep > 0" 
          type="button" 
          class="btn btn--secondary"
          @click="prevStep"
        >
          ← Zurück
        </button>
        <div class="wizard-footer-spacer"></div>
        <button 
          v-if="currentStep < steps.length - 1" 
          type="button" 
          class="btn btn--primary"
          @click="nextStep"
        >
          Weiter →
        </button>
        <button 
          v-else 
          type="button" 
          class="btn btn--accent"
          @click="applyWizard"
        >
          ✓ Plan übernehmen
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.wizard-modal {
  max-width: 600px;
  width: 95%;
}

.wizard-progress {
  display: flex;
  justify-content: space-between;
  padding: 0 1.5rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 1rem;
}

.wizard-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  opacity: 0.5;
  transition: opacity 0.2s;
}

.wizard-step--active,
.wizard-step--done {
  opacity: 1;
}

.wizard-step-number {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--surface);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.875rem;
}

.wizard-step--active .wizard-step-number {
  background: var(--accent);
  color: white;
}

.wizard-step--done .wizard-step-number {
  background: var(--success, #22c55e);
  color: white;
}

.wizard-step-label {
  font-size: 0.7rem;
  text-align: center;
  max-width: 80px;
}

.wizard-body {
  min-height: 320px;
}

.wizard-page h3 {
  margin: 0 0 0.5rem 0;
  color: var(--text);
}

.wizard-hint {
  color: var(--muted);
  margin-bottom: 1.5rem;
}

.wizard-fields {
  display: grid;
  gap: 1rem;
}

.wizard-summary-box {
  margin-top: 1.5rem;
  padding: 1rem;
  background: var(--surface);
  border-radius: 8px;
  border-left: 3px solid var(--accent);
}

.wizard-summary-box p {
  margin: 0.25rem 0;
}

.risk-profiles {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.risk-profile {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem;
  background: var(--surface);
  border-radius: 8px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.2s;
}

.risk-profile:hover {
  border-color: var(--border);
}

.risk-profile--selected {
  border-color: var(--accent);
}

.risk-profile input {
  margin-top: 2px;
}

.risk-profile-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.risk-profile-content strong {
  color: var(--text);
}

.risk-profile-content span {
  color: var(--muted);
  font-size: 0.875rem;
}

.risk-profile-content small {
  color: var(--accent);
  font-size: 0.75rem;
}

.wizard-result-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}

.wizard-result-item {
  padding: 0.75rem;
  background: var(--surface);
  border-radius: 8px;
}

.wizard-result-item .label {
  display: block;
  font-size: 0.75rem;
  color: var(--muted);
  margin-bottom: 4px;
}

.wizard-result-item .value {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text);
}

.wizard-footer {
  display: flex;
  gap: 0.5rem;
}

.wizard-footer-spacer {
  flex: 1;
}

@media (max-width: 600px) {
  .wizard-step-label {
    display: none;
  }
  
  .wizard-result-grid {
    grid-template-columns: 1fr;
  }
}
</style>
