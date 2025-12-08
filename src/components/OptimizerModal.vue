<script setup>
import { computed } from 'vue'
import { useOptimizerStore } from '../stores/optimizer'
import { useScenarioStore } from '../stores/scenario'
import { useFormatting } from '../composables/useFormatting'

const emit = defineEmits(['close'])

const optimizerStore = useOptimizerStore()
const scenarioStore = useScenarioStore()
const { formatCurrency, formatPercent } = useFormatting()

const scenario = computed(() => scenarioStore.activeScenario)
const config = computed(() => optimizerStore.config)
const isPercentMode = computed(() => scenario.value?.rentMode === 'percent')

// Current budget for display
const currentBudget = computed(() => {
  const s = scenario.value
  return s ? s.monthlySavings + s.monthlyEtf : 0
})

// Handle start
function handleStart() {
  optimizerStore.startOptimization()
}

// Handle apply
function handleApply() {
  optimizerStore.applyBestResult()
  emit('close')
}

// Format candidate for display
function formatCandidate(item) {
  const c = item.candidate
  const r = item.mcResult
  return {
    tgEtf: `${formatCurrency(c.monthlySavings)} / ${formatCurrency(c.monthlyEtf)}`,
    rent: isPercentMode.value 
      ? `${c.rentPercent?.toFixed(2)}%` 
      : formatCurrency(c.rentEur),
    successRate: formatPercent(r.successRate),
    medianEnd: formatCurrency(r.medianEndReal),
    ruinProb: formatPercent(r.ruinProbability),
    isValid: item.isValid
  }
}
</script>

