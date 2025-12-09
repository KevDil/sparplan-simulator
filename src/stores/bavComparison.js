/**
 * Pinia Store für bAV vs. ETF Vergleich
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  compareBavVsEtf,
  simulateBeitragsfreistellung,
  calculateBavTaxSavings,
  calculateGrvLoss,
  calculateRentenfaktorBreakEven,
  sensitivityAnalysis,
} from '../core/bav-comparison.js';

export const useBavComparisonStore = defineStore('bavComparison', () => {
  // ============ STATE ============
  
  // Persönliche Daten
  const currentAge = ref(31);  // Basierend auf Versorgungsbeginn 09/2023
  const retirementAge = ref(67);
  const expectedLifespan = ref(85);
  const annualGrossIncome = ref(60000);
  const hasKinder = ref(false);
  const otherPensionIncome = ref(1500); // Monatlich (GRV etc.)
  
  // bAV-Vertragsdaten (aus Nutzereingabe)
  const bavContractStart = ref('2023-09-01');
  const bavRetirementStart = ref('2061-09-01');
  const bavMonthlyContribution = ref(292);
  const bavEmployerContribution = ref(48.67);
  const bavGuaranteedCapital = ref(132276);
  const bavGuaranteedPension = ref(339.02);
  const bavRentenfaktor = ref(20.50);
  const bavExpectedReturn = ref(5.0);  // Dynamik nach Kosten (PDF-Wert)
  const bavProductCosts = ref(0);      // Zusätzliche angenommene Produktkosten (% p.a.)
  const bavEnableLifecycle = ref(true);
  const bavCurrentCapital = ref(0);
  
  // ETF-Parameter
  const etfExpectedReturn = ref(7.0);  // FTSE All World (vor TER)
  const etfCosts = ref(0.22);          // TER
  
  // Allgemeine Parameter
  const inflationPA = ref(2.0);
  const sparerpauschbetrag = ref(1000);
  
  // Ergebnisse
  const comparisonResults = ref(null);
  const freistellungResults = ref(null);
  const sensitivityResults = ref(null);
  const isCalculating = ref(false);
  const errorMessage = ref(null);
  
  // ============ COMPUTED ============
  
  const yearsContributed = computed(() => {
    const start = new Date(bavContractStart.value);
    const now = new Date();
    return Math.max(0, (now - start) / (365.25 * 24 * 60 * 60 * 1000));
  });
  
  const yearsUntilRetirement = computed(() => {
    return retirementAge.value - currentAge.value;
  });
  
  // Nutzt jetzt calculateBavTaxSavings aus v3 (basiert auf simulation-core.js)
  const taxSavings = computed(() => {
    const employeeContrib = bavMonthlyContribution.value - bavEmployerContribution.value;
    return calculateBavTaxSavings(
      employeeContrib,
      annualGrossIncome.value,
      hasKinder.value
    );
  });
  
  const monthlyNetSavingsForEtf = computed(() => {
    return taxSavings.value.monthlyNetCost;
  });
  
  const annualTaxSavings = computed(() => {
    return taxSavings.value.gesamtersparnis;
  });
  
  // GRV-Verlust (nur AN-Beitrag relevant)
  const grvLoss = computed(() => {
    const employeeContrib = bavMonthlyContribution.value - bavEmployerContribution.value;
    return calculateGrvLoss(employeeContrib, yearsUntilRetirement.value);
  });
  
  // *** NEU: Rentenfaktor Break-Even ***
  const rentenfaktorBreakEven = computed(() => {
    return calculateRentenfaktorBreakEven(
      bavGuaranteedCapital.value,
      bavRentenfaktor.value
    );
  });
  
  // ============ ACTIONS ============
  
  function runComparison() {
    isCalculating.value = true;
    errorMessage.value = null;
    
    try {
      // v3 nutzt simulation-core.js und hat vereinfachte Parameter
      const params = {
        currentAge: currentAge.value,
        retirementAge: retirementAge.value,
        annualGrossIncome: annualGrossIncome.value,
        hasKinder: hasKinder.value,
        expectedLifespan: expectedLifespan.value,
        otherPensionIncome: otherPensionIncome.value * 12,
        
        bavMonthlyContribution: bavMonthlyContribution.value,
        bavEmployerContribution: bavEmployerContribution.value,
        bavGuaranteedCapital: bavGuaranteedCapital.value,
        bavGuaranteedPension: bavGuaranteedPension.value,
        bavRentenfaktor: bavRentenfaktor.value,
        bavExpectedReturn: bavExpectedReturn.value,
        bavProductCosts: bavProductCosts.value,
        bavStartKapital: bavCurrentCapital.value,
        bavEnableLifecycle: bavEnableLifecycle.value,
        
        etfExpectedReturn: etfExpectedReturn.value,
        etfTER: etfCosts.value,
        
        inflationPA: inflationPA.value,
        sparerpauschbetrag: sparerpauschbetrag.value,
      };
      
      const result = compareBavVsEtf(params);
      
      // Wrappen für Kompatibilität mit UI (erwartet scenarios.expected)
      comparisonResults.value = {
        scenarios: { expected: result },
        breakEven: {
          etfReturnBreakEven: null, // TODO: Berechnen wenn nötig
          notes: [
            `GRV-Verlust: ~${Math.round(result.inputs.grvLoss.lostMonthlyNet)}€/Monat`,
            `Effektive bAV-Rendite (nach Produktkosten): ${result.inputs.bavEffectiveReturnNet.toFixed(1)}%`,
            `Break-Even Alter: ${Math.round(result.bav.breakEvenAge)} Jahre`,
          ],
        },
        inputs: result.inputs,
      };
      
    } catch (error) {
      errorMessage.value = error.message;
      console.error('Fehler bei bAV-Vergleich:', error);
    } finally {
      isCalculating.value = false;
    }
  }
  
  function runFreistellungAnalysis() {
    isCalculating.value = true;
    errorMessage.value = null;
    
    try {
      // v3 nutzt simulation-core.js
      const params = {
        currentAge: currentAge.value,
        retirementAge: retirementAge.value,
        annualGrossIncome: annualGrossIncome.value,
        hasKinder: hasKinder.value,
        expectedLifespan: expectedLifespan.value,
        otherPensionIncome: otherPensionIncome.value * 12,
        
        // bAV-Parameter wie im Hauptvergleich (Tab "Ergebnisse")
        bavMonthlyContribution: bavMonthlyContribution.value,
        bavEmployerContribution: bavEmployerContribution.value,
        bavGuaranteedCapital: bavGuaranteedCapital.value,
        bavGuaranteedPension: bavGuaranteedPension.value,
        bavRentenfaktor: bavRentenfaktor.value,
        bavExpectedReturn: bavExpectedReturn.value,
        bavProductCosts: bavProductCosts.value,
        bavStartKapital: bavCurrentCapital.value,
        bavEnableLifecycle: bavEnableLifecycle.value,
        
        // Zusätzlich für das Freistellungs-Szenario B
        bavCurrentCapital: bavCurrentCapital.value,
        
        etfExpectedReturn: etfExpectedReturn.value,
        etfTER: etfCosts.value,
        
        inflationPA: inflationPA.value,
        sparerpauschbetrag: sparerpauschbetrag.value,
      };
      
      freistellungResults.value = simulateBeitragsfreistellung(params);
      
    } catch (error) {
      errorMessage.value = error.message;
      console.error('Fehler bei Freistellungsanalyse:', error);
    } finally {
      isCalculating.value = false;
    }
  }
  
  function runSensitivityAnalysis(paramName, values) {
    isCalculating.value = true;
    errorMessage.value = null;
    
    try {
      // v3 API
      const baseParams = {
        currentAge: currentAge.value,
        retirementAge: retirementAge.value,
        annualGrossIncome: annualGrossIncome.value,
        hasKinder: hasKinder.value,
        expectedLifespan: expectedLifespan.value,
        otherPensionIncome: otherPensionIncome.value * 12,
        bavMonthlyContribution: bavMonthlyContribution.value,
        bavEmployerContribution: bavEmployerContribution.value,
        bavGuaranteedCapital: bavGuaranteedCapital.value,
        bavGuaranteedPension: bavGuaranteedPension.value,
        bavRentenfaktor: bavRentenfaktor.value,
        bavExpectedReturn: bavExpectedReturn.value,
        bavProductCosts: bavProductCosts.value,
        bavEnableLifecycle: bavEnableLifecycle.value,
        bavStartKapital: bavCurrentCapital.value,
        etfExpectedReturn: etfExpectedReturn.value,
        etfTER: etfCosts.value,
        inflationPA: inflationPA.value,
        sparerpauschbetrag: sparerpauschbetrag.value,
      };
      
      sensitivityResults.value = sensitivityAnalysis(baseParams, paramName, values);
      
    } catch (error) {
      errorMessage.value = error.message;
      console.error('Fehler bei Sensitivitätsanalyse:', error);
    } finally {
      isCalculating.value = false;
    }
  }
  
  // Schnellberechnung für aktuelle Vertragsdaten
  function calculateFromContract() {
    const monthsContributed = yearsContributed.value * 12;
    // Rendite ist bereits nach Kosten (PDF-Wert)
    const monthlyRate = Math.pow(1 + bavExpectedReturn.value / 100, 1/12) - 1;
    
    let estimatedCapital = 0;
    for (let m = 0; m < monthsContributed; m++) {
      estimatedCapital += bavMonthlyContribution.value;
      estimatedCapital *= (1 + monthlyRate);
    }
    
    bavCurrentCapital.value = Math.round(estimatedCapital);
  }
  
  // Preset für die Nutzerdaten
  function loadUserDefaults() {
    // Basierend auf den vom Nutzer angegebenen Daten
    bavContractStart.value = '2023-09-01';
    bavRetirementStart.value = '2061-09-01';
    bavMonthlyContribution.value = 292;
    bavEmployerContribution.value = 48.67;
    bavGuaranteedCapital.value = 132276;
    bavGuaranteedPension.value = 339.02;
    bavRentenfaktor.value = 20.50;
    bavExpectedReturn.value = 5.0;       // Dynamik nach Kosten (PDF)
    bavEnableLifecycle.value = true;     // Lifecycle aktivieren
    
    // Alter berechnen (Rentenbeginn 2061, also ca. 67 Jahre)
    currentAge.value = new Date().getFullYear() - (2061 - 67);
    retirementAge.value = 67;
    
    calculateFromContract();
  }
  
  function reset() {
    comparisonResults.value = null;
    freistellungResults.value = null;
    sensitivityResults.value = null;
    errorMessage.value = null;
  }
  
  return {
    // State
    currentAge,
    retirementAge,
    expectedLifespan,
    annualGrossIncome,
    hasKinder,
    otherPensionIncome,
    bavContractStart,
    bavRetirementStart,
    bavMonthlyContribution,
    bavEmployerContribution,
    bavGuaranteedCapital,
    bavGuaranteedPension,
    bavRentenfaktor,
    bavExpectedReturn,
    bavProductCosts,
    bavEnableLifecycle,
    bavCurrentCapital,
    etfExpectedReturn,
    etfCosts,
    inflationPA,
    sparerpauschbetrag,
    comparisonResults,
    freistellungResults,
    sensitivityResults,
    isCalculating,
    errorMessage,
    
    // Computed
    yearsContributed,
    yearsUntilRetirement,
    taxSavings,
    monthlyNetSavingsForEtf,
    annualTaxSavings,
    grvLoss,
    rentenfaktorBreakEven,
    
    // Actions
    runComparison,
    runFreistellungAnalysis,
    runSensitivityAnalysis,
    calculateFromContract,
    loadUserDefaults,
    reset,
  };
});
