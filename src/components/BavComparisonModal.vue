<script setup>
import { ref, computed, onMounted } from 'vue';
import { useBavComparisonStore } from '../stores/bavComparison';
import { useFormatting } from '../composables/useFormatting';

const emit = defineEmits(['close']);
const store = useBavComparisonStore();
const { formatCurrency, formatPercent } = useFormatting();

const activeTab = ref('input');
const showAdvanced = ref(false);

// Formatierungshelfer
const fmt = (value) => formatCurrency(value);
const fmtP = (value) => formatPercent(value);

// Berechnung starten
function runAnalysis() {
  store.runComparison();
  store.runFreistellungAnalysis();
  activeTab.value = 'results';
}

// Sensitivitätsanalyse für ETF-Rendite
function runEtfSensitivity() {
  store.runSensitivityAnalysis('etfExpectedReturn', [4, 5, 6, 7, 8, 9, 10, 11, 12]);
}

function exportData() {
  const data = {
    meta: {
      generatedAt: new Date().toISOString(),
      version: '3.1',
    },
    inputs: {
      currentAge: store.currentAge,
      retirementAge: store.retirementAge,
      expectedLifespan: store.expectedLifespan,
      annualGrossIncome: store.annualGrossIncome,
      hasKinder: store.hasKinder,
      otherPensionIncome: store.otherPensionIncome,
      bavContractStart: store.bavContractStart,
      bavRetirementStart: store.bavRetirementStart,
      bavMonthlyContribution: store.bavMonthlyContribution,
      bavEmployerContribution: store.bavEmployerContribution,
      bavGuaranteedCapital: store.bavGuaranteedCapital,
      bavGuaranteedPension: store.bavGuaranteedPension,
      bavRentenfaktor: store.bavRentenfaktor,
      bavExpectedReturn: store.bavExpectedReturn,
      bavProductCosts: store.bavProductCosts,
      bavEnableLifecycle: store.bavEnableLifecycle,
      bavCurrentCapital: store.bavCurrentCapital,
      etfExpectedReturn: store.etfExpectedReturn,
      etfCosts: store.etfCosts,
      inflationPA: store.inflationPA,
      sparerpauschbetrag: store.sparerpauschbetrag,
    },
    comparisonResults: store.comparisonResults,
    freistellungResults: store.freistellungResults,
    sensitivityResults: store.sensitivityResults,
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bav-etf-vergleich.json';
  a.click();
  URL.revokeObjectURL(url);
}

// Beim Laden Defaults setzen
onMounted(() => {
  store.loadUserDefaults();
});

// Computed für Ergebnisanzeige
const expectedScenario = computed(() => {
  return store.comparisonResults?.scenarios?.expected;
});

const freistellung = computed(() => {
  return store.freistellungResults;
});
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal bav-comparison-modal">
      <header class="modal-header">
        <h2>🏦 bAV vs. ETF Vergleichsrechner</h2>
        <button class="btn-close" @click="emit('close')" aria-label="Schließen">×</button>
      </header>
      
      <!-- Tab Navigation -->
      <nav class="tab-nav">
        <button 
          :class="['tab-btn', { active: activeTab === 'input' }]"
          @click="activeTab = 'input'"
        >
          📝 Eingaben
        </button>
        <button 
          :class="['tab-btn', { active: activeTab === 'results' }]"
          @click="activeTab = 'results'"
          :disabled="!store.comparisonResults"
        >
          📊 Ergebnisse
        </button>
        <button 
          :class="['tab-btn', { active: activeTab === 'freistellung' }]"
          @click="activeTab = 'freistellung'"
          :disabled="!store.freistellungResults"
        >
          🔄 Beitragsfreistellung
        </button>
        <button 
          :class="['tab-btn', { active: activeTab === 'sensitivity' }]"
          @click="activeTab = 'sensitivity'; runEtfSensitivity()"
        >
          📈 Sensitivität
        </button>
      </nav>
      
      <div class="modal-body">
        <!-- EINGABEN TAB -->
        <div v-if="activeTab === 'input'" class="tab-content">
          <div class="input-grid">
            <!-- Persönliche Daten -->
            <fieldset class="input-group">
              <legend>👤 Persönliche Daten</legend>
              
              <label class="input-row">
                <span>Aktuelles Alter</span>
                <input type="number" v-model.number="store.currentAge" min="18" max="67" />
              </label>
              
              <label class="input-row">
                <span>Renteneintrittsalter</span>
                <input type="number" v-model.number="store.retirementAge" min="60" max="70" />
              </label>
              
              <label class="input-row">
                <span>Erwartete Lebenserwartung</span>
                <input type="number" v-model.number="store.expectedLifespan" min="70" max="100" />
              </label>
              
              <label class="input-row">
                <span>Bruttojahresgehalt (€)</span>
                <input type="number" v-model.number="store.annualGrossIncome" step="1000" />
              </label>
              
              <label class="input-row checkbox">
                <input type="checkbox" v-model="store.hasKinder" />
                <span>Kinder vorhanden</span>
              </label>
              
              <label class="input-row">
                <span>Sonstige Rente (mtl. €)</span>
                <input type="number" v-model.number="store.otherPensionIncome" step="100" />
                <small>Gesetzliche Rente, andere bAV, etc.</small>
              </label>
            </fieldset>
            
            <!-- bAV Vertragsdaten -->
            <fieldset class="input-group">
              <legend>🏦 bAV Vertragsdaten (MetallRente)</legend>
              
              <label class="input-row">
                <span>Monatsbeitrag gesamt (€)</span>
                <input type="number" v-model.number="store.bavMonthlyContribution" step="10" />
              </label>
              
              <label class="input-row">
                <span>davon Arbeitgeber-Zuschuss (€)</span>
                <input type="number" v-model.number="store.bavEmployerContribution" step="5" />
              </label>
              
              <label class="input-row">
                <span>Garantiertes Kapital (€)</span>
                <input type="number" v-model.number="store.bavGuaranteedCapital" step="1000" />
              </label>
              
              <label class="input-row">
                <span>Garantierte Rente (€/Monat)</span>
                <input type="number" v-model.number="store.bavGuaranteedPension" step="10" />
              </label>
              
              <label class="input-row">
                <span>Rentenfaktor (€ pro 10.000€)</span>
                <input type="number" v-model.number="store.bavRentenfaktor" step="0.5" />
              </label>
              
              <label class="input-row">
                <span>Bereits angespartes Kapital (€)</span>
                <input type="number" v-model.number="store.bavCurrentCapital" step="1000" />
                <button class="btn-small" @click="store.calculateFromContract">
                  Schätzen
                </button>
              </label>
            </fieldset>
            
            <!-- Rendite & Kosten -->
            <fieldset class="input-group">
              <legend>📈 Rendite & Kosten</legend>
              
              <label class="input-row">
                <span>bAV Erwartete Rendite (% p.a.)</span>
                <input type="number" v-model.number="store.bavExpectedReturn" step="0.5" min="0" max="15" />
                <small>Dynamik-Strategie historisch: 5,0%</small>
              </label>
              
              <label class="input-row">
                <span>bAV Produktkosten (% p.a.)</span>
                <input type="number" v-model.number="store.bavProductCosts" step="0.1" min="0" max="3" />
              </label>
              
              <label class="input-row">
                <span>ETF Erwartete Rendite (% p.a.)</span>
                <input type="number" v-model.number="store.etfExpectedReturn" step="0.5" min="0" max="15" />
                <small>FTSE All World historisch: 7-8%</small>
              </label>
              
              <label class="input-row">
                <span>ETF Kosten/TER (% p.a.)</span>
                <input type="number" v-model.number="store.etfCosts" step="0.01" min="0" max="1" />
              </label>
              
              <label class="input-row">
                <span>Inflation (% p.a.)</span>
                <input type="number" v-model.number="store.inflationPA" step="0.5" min="0" max="10" />
              </label>
            </fieldset>
          </div>
          
          <!-- Schnellinfo -->
          <div class="quick-info">
            <div class="info-card">
              <span class="label">Jahre bis Rente</span>
              <span class="value">{{ store.yearsUntilRetirement }}</span>
            </div>
            <div class="info-card">
              <span class="label">Netto-Eigenbeitrag/Monat</span>
              <span class="value">{{ fmt(store.monthlyNetSavingsForEtf) }}</span>
            </div>
            <div class="info-card">
              <span class="label">Jährliche Steuerersparnis</span>
              <span class="value highlight">{{ fmt(store.annualTaxSavings) }}</span>
            </div>
            <div class="info-card warning">
              <span class="label">⚠️ GRV-Verlust/Monat</span>
              <span class="value highlight-red">{{ fmt(store.grvLoss?.lostMonthlyPensionNet || 0) }}</span>
            </div>
          </div>
          
          <!-- *** NEU: Warnhinweise *** -->
          <div class="warning-box" v-if="store.rentenfaktorBreakEven">
            <strong>⚠️ Break-Even bei Verrentung:</strong>
            <p>{{ store.rentenfaktorBreakEven.note }}</p>
            <p>Bei Rentenbeginn mit 67: Du musst <strong>{{ Math.round(67 + store.rentenfaktorBreakEven.yearsToBreakEven) }} Jahre</strong> alt werden, um dein eingezahltes Kapital zurückzubekommen.</p>
          </div>
          
          <div class="actions">
            <button class="btn btn-primary" @click="runAnalysis" :disabled="store.isCalculating">
              {{ store.isCalculating ? '⏳ Berechne...' : '🔍 Vergleich berechnen' }}
            </button>
          </div>
        </div>
        
        <!-- ERGEBNISSE TAB -->
        <div v-if="activeTab === 'results' && expectedScenario" class="tab-content">
          <h3>📊 Szenario-Vergleich (Erwartetes Szenario)</h3>
          <div style="text-align: right; margin-bottom: 0.5rem;">
            <button class="btn-small" @click="exportData" :disabled="!store.comparisonResults">
              💾 Daten exportieren
            </button>
          </div>
          
          <div class="results-grid">
            <!-- bAV Ergebnisse -->
            <div class="result-card bav">
              <h4>🏦 bAV weiterführen</h4>
              <table class="result-table">
                <tbody>
                <tr>
                  <td>Endkapital (nominal)</td>
                  <td class="value">{{ fmt(expectedScenario.bav.endCapitalNominal) }}</td>
                </tr>
                <tr>
                  <td>Endkapital (real)</td>
                  <td class="value">{{ fmt(expectedScenario.bav.endCapitalReal) }}</td>
                </tr>
                <tr>
                  <td>Garantiertes Kapital</td>
                  <td class="value">{{ fmt(expectedScenario.bav.guaranteedCapital) }}</td>
                </tr>
                <tr class="separator"></tr>
                <tr>
                  <td>Eigenbeiträge gesamt</td>
                  <td class="value">{{ fmt(expectedScenario.bav.employeeContributions) }}</td>
                </tr>
                <tr>
                  <td>AG-Zuschüsse gesamt</td>
                  <td class="value highlight-green">{{ fmt(expectedScenario.bav.employerContributions) }}</td>
                </tr>
                <tr class="separator"></tr>
                <tr>
                  <td>Monatliche Rente (brutto)</td>
                  <td class="value">{{ fmt(expectedScenario.bav.monthlyPensionGross) }}</td>
                </tr>
                <tr>
                  <td>Monatliche Rente (netto)</td>
                  <td class="value highlight">{{ fmt(expectedScenario.bav.monthlyPensionNet) }}</td>
                </tr>
                <tr>
                  <td>Effektiver Steuersatz Rente</td>
                  <td class="value">{{ fmtP(expectedScenario.bav.effectivePensionTaxRate * 100) }}</td>
                </tr>
                <tr class="separator"></tr>
                <tr>
                  <td>⚠️ GRV-Verlust (mtl. netto)</td>
                  <td class="value highlight-red">-{{ fmt(expectedScenario.bav.grvLossMonthly || 0) }}</td>
                </tr>
                <tr>
                  <td>Break-Even Alter</td>
                  <td class="value">{{ Math.round(expectedScenario.bav.breakEvenAge || 107) }} Jahre</td>
                </tr>
                <tr class="total">
                  <td>Gesamt Netto-Rente</td>
                  <td class="value">{{ fmt(expectedScenario.bav.totalNetPension) }}</td>
                </tr>
                </tbody>
              </table>
            </div>
            
            <!-- ETF Ergebnisse -->
            <div class="result-card etf">
              <h4>📈 ETF statt bAV</h4>
              <table class="result-table">
                <tbody>
                <tr>
                  <td>Endkapital (nominal)</td>
                  <td class="value">{{ fmt(expectedScenario.etf.endCapitalNominal) }}</td>
                </tr>
                <tr>
                  <td>Endkapital (real)</td>
                  <td class="value">{{ fmt(expectedScenario.etf.endCapitalReal) }}</td>
                </tr>
                <tr>
                  <td>Gewinnanteil</td>
                  <td class="value">{{ fmtP(expectedScenario.etf.capitalGainRatio * 100) }}</td>
                </tr>
                <tr class="separator"></tr>
                <tr>
                  <td>Eigenbeiträge gesamt</td>
                  <td class="value">{{ fmt(expectedScenario.etf.totalContributions) }}</td>
                </tr>
                <tr>
                  <td>AG-Zuschüsse</td>
                  <td class="value highlight-red">{{ fmt(0) }} (entfällt!)</td>
                </tr>
                <tr class="separator"></tr>
                <tr>
                  <td>Monatl. Entnahme (brutto)</td>
                  <td class="value">{{ fmt(expectedScenario.etf.monthlyWithdrawalGross) }}</td>
                </tr>
                <tr>
                  <td>Monatl. Entnahme (netto)</td>
                  <td class="value highlight">{{ fmt(expectedScenario.etf.monthlyWithdrawalNet) }}</td>
                </tr>
                <tr>
                  <td>4%-Regel Entnahme</td>
                  <td class="value">{{ fmt(expectedScenario.etf.withdrawal4PercentNet) }}</td>
                </tr>
                <tr class="total">
                  <td>Gesamt Netto-Entnahme</td>
                  <td class="value">{{ fmt(expectedScenario.etf.totalNetWithdrawal) }}</td>
                </tr>
                </tbody>
              </table>
            </div>
          </div>
          
          <!-- Vergleich -->
          <div class="comparison-summary" :class="expectedScenario.comparison.recommendation.toLowerCase()">
            <h4>🎯 Empfehlung: {{ expectedScenario.comparison.recommendation }}</h4>
            <div class="comparison-details">
              <div class="metric">
                <span class="label">Monatlicher Unterschied</span>
                <span class="value" :class="{ positive: expectedScenario.comparison.monthlyNetDifference > 0 }">
                  {{ expectedScenario.comparison.monthlyNetDifference > 0 ? '+' : '' }}{{ fmt(expectedScenario.comparison.monthlyNetDifference) }}
                </span>
              </div>
              <div class="metric">
                <span class="label">Gesamtunterschied Rentenphase</span>
                <span class="value" :class="{ positive: expectedScenario.comparison.bavAdvantage > 0 }">
                  {{ expectedScenario.comparison.bavAdvantage > 0 ? '+' : '' }}{{ fmt(expectedScenario.comparison.bavAdvantage) }}
                </span>
              </div>
              <div class="metric">
                <span class="label">Prozentual</span>
                <span class="value">
                  {{ expectedScenario.comparison.bavAdvantagePercent > 0 ? '+' : '' }}{{ expectedScenario.comparison.bavAdvantagePercent.toFixed(1) }}%
                </span>
              </div>
            </div>
          </div>
          
          <!-- Szenarien-Übersicht -->
          <details class="scenarios-detail">
            <summary>📋 Alle Szenarien anzeigen</summary>
            <table class="scenarios-table">
              <thead>
                <tr>
                  <th>Szenario</th>
                  <th>bAV Rendite</th>
                  <th>ETF Rendite</th>
                  <th>bAV Netto-Rente</th>
                  <th>ETF Netto-Entnahme</th>
                  <th>Empfehlung</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(scenario, name) in store.comparisonResults.scenarios" :key="name">
                  <td>{{ name === 'pessimistic' ? 'Pessimistisch' : name === 'expected' ? 'Erwartet' : 'Optimistisch' }}</td>
                  <td>{{ scenario.bav.returnPA }}%</td>
                  <td>{{ scenario.etf.returnPA }}%</td>
                  <td>{{ fmt(scenario.bav.totalNetPension) }}</td>
                  <td>{{ fmt(scenario.etf.totalNetWithdrawal) }}</td>
                  <td :class="scenario.comparison.recommendation.toLowerCase()">{{ scenario.comparison.recommendation }}</td>
                </tr>
              </tbody>
            </table>
          </details>
          
          <!-- Break-Even -->
          <div class="break-even" v-if="store.comparisonResults.breakEven">
            <h4>⚖️ Break-Even Analyse</h4>
            <ul>
              <li v-for="note in store.comparisonResults.breakEven.notes" :key="note">{{ note }}</li>
            </ul>
          </div>
        </div>
        
        <!-- BEITRAGSFREISTELLUNG TAB -->
        <div v-if="activeTab === 'freistellung' && freistellung" class="tab-content">
          <h3>🔄 Szenario: Beitragsfreistellung + ETF</h3>
          <p class="description">
            Was passiert, wenn du die bAV beitragsfrei stellst und das freigewordene Netto-Gehalt in einen ETF investierst?
          </p>
          
          <div class="results-grid">
            <!-- Szenario A: Weiterführen -->
            <div class="result-card">
              <h4>🅰️ {{ freistellung.scenarioA.name }}</h4>
              <table class="result-table">
                <tbody>
                <tr>
                  <td>bAV Endkapital</td>
                  <td class="value">{{ fmt(freistellung.scenarioA.bavEndCapital) }}</td>
                </tr>
                <tr>
                  <td>bAV Monatl. Netto-Rente</td>
                  <td class="value">{{ fmt(freistellung.scenarioA.bavMonthlyPensionNet) }}</td>
                </tr>
                <tr class="separator"></tr>
                <tr>
                  <td>ETF Endkapital</td>
                  <td class="value">{{ fmt(freistellung.scenarioA.etfEndCapital) }}</td>
                </tr>
                <tr>
                  <td>ETF Monatl. Netto</td>
                  <td class="value">{{ fmt(freistellung.scenarioA.etfMonthlyNet) }}</td>
                </tr>
                <tr class="total">
                  <td>Gesamt Monatl. Netto</td>
                  <td class="value highlight">{{ fmt(freistellung.scenarioA.totalMonthlyNet) }}</td>
                </tr>
                <tr class="total">
                  <td>Gesamt Rentenphase</td>
                  <td class="value">{{ fmt(freistellung.scenarioA.totalRetirementNet) }}</td>
                </tr>
                </tbody>
              </table>
            </div>
            
            <!-- Szenario B: Freistellung -->
            <div class="result-card">
              <h4>🅱️ {{ freistellung.scenarioB.name }}</h4>
              <table class="result-table">
                <tbody>
                <tr>
                  <td>bAV Endkapital (beitragsfrei)</td>
                  <td class="value">{{ fmt(freistellung.scenarioB.bavEndCapital) }}</td>
                </tr>
                <tr>
                  <td>bAV Monatl. Netto-Rente</td>
                  <td class="value">{{ fmt(freistellung.scenarioB.bavMonthlyPensionNet) }}</td>
                </tr>
                <tr class="separator"></tr>
                <tr>
                  <td>ETF Endkapital</td>
                  <td class="value">{{ fmt(freistellung.scenarioB.etfEndCapital) }}</td>
                </tr>
                <tr>
                  <td>ETF Monatl. Netto</td>
                  <td class="value">{{ fmt(freistellung.scenarioB.etfMonthlyNet) }}</td>
                </tr>
                <tr class="total">
                  <td>Gesamt Monatl. Netto</td>
                  <td class="value highlight">{{ fmt(freistellung.scenarioB.totalMonthlyNet) }}</td>
                </tr>
                <tr class="total">
                  <td>Gesamt Rentenphase</td>
                  <td class="value">{{ fmt(freistellung.scenarioB.totalRetirementNet) }}</td>
                </tr>
                </tbody>
              </table>
            </div>
          </div>
          
          <!-- Vergleich Freistellung -->
          <div class="comparison-summary" :class="freistellung.comparison.recommendation === 'Beitragsfreistellung' ? 'etf' : 'bav'">
            <h4>🎯 Empfehlung: {{ freistellung.comparison.recommendation }}</h4>
            <div class="comparison-details">
              <div class="metric">
                <span class="label">Monatlicher Unterschied</span>
                <span class="value" :class="{ positive: freistellung.comparison.monthlyDifference > 0 }">
                  {{ freistellung.comparison.monthlyDifference > 0 ? '+' : '' }}{{ fmt(freistellung.comparison.monthlyDifference) }}
                </span>
              </div>
              <div class="metric">
                <span class="label">Gesamtunterschied</span>
                <span class="value" :class="{ positive: freistellung.comparison.totalDifference > 0 }">
                  {{ freistellung.comparison.totalDifference > 0 ? '+' : '' }}{{ fmt(freistellung.comparison.totalDifference) }}
                </span>
              </div>
              <div class="metric">
                <span class="label">Prozentual</span>
                <span class="value">
                  {{ freistellung.comparison.percentDifference > 0 ? '+' : '' }}{{ freistellung.comparison.percentDifference.toFixed(1) }}%
                </span>
              </div>
            </div>
          </div>
          
          <div class="warning-box">
            <strong>⚠️ Wichtige Hinweise zur Beitragsfreistellung:</strong>
            <ul>
              <li v-for="warning in freistellung.warnings" :key="warning">{{ warning }}</li>
              <li>Prüfe die genauen Bedingungen in deinem Vertrag!</li>
            </ul>
          </div>
          
          <!-- AG-Zuschuss Verlust hervorheben -->
          <div class="insight-box" v-if="freistellung.scenarioB?.agZuschussVerloren">
            <strong>💰 Verlorener AG-Zuschuss bei Freistellung:</strong>
            <p class="highlight-red" style="font-size: 1.3rem; margin: 0.5rem 0;">
              {{ fmt(freistellung.scenarioB.agZuschussVerloren) }}
            </p>
            <p>Dieser Betrag ist "geschenktes Geld" vom Arbeitgeber, das bei Freistellung unwiederbringlich verloren geht.</p>
          </div>
        </div>
        
        <!-- SENSITIVITÄT TAB -->
        <div v-if="activeTab === 'sensitivity'" class="tab-content">
          <h3>📈 Sensitivitätsanalyse: ETF-Rendite</h3>
          <p class="description">
            Wie ändert sich die Empfehlung bei verschiedenen ETF-Renditen?
          </p>
          
          <table class="sensitivity-table" v-if="store.sensitivityResults">
            <thead>
              <tr>
                <th>ETF-Rendite</th>
                <th>bAV Gesamt</th>
                <th>ETF Gesamt</th>
                <th>Differenz</th>
                <th>Empfehlung</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in store.sensitivityResults" :key="row.etfExpectedReturn"
                  :class="{ 'current': row.etfExpectedReturn === store.etfExpectedReturn }">
                <td>{{ row.etfExpectedReturn }}%</td>
                <td>{{ fmt(row.bavTotal) }}</td>
                <td>{{ fmt(row.etfTotal) }}</td>
                <td :class="{ positive: row.difference > 0, negative: row.difference < 0 }">
                  {{ row.difference > 0 ? '+' : '' }}{{ fmt(row.difference) }}
                </td>
                <td :class="row.recommendation.toLowerCase()">{{ row.recommendation }}</td>
              </tr>
            </tbody>
          </table>
          
          <div class="insight-box">
            <strong>💡 Erkenntnis:</strong>
            <p>
              Bei deinen aktuellen Parametern ist die bAV vorteilhaft, solange die ETF-Rendite unter 
              {{ store.comparisonResults?.breakEven?.etfReturnBreakEven?.toFixed(1) || '?' }}% p.a. liegt.
            </p>
            <p><strong>Vorteile bAV:</strong></p>
            <ol>
              <li>Arbeitgeberzuschuss ({{ fmt(store.bavEmployerContribution) }}/Monat = "geschenktes Geld")</li>
              <li>Steuerersparnis Ansparphase ({{ fmt(store.annualTaxSavings) }}/Jahr)</li>
              <li>Garantieleistungen (Minimum {{ fmt(store.bavGuaranteedCapital) }})</li>
            </ol>
            <p><strong>Nachteile bAV (jetzt berücksichtigt):</strong></p>
            <ul>
              <li v-for="note in store.comparisonResults?.breakEven?.notes" :key="note">{{ note }}</li>
            </ul>
          </div>
          
          <!-- Version Info -->
          <div class="version-info">
            <small>v2.0 - Korrigiertes Modell mit GRV-Verlust, Lifecycle, KV-Freibetrag, Annuitäten-Entnahme</small>
          </div>
        </div>
      </div>
      
      <!-- Footer mit Disclaimer -->
      <footer class="modal-footer">
        <p class="disclaimer">
          ⚠️ <strong>Hinweis:</strong> Dies ist eine vereinfachte Modellrechnung. 
          Die tatsächlichen Ergebnisse können abweichen. Steuerliche und sozialversicherungsrechtliche 
          Regelungen können sich ändern. Für eine verbindliche Beratung wende dich an einen Steuerberater 
          oder Finanzberater.
        </p>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.bav-comparison-modal {
  background: var(--color-bg, #1a1a2e);
  border-radius: 12px;
  width: 100%;
  max-width: 1100px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-border, #333);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.4rem;
  color: var(--color-text, #fff);
}

.btn-close {
  background: none;
  border: none;
  color: var(--color-text-muted, #888);
  font-size: 1.8rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.btn-close:hover {
  color: var(--color-text, #fff);
}

.tab-nav {
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: var(--color-bg-secondary, #252542);
  border-bottom: 1px solid var(--color-border, #333);
  flex-wrap: wrap;
}

.tab-btn {
  padding: 0.5rem 1rem;
  border: none;
  background: transparent;
  color: var(--color-text-muted, #888);
  cursor: pointer;
  border-radius: 6px;
  font-size: 0.9rem;
  transition: all 0.2s;
}

.tab-btn:hover:not(:disabled) {
  background: var(--color-bg-hover, #333);
  color: var(--color-text, #fff);
}

.tab-btn.active {
  background: var(--color-primary, #6366f1);
  color: #fff;
}

.tab-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.tab-content {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Input Grid */
.input-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem;
}

.input-group {
  border: 1px solid var(--color-border, #333);
  border-radius: 8px;
  padding: 1rem;
  background: var(--color-bg-secondary, #252542);
}

.input-group legend {
  padding: 0 0.5rem;
  font-weight: 600;
  color: var(--color-text, #fff);
}

.input-row {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
}

.input-row span {
  font-size: 0.85rem;
  color: var(--color-text-muted, #aaa);
}

.input-row input[type="number"],
.input-row input[type="text"],
.input-row input[type="date"] {
  padding: 0.5rem;
  border: 1px solid var(--color-border, #444);
  border-radius: 4px;
  background: var(--color-bg, #1a1a2e);
  color: var(--color-text, #fff);
  font-size: 1rem;
}

.input-row input:focus {
  outline: none;
  border-color: var(--color-primary, #6366f1);
}

.input-row small {
  font-size: 0.75rem;
  color: var(--color-text-muted, #666);
}

.input-row.checkbox {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
}

.input-row.checkbox input {
  width: auto;
}

.btn-small {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  background: var(--color-primary, #6366f1);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  margin-top: 0.25rem;
}

/* Quick Info */
.quick-info {
  display: flex;
  gap: 1rem;
  margin: 1.5rem 0;
  flex-wrap: wrap;
}

.info-card {
  flex: 1;
  min-width: 150px;
  padding: 1rem;
  background: var(--color-bg-secondary, #252542);
  border-radius: 8px;
  border: 1px solid var(--color-border, #333);
  text-align: center;
}

.info-card .label {
  display: block;
  font-size: 0.8rem;
  color: var(--color-text-muted, #888);
  margin-bottom: 0.5rem;
}

.info-card .value {
  font-size: 1.3rem;
  font-weight: 600;
  color: var(--color-text, #fff);
}

.info-card .value.highlight {
  color: var(--color-success, #22c55e);
}

/* Actions */
.actions {
  display: flex;
  justify-content: center;
  margin-top: 1.5rem;
}

.btn {
  padding: 0.75rem 2rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--color-primary, #6366f1);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-primary-hover, #4f46e5);
  transform: translateY(-1px);
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Results Grid */
.results-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 1.5rem;
  margin-bottom: 1.5rem;
}

.result-card {
  background: var(--color-bg-secondary, #252542);
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid var(--color-border, #333);
}

.result-card.bav {
  border-left: 4px solid var(--color-primary, #6366f1);
}

.result-card.etf {
  border-left: 4px solid var(--color-success, #22c55e);
}

.result-card h4 {
  margin: 0 0 1rem 0;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--color-border, #333);
}

.result-table {
  width: 100%;
  border-collapse: collapse;
}

.result-table td {
  padding: 0.4rem 0;
  font-size: 0.9rem;
}

.result-table td:first-child {
  color: var(--color-text-muted, #aaa);
}

.result-table td.value {
  text-align: right;
  font-weight: 500;
  color: var(--color-text, #fff);
}

.result-table td.value.highlight {
  color: var(--color-primary, #6366f1);
  font-weight: 700;
  font-size: 1rem;
}

.result-table td.value.highlight-green {
  color: var(--color-success, #22c55e);
}

.result-table td.value.highlight-red {
  color: var(--color-danger, #ef4444);
}

.result-table tr.separator td {
  padding: 0.5rem 0;
  border-bottom: 1px dashed var(--color-border, #333);
}

.result-table tr.total td {
  padding-top: 0.75rem;
  font-weight: 700;
}

/* Comparison Summary */
.comparison-summary {
  background: var(--color-bg-secondary, #252542);
  border-radius: 8px;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
  border: 2px solid var(--color-border, #333);
}

.comparison-summary.bav {
  border-color: var(--color-primary, #6366f1);
}

.comparison-summary.etf {
  border-color: var(--color-success, #22c55e);
}

.comparison-summary h4 {
  margin: 0 0 1rem 0;
  font-size: 1.2rem;
}

.comparison-details {
  display: flex;
  gap: 2rem;
  flex-wrap: wrap;
}

.comparison-details .metric {
  flex: 1;
  min-width: 150px;
}

.comparison-details .label {
  display: block;
  font-size: 0.8rem;
  color: var(--color-text-muted, #888);
  margin-bottom: 0.25rem;
}

.comparison-details .value {
  font-size: 1.2rem;
  font-weight: 600;
}

.comparison-details .value.positive {
  color: var(--color-success, #22c55e);
}

.comparison-details .value.negative {
  color: var(--color-danger, #ef4444);
}

/* Details/Summary */
details {
  margin-bottom: 1.5rem;
}

summary {
  cursor: pointer;
  padding: 0.75rem;
  background: var(--color-bg-secondary, #252542);
  border-radius: 6px;
  font-weight: 600;
}

summary:hover {
  background: var(--color-bg-hover, #333);
}

/* Tables */
.scenarios-table,
.sensitivity-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1rem;
  font-size: 0.9rem;
}

.scenarios-table th,
.sensitivity-table th,
.scenarios-table td,
.sensitivity-table td {
  padding: 0.6rem;
  text-align: left;
  border-bottom: 1px solid var(--color-border, #333);
}

.scenarios-table th,
.sensitivity-table th {
  background: var(--color-bg-secondary, #252542);
  font-weight: 600;
}

.sensitivity-table tr.current {
  background: var(--color-primary, #6366f1);
  background: rgba(99, 102, 241, 0.2);
}

td.bav {
  color: var(--color-primary, #6366f1);
  font-weight: 600;
}

td.etf {
  color: var(--color-success, #22c55e);
  font-weight: 600;
}

td.positive {
  color: var(--color-success, #22c55e);
}

td.negative {
  color: var(--color-danger, #ef4444);
}

/* Break Even */
.break-even {
  background: var(--color-bg-secondary, #252542);
  border-radius: 8px;
  padding: 1rem;
  border-left: 4px solid var(--color-warning, #f59e0b);
}

.break-even h4 {
  margin: 0 0 0.75rem 0;
}

.break-even ul {
  margin: 0;
  padding-left: 1.5rem;
}

.break-even li {
  margin-bottom: 0.5rem;
  color: var(--color-text-muted, #aaa);
}

/* Warning & Insight Boxes */
.warning-box,
.insight-box {
  background: var(--color-bg-secondary, #252542);
  border-radius: 8px;
  padding: 1rem;
  margin-top: 1.5rem;
}

.warning-box {
  border-left: 4px solid var(--color-danger, #ef4444);
}

.insight-box {
  border-left: 4px solid var(--color-primary, #6366f1);
}

.warning-box ul,
.insight-box ol,
.insight-box ul {
  margin: 0.5rem 0 0 0;
  padding-left: 1.5rem;
}

.warning-box li,
.insight-box li {
  margin-bottom: 0.3rem;
  color: var(--color-text-muted, #aaa);
}

.description {
  color: var(--color-text-muted, #aaa);
  margin-bottom: 1.5rem;
}

/* Version Info */
.version-info {
  margin-top: 1.5rem;
  text-align: center;
  color: var(--color-text-muted, #666);
}

/* Warning card styling */
.info-card.warning {
  border: 1px solid var(--color-danger, #ef4444);
  background: rgba(239, 68, 68, 0.1);
}

.info-card.warning .label {
  color: var(--color-danger, #ef4444);
}

/* Footer */
.modal-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border, #333);
  background: var(--color-bg-secondary, #252542);
}

.disclaimer {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-muted, #888);
}

/* Responsive */
@media (max-width: 768px) {
  .bav-comparison-modal {
    max-height: 95vh;
  }
  
  .input-grid,
  .results-grid {
    grid-template-columns: 1fr;
  }
  
  .quick-info {
    flex-direction: column;
  }
  
  .comparison-details {
    flex-direction: column;
    gap: 1rem;
  }
}
</style>