<template>
  <div class="modal-overlay active" @click.self="$emit('close')">
    <div class="modal optimizer-modal" role="dialog" aria-labelledby="optimizer-title">
      <header class="modal-header">
        <h2 id="optimizer-title">🔧 Parameter-Optimierer</h2>
        <button type="button" class="modal-close" @click="$emit('close')" aria-label="Schließen">×</button>
      </header>

      <div class="modal-body">
        <!-- Config Section -->
        <div v-if="!optimizerStore.isRunning && !optimizerStore.hasResults" class="optimizer-config">
          <p class="optimizer-hint">
            Der Optimierer testet verschiedene TG/ETF-Aufteilungen und Entnahmeraten, 
            um die beste Kombination für deine Erfolgswahrscheinlichkeit zu finden.
          </p>

          <div class="optimizer-fields">
            <label class="field">
              <span class="field-label">Optimierungsziel</span>
              <select v-model="config.mode">
                <option value="maximize_rent">Rente maximieren (Budget fix)</option>
                <option value="minimize_budget">Budget minimieren (Rente fix)</option>
              </select>
            </label>

            <label class="field">
              <span class="field-label">Mindest-Erfolgsrate (%)</span>
              <input 
                type="number" 
                v-model.number="config.targetSuccessRate" 
                min="50" 
                max="99" 
                step="5"
              >
              <small class="field-hint">Kandidaten unter diesem Wert werden verworfen</small>
            </label>

            <label class="field">
              <span class="field-label">MC-Iterationen pro Kandidat</span>
              <select v-model.number="config.iterations">
                <option :value="200">200 (schnell)</option>
                <option :value="500">500 (standard)</option>
                <option :value="1000">1000 (genau)</option>
              </select>
            </label>
          </div>

          <div class="optimizer-current">
            <h4>Aktuelles Szenario</h4>
            <div class="optimizer-current-grid">
              <div><span class="label">Budget:</span> {{ formatCurrency(currentBudget) }}/Monat</div>
              <div><span class="label">TG/ETF:</span> {{ formatCurrency(scenario?.monthlySavings) }} / {{ formatCurrency(scenario?.monthlyEtf) }}</div>
              <div>
                <span class="label">Wunschrente:</span> 
                {{ isPercentMode ? `${scenario?.rentPercent}%` : formatCurrency(scenario?.rentEur) }}
              </div>
            </div>
          </div>
        </div>

        <!-- Progress Section -->
        <div v-if="optimizerStore.isRunning" class="optimizer-progress">
          <div class="progress-bar">
            <progress :value="optimizerStore.progress" max="100"></progress>
          </div>
          <p class="progress-text">{{ optimizerStore.progressText }}</p>
        </div>

        <!-- Results Section -->
        <div v-if="optimizerStore.hasResults && !optimizerStore.isRunning" class="optimizer-results">
          <div v-if="optimizerStore.bestCandidate" class="optimizer-best">
            <h4>🏆 Beste Konfiguration</h4>
            <div class="best-grid">
              <div class="best-item">
                <span class="label">TG/ETF</span>
                <span class="value">{{ formatCandidate(optimizerStore.bestCandidate).tgEtf }}</span>
              </div>
              <div class="best-item">
                <span class="label">Wunschrente</span>
                <span class="value">{{ formatCandidate(optimizerStore.bestCandidate).rent }}</span>
              </div>
              <div class="best-item">
                <span class="label">Erfolgsrate</span>
                <span class="value success">{{ formatCandidate(optimizerStore.bestCandidate).successRate }}</span>
              </div>
              <div class="best-item">
                <span class="label">Median Endvermögen (real)</span>
                <span class="value">{{ formatCandidate(optimizerStore.bestCandidate).medianEnd }}</span>
              </div>
              <div class="best-item">
                <span class="label">Ruin-Risiko</span>
                <span class="value">{{ formatCandidate(optimizerStore.bestCandidate).ruinProb }}</span>
              </div>
            </div>
          </div>

          <div v-if="optimizerStore.results.candidates.length > 1" class="optimizer-alternatives">
            <h4>Alternative Konfigurationen (Top 10)</h4>
            <div class="alternatives-table">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>TG/ETF</th>
                    <th>Rente</th>
                    <th>Erfolg</th>
                    <th>Median</th>
                  </tr>
                </thead>
                <tbody>
                  <tr 
                    v-for="(item, i) in optimizerStore.results.candidates.slice(1)" 
                    :key="i"
                  >
                    <td>{{ i + 2 }}</td>
                    <td>{{ formatCandidate(item).tgEtf }}</td>
                    <td>{{ formatCandidate(item).rent }}</td>
                    <td>{{ formatCandidate(item).successRate }}</td>
                    <td>{{ formatCandidate(item).medianEnd }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="!optimizerStore.bestCandidate" class="optimizer-no-results">
            <p>⚠️ Keine gültigen Konfigurationen gefunden.</p>
            <p>Versuche die Mindest-Erfolgsrate zu senken oder die Parameter anzupassen.</p>
          </div>

          <p class="optimizer-stats">
            {{ optimizerStore.results.validCount }} von {{ optimizerStore.results.totalEvaluated }} 
            Kandidaten erfüllen die Mindest-Erfolgsrate von {{ config.targetSuccessRate }}%.
          </p>
        </div>

        <!-- Error -->
        <div v-if="optimizerStore.error" class="optimizer-error">
          <p>❌ Fehler: {{ optimizerStore.error }}</p>
        </div>
      </div>

      <footer class="modal-footer">
        <button 
          v-if="!optimizerStore.isRunning && !optimizerStore.hasResults"
          type="button" 
          class="btn btn--primary"
          @click="handleStart"
        >
          🚀 Optimierung starten
        </button>

        <button 
          v-if="optimizerStore.isRunning"
          type="button" 
          class="btn btn--secondary"
          @click="optimizerStore.abort()"
        >
          Abbrechen
        </button>

        <template v-if="optimizerStore.hasResults && !optimizerStore.isRunning">
          <button 
            type="button" 
            class="btn btn--secondary"
            @click="optimizerStore.clearResults()"
          >
            ← Neu starten
          </button>
          <button 
            v-if="optimizerStore.bestCandidate"
            type="button" 
            class="btn btn--accent"
            @click="handleApply"
          >
            ✓ Beste übernehmen
          </button>
        </template>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.optimizer-modal {
  max-width: 700px;
  width: 95%;
}

.optimizer-hint {
  color: var(--muted);
  margin-bottom: 1.5rem;
  line-height: 1.5;
}

.optimizer-fields {
  display: grid;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.optimizer-current {
  background: var(--surface);
  padding: 1rem;
  border-radius: 8px;
}

.optimizer-current h4 {
  margin: 0 0 0.75rem 0;
  font-size: 0.875rem;
  color: var(--muted);
}

.optimizer-current-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.optimizer-current-grid .label {
  color: var(--muted);
}

.optimizer-progress {
  text-align: center;
  padding: 2rem;
}

.progress-bar progress {
  width: 100%;
  height: 8px;
  border-radius: 4px;
}

.progress-text {
  margin-top: 1rem;
  color: var(--muted);
}

.optimizer-best {
  background: var(--surface);
  padding: 1.25rem;
  border-radius: 8px;
  border-left: 4px solid var(--accent);
  margin-bottom: 1.5rem;
}

.optimizer-best h4 {
  margin: 0 0 1rem 0;
}

.best-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
}

.best-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.best-item .label {
  font-size: 0.75rem;
  color: var(--muted);
}

.best-item .value {
  font-size: 1.1rem;
  font-weight: 600;
}

.best-item .value.success {
  color: var(--success, #22c55e);
}

.optimizer-alternatives h4 {
  margin: 0 0 0.75rem 0;
  font-size: 0.875rem;
}

.alternatives-table {
  overflow-x: auto;
}

.alternatives-table table {
  width: 100%;
  font-size: 0.875rem;
}

.alternatives-table th,
.alternatives-table td {
  padding: 0.5rem;
  text-align: left;
}

.alternatives-table th {
  color: var(--muted);
  font-weight: 500;
}

.optimizer-no-results {
  text-align: center;
  padding: 2rem;
  color: var(--muted);
}

.optimizer-stats {
  margin-top: 1rem;
  font-size: 0.875rem;
  color: var(--muted);
}

.optimizer-error {
  background: rgba(239, 68, 68, 0.1);
  padding: 1rem;
  border-radius: 8px;
  color: #ef4444;
}

.modal-footer {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}
</style>
