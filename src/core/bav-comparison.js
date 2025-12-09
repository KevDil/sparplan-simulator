/**
 * bAV vs. ETF Vergleichsrechner - Version 3.1
 * 
 * NUTZT die bestehende simulate() Funktion aus simulation-core.js
 * Fügt nur bAV-spezifische Logik hinzu:
 * - Steuervorteile Bruttoentgeltumwandlung
 * - GRV-Verlust durch Entgeltumwandlung  
 * - Lifecycle-Anpassung für bAV (MetallRente-Modell)
 * - Vergleichsauswertung
 * 
 * ============================================================================
 * MODELL-DOKUMENTATION UND BEKANNTE VEREINFACHUNGEN
 * ============================================================================
 * 
 * Dieses Tool ist ein TENDENZ-SIMULATOR, kein exakter Entscheidungsrechner.
 * Die folgenden Vereinfachungen sind bewusst gewählt:
 * 
 * STEUERMODELL (Ansparphase):
 * - bAV: Komplett steuerfrei (keine Vorabpauschale, keine AbgSt) ✓
 * - ETF: Vorabpauschale wird über simulation-core.js berechnet
 * - Grenzsteuersatz basiert auf Bruttoeinkommen (nicht exaktes zvE)
 * 
 * STEUERMODELL (Rentenphase):
 * - bAV-Rente: Pauschale Näherung ~15% ESt + Soli auf Gesamtrente
 *   (Der tatsächliche Steuersatz hängt vom individuellen zvE ab)
 * - ETF-Entnahme: Korrekte Berechnung mit Teilfreistellung (30%) und
 *   jährlichem Sparerpauschbetrag
 * 
 * SOZIALVERSICHERUNG (Rentenphase):
 * - bAV: KV-Freibetrag (176,75€/Monat) korrekt nur auf KV angewendet ✓
 * - bAV: PV wird auf volle Betriebsrente berechnet (kein Freibetrag) ✓
 * - GRV: Halber KV/PV-Satz (nur AN-Anteil) wird berücksichtigt
 * 
 * GRV-VERLUST:
 * - Entgangene Entgeltpunkte werden berechnet und als Netto-Wert ausgegeben
 * - Pauschal 15% Abzug für KV/PV/ESt auf GRV-Rente
 * 
 * LIFECYCLE (bAV):
 * - Vereinfachtes 3-Phasen-Modell (Dynamik/Balance/Sicherheit)
 * - Gewichtete Durchschnittsrendite über Anlagedauer
 * - Tatsächliche Umschichtung erfolgt produktindividuell
 * 
 * RENDITEN:
 * - bAV: Renditen sind Schätzungen NACH Produktkosten (lt. Anbieter)
 * - ETF: Rendite - TER wird berechnet
 * 
 * NICHT MODELLIERT:
 * - Zillmerung (Abschluss-/Vertriebskosten in ersten Jahren)
 *   → Workaround: "Aktueller Vertragswert" als Startkapital eingeben
 * - Inflation der Rentenbeiträge/Freibeträge über Zeit
 * - Steigende Beitragsbemessungsgrenzen
 * - Änderungen im Steuerrecht
 */

import {
  simulate,
  analyzeHistory,
  toMonthlyRate,
  calculateTaxRate,
} from './simulation-core.js';

import {
  SPARERPAUSCHBETRAG_SINGLE,
} from './constants.js';

// ============ BAV-SPEZIFISCHE KONSTANTEN ============

export const BAV_CONSTANTS = {
  // Steuer & SV
  BBG_RV_2024: 90600,
  BAV_STEUERFREIER_ANTEIL: 0.08,
  BAV_SV_FREIER_ANTEIL: 0.04,
  
  // GRV
  RENTENWERT_WEST: 39.32,
  DURCHSCHNITTSENTGELT: 45358,
  
  // KV/PV-Freibetrag für Betriebsrenten
  BAV_KV_FREIBETRAG_MONATLICH: 176.75,
  
  // Lifecycle-Renditen (MetallRente, nach Kosten)
  RENDITE_DYNAMIK: 5.0,
  RENDITE_BALANCE: 3.8,
  RENDITE_SICHERHEIT: 2.8,
  
  // SV-Sätze
  KV_GESAMT: 0.163,  // KV + Zusatzbeitrag
  PV_KINDERLOS: 0.034,
  PV_MIT_KINDERN: 0.023,
  RV_AV_AN: 0.106,   // RV 9,3% + AV 1,3%
};

// ============ GRENZSTEUERSATZ (vereinfacht) ============

const INCOME_TAX_BRACKETS = [
  { limit: 11604, rate: 0 },
  { limit: 17005, rate: 0.14 },
  { limit: 66760, rate: 0.24 },
  { limit: 277825, rate: 0.42 },
  { limit: Infinity, rate: 0.45 },
];

export function getGrenzsteuersatz(zvE) {
  for (const bracket of INCOME_TAX_BRACKETS) {
    if (zvE <= bracket.limit) return bracket.rate;
  }
  return 0.45;
}

// ============ BAV-SPEZIFISCHE BERECHNUNGEN ============

/**
 * Steuerersparnis durch Bruttoentgeltumwandlung
 */
export function calculateBavTaxSavings(monthlyEmployeeContribution, annualGrossIncome, hasKinder = false) {
  const annual = monthlyEmployeeContribution * 12;
  
  const maxSteuerfrei = BAV_CONSTANTS.BBG_RV_2024 * BAV_CONSTANTS.BAV_STEUERFREIER_ANTEIL;
  const maxSVfrei = BAV_CONSTANTS.BBG_RV_2024 * BAV_CONSTANTS.BAV_SV_FREIER_ANTEIL;
  
  const steuerfreierBeitrag = Math.min(annual, maxSteuerfrei);
  const svFreierBeitrag = Math.min(annual, maxSVfrei);
  
  const grenzsteuersatz = getGrenzsteuersatz(annualGrossIncome);
  const steuerersparnis = steuerfreierBeitrag * grenzsteuersatz * 1.055;
  
  const kvPvRate = BAV_CONSTANTS.KV_GESAMT / 2 + 
    (hasKinder ? BAV_CONSTANTS.PV_MIT_KINDERN : BAV_CONSTANTS.PV_KINDERLOS) / 2;
  const svErsparnis = svFreierBeitrag * (kvPvRate + BAV_CONSTANTS.RV_AV_AN);
  
  return {
    steuerersparnis,
    svErsparnis,
    gesamtersparnis: steuerersparnis + svErsparnis,
    grenzsteuersatz,
    monthlyNetCost: monthlyEmployeeContribution - (steuerersparnis + svErsparnis) / 12,
  };
}

/**
 * GRV-Verlust durch Entgeltumwandlung
 * 
 * Berechnet die entgangene gesetzliche Rente durch die Reduzierung der 
 * Beitragsbemessungsgrundlage bei Bruttoentgeltumwandlung.
 * 
 * Formel:
 * - Entgangene Entgeltpunkte (EP) = Umwandlungsbetrag / Durchschnittsentgelt
 * - Brutto-Rentenverlust = EP × Rentenwert
 * - Netto-Rentenverlust = Brutto × (1 - SV-Abzug)
 * 
 * WICHTIG: Die GRV-Rente unterliegt nur dem halben KV/PV-Satz (Rentner zahlen
 * nur ihren Anteil, der AG-Anteil entfällt), daher ca. 11-12% Abzug.
 * Zusätzlich fällt Einkommensteuer an (je nach Gesamteinkommen).
 * Hier wird pauschal 15% Gesamtabzug angenommen.
 * 
 * @param {number} monthlyEmployeeContribution - Monatlicher AN-Beitrag zur bAV (brutto)
 * @param {number} yearsUntilRetirement - Jahre bis zur Rente
 * @returns {Object} Verlustberechnung mit Brutto- und Netto-Werten
 */
export function calculateGrvLoss(monthlyEmployeeContribution, yearsUntilRetirement) {
  const annualContrib = monthlyEmployeeContribution * 12;
  
  // Entgangene Entgeltpunkte pro Jahr
  // EP = Beitrag / Durchschnittsentgelt (§ 70 SGB VI)
  const lostEPPerYear = annualContrib / BAV_CONSTANTS.DURCHSCHNITTSENTGELT;
  const totalLostEP = lostEPPerYear * yearsUntilRetirement;
  
  // Brutto-Rentenverlust: EP × aktueller Rentenwert (monatlich)
  const lostMonthlyGross = totalLostEP * BAV_CONSTANTS.RENTENWERT_WEST;
  
  // Netto-Rentenverlust: Abzüge für KV/PV (halber Satz) + anteilige ESt
  // GRV-Rentner zahlen: ~7,3% KV (halber Satz) + ~1,5-2,3% PV (voll) = ~9-10%
  // Plus anteilige Einkommensteuer (je nach Gesamtrente): ~5-10%
  // Pauschal: 15% Gesamtabzug (konservative Schätzung)
  const GRV_NETTO_FAKTOR = 0.85;
  const lostMonthlyNet = lostMonthlyGross * GRV_NETTO_FAKTOR;
  
  return {
    lostEPPerYear,
    totalLostEP,
    lostMonthlyGross,      // Brutto-Rentenverlust pro Monat
    lostMonthlyNet,        // Netto-Rentenverlust pro Monat (nach ~15% Abzug)
    lostAnnualGross: lostMonthlyGross * 12,
    lostAnnualNet: lostMonthlyNet * 12,
  };
}

/**
 * Rentenfaktor Break-Even (ab welchem Alter lohnt sich Verrentung)
 */
export function calculateRentenfaktorBreakEven(capital, rentenfaktor) {
  const monthlyPension = (capital / 10000) * rentenfaktor;
  const monthsToBreakEven = capital / monthlyPension;
  const yearsToBreakEven = monthsToBreakEven / 12;
  
  return {
    monthlyPension,
    yearsToBreakEven,
    breakEvenAge: (retirementAge) => retirementAge + yearsToBreakEven,
  };
}

/**
 * bAV Netto-Rente nach Steuern/SV (mit KV-Freibetrag)
 * 
 * WICHTIG: Der Freibetrag (§ 226 Abs. 2 SGB V, 176,75€/Monat in 2024) gilt NUR für die
 * Krankenversicherung, NICHT für die Pflegeversicherung!
 * - KV: Beitrag nur auf Betrag über Freibetrag
 * - PV: Beitrag auf VOLLE Betriebsrente (kein Freibetrag)
 * 
 * Steuer-Modell: Vereinfachte pauschale Näherung (~15% ESt + Soli auf Gesamtrente,
 * anteilig der bAV zugerechnet). Für exakte Berechnung wäre individuelles zvE nötig.
 */
export function calculateBavNetPension(monthlyGross, otherPensionIncome = 0, hasKinder = false) {
  const annualGross = monthlyGross * 12;
  const totalPension = annualGross + otherPensionIncome;
  
  // KV: Freibetrag gilt NUR für Krankenversicherung
  const kvPflichtigMonatlich = Math.max(0, monthlyGross - BAV_CONSTANTS.BAV_KV_FREIBETRAG_MONATLICH);
  const kvAbzug = kvPflichtigMonatlich * 12 * BAV_CONSTANTS.KV_GESAMT;
  
  // PV: KEIN Freibetrag - volle Betriebsrente ist PV-pflichtig!
  const pvRate = hasKinder ? BAV_CONSTANTS.PV_MIT_KINDERN : BAV_CONSTANTS.PV_KINDERLOS;
  const pvAbzug = annualGross * pvRate;
  
  const svAbzug = kvAbzug + pvAbzug;
  
  // Einkommensteuer anteilig (pauschale Näherung)
  // Hinweis: Dies ist eine vereinfachte Schätzung. Der tatsächliche Steuersatz
  // hängt vom individuellen zu versteuernden Einkommen ab.
  const bavAnteil = totalPension > 0 ? annualGross / totalPension : 1;
  const steuer = totalPension * 0.15 * bavAnteil * 1.055; // ~15% ESt + 5,5% Soli
  
  const netAnnual = annualGross - svAbzug - steuer;
  
  return {
    monthlyGross,
    monthlyNet: netAnnual / 12,
    effectiveTaxRate: annualGross > 0 ? (svAbzug + steuer) / annualGross : 0,
    // Detaillierte Aufschlüsselung für Transparenz
    kvAbzugJahr: kvAbzug,
    pvAbzugJahr: pvAbzug,
    steuerJahr: steuer,
  };
}

// ============ HAUPT-VERGLEICHSFUNKTION ============

/**
 * Vergleicht bAV mit ETF unter Nutzung der bestehenden simulate() Funktion
 */
export function compareBavVsEtf(params) {
  const {
    currentAge,
    retirementAge = 67,
    expectedLifespan = 85,
    annualGrossIncome,
    hasKinder = false,
    otherPensionIncome = 1500 * 12,
    
    // bAV
    bavMonthlyContribution = 292,
    bavEmployerContribution = 48.67,
    bavGuaranteedCapital = 132276,
    bavGuaranteedPension = 339.02,
    bavRentenfaktor = 20.50,
    bavExpectedReturn = 5.0,
    bavProductCosts = 0,
    bavStartKapital = 0,
    bavEnableLifecycle = true,
    
    // ETF
    etfExpectedReturn = 7.0,
    etfTER = 0.22,
    etfVolatility = 0,  // 0 = deterministisch, >0 = stochastisch
    
    // Allgemein
    inflationPA = 2.0,
    sparerpauschbetrag = SPARERPAUSCHBETRAG_SINGLE,
  } = params;
  
  const yearsUntilRetirement = retirementAge - currentAge;
  const retirementYears = expectedLifespan - retirementAge;
  const employeeContribution = bavMonthlyContribution - bavEmployerContribution;
  
  // === BAV-spezifische Vorberechnungen ===
  const taxSavings = calculateBavTaxSavings(employeeContribution, annualGrossIncome, hasKinder);
  const grvLoss = calculateGrvLoss(employeeContribution, yearsUntilRetirement);
  const monthlyNetForEtf = taxSavings.monthlyNetCost;
  
  // === Lifecycle-Rendite für bAV berechnen ===
  // MetallRente Lifecycle-Modell: Automatische Umschichtung vor Rentenbeginn
  // 
  // Phasen (vereinfachte Modellierung):
  // - DYNAMIK (100% Aktien):  Bis 7 Jahre vor Rente  → ~5,0% p.a. (nach Kosten)
  // - BALANCE (50/50):        4 Jahre (7→3 vor Rente) → ~3,8% p.a. (nach Kosten)
  // - SICHERHEIT (defensive): Letzte 3 Jahre         → ~2,8% p.a. (nach Kosten)
  //
  // Diese Modellierung ist eine VEREINFACHUNG. Die tatsächliche Umschichtung
  // erfolgt individuell basierend auf Kapitalmarkt und Garantieanforderungen.
  // Die gewichtete Durchschnittsrendite berücksichtigt die Zeit in jeder Phase.
  //
  // HINWEIS: Renditen sind Schätzungen basierend auf historischen Daten der
  // MetallRente Dynamik-Strategie (nach Abzug von ~0,7% Produktkosten).
  let bavEffectiveReturn = bavExpectedReturn;
  if (bavEnableLifecycle && yearsUntilRetirement > 0) {
    const yearsInDynamik = Math.max(0, yearsUntilRetirement - 7);
    const yearsInBalance = Math.min(4, Math.max(0, yearsUntilRetirement - 3));
    const yearsInSicherheit = Math.min(3, yearsUntilRetirement);
    const totalYears = yearsInDynamik + yearsInBalance + yearsInSicherheit;
    
    bavEffectiveReturn = totalYears > 0 ? (
      yearsInDynamik * BAV_CONSTANTS.RENDITE_DYNAMIK +
      yearsInBalance * BAV_CONSTANTS.RENDITE_BALANCE +
      yearsInSicherheit * BAV_CONSTANTS.RENDITE_SICHERHEIT
    ) / totalYears : bavExpectedReturn;
  }

  // Produktkosten als pauschale jährliche Kosten vom effektiven Satz abziehen
  const bavEffectiveReturnNet = Math.max(bavEffectiveReturn - bavProductCosts, 0);
  
  // === BAV-Simulation über simulate() ===
  // WICHTIG: bAV-Produkte sind STEUERFREI in der Ansparphase!
  // - Keine Vorabpauschale (§ 19 Abs. 1 InvStG gilt nicht für Versicherungsprodukte)
  // - Keine Abgeltungsteuer auf Erträge während der Laufzeit
  // - Besteuerung erfolgt erst bei Rentenauszahlung (nachgelagerte Besteuerung)
  const bavSimParams = {
    start_savings: 0,
    start_etf: bavStartKapital,
    monthly_savings: 0,
    monthly_etf: bavMonthlyContribution,
    savings_rate_pa: 0,
    etf_rate_pa: bavEffectiveReturnNet,
    etf_ter_pa: 0,  // Rendite ist bereits nach Kosten (lt. Anbieter-Factsheet)
    savings_target: 0,
    annual_raise_percent: 0,
    savings_years: yearsUntilRetirement,
    withdrawal_years: 0,  // Keine Entnahme simulieren, nur Ansparphase
    monthly_payout_net: 0,
    inflation_rate_pa: inflationPA,
    sparerpauschbetrag: 0,  // bAV: Kein Sparerpauschbetrag relevant
    basiszins: -1,          // Negativ → keine Vorabpauschale (bAV ist steuerfrei in Ansparphase)
  };
  
  // Stochastische Simulation ist für bAV nicht sinnvoll (Garantieprodukt)
  const bavHistory = simulate(bavSimParams, 0, {});
  const bavEndCapital = bavHistory.length > 0 
    ? bavHistory[bavHistory.length - 1].total 
    : bavStartKapital;
  
  // bAV Rente berechnen
  const bavPensionFromCapital = (bavEndCapital / 10000) * bavRentenfaktor;
  const bavMonthlyPension = Math.max(bavPensionFromCapital, bavGuaranteedPension);
  const bavNetPension = calculateBavNetPension(bavMonthlyPension, otherPensionIncome - grvLoss.lostMonthlyGross * 12, hasKinder);
  const bavTotalNet = bavNetPension.monthlyNet * 12 * retirementYears;
  
  // === ETF-Simulation über simulate() ===
  const etfSimParams = {
    start_savings: 0,
    start_etf: 0,
    monthly_savings: 0,
    monthly_etf: monthlyNetForEtf,
    savings_rate_pa: 0,
    etf_rate_pa: etfExpectedReturn,
    etf_ter_pa: etfTER,
    savings_target: 0,
    annual_raise_percent: 0,
    savings_years: yearsUntilRetirement,
    withdrawal_years: retirementYears,
    monthly_payout_net: 0,  // Wird später berechnet
    monthly_payout_percent: 0,
    inflation_rate_pa: inflationPA,
    sparerpauschbetrag,
  };
  
  // Erst Ansparphase simulieren
  const etfSavingsHistory = simulate({
    ...etfSimParams,
    withdrawal_years: 0,
  }, etfVolatility, {});
  
  const etfEndCapital = etfSavingsHistory.length > 0
    ? etfSavingsHistory[etfSavingsHistory.length - 1].total
    : 0;
  
  // Entnahmerate mit Annuität berechnen
  const monthlyWithdrawalRate = toMonthlyRate(3.0);  // Konservative 3% während Entnahme
  const months = retirementYears * 12;
  const etfMonthlyGross = monthlyWithdrawalRate > 0
    ? etfEndCapital * monthlyWithdrawalRate / (1 - Math.pow(1 + monthlyWithdrawalRate, -months))
    : etfEndCapital / months;
  
  // === ETF-Steuer auf Entnahme ===
  // WICHTIG: Sparerpauschbetrag wird JÄHRLICH angewendet, nicht monatlich!
  // 
  // Berechnung:
  // 1. Gewinnanteil der Entnahme = Entnahme × (Gewinn/Kapital)
  // 2. Steuerpflichtiger Gewinn = Gewinnanteil × 70% (Teilfreistellung Aktienfonds)
  // 3. Jahressteuer = max(0, Jahres-Steuerpflicht - SPB) × 26,375%
  // 4. Monatssteuer = Jahressteuer / 12
  const gainRatio = etfEndCapital > 0 
    ? (etfEndCapital - monthlyNetForEtf * yearsUntilRetirement * 12) / etfEndCapital 
    : 0;
  
  // Jährliche Berechnung für korrekte SPB-Anwendung
  const etfAnnualGross = etfMonthlyGross * 12;
  const taxableGainAnnual = etfAnnualGross * gainRatio * 0.7;  // 30% Teilfreistellung
  const etfAnnualTax = Math.max(0, taxableGainAnnual - sparerpauschbetrag) * 0.26375;
  const etfMonthlyTax = etfAnnualTax / 12;
  const etfMonthlyNet = etfMonthlyGross - etfMonthlyTax;
  const etfTotalNet = etfMonthlyNet * 12 * retirementYears;
  
  // === Ergebnisse ===
  const rentenfaktorBreakEven = calculateRentenfaktorBreakEven(bavGuaranteedCapital, bavRentenfaktor);
  
  // Inflationsbereinigung
  const inflationFactor = Math.pow(1 + inflationPA / 100, yearsUntilRetirement);
  const bavEndCapitalReal = bavEndCapital / inflationFactor;
  const etfEndCapitalReal = etfEndCapital / inflationFactor;
  
  // ETF 4%-Regel (ebenfalls mit jährlicher SPB-Anwendung)
  const etf4PercentAnnual = etfEndCapital * 0.04;
  const etf4PercentTaxableAnnual = etf4PercentAnnual * gainRatio * 0.7;
  const etf4PercentAnnualTax = Math.max(0, etf4PercentTaxableAnnual - sparerpauschbetrag) * 0.26375;
  const etf4PercentNet = (etf4PercentAnnual - etf4PercentAnnualTax) / 12;
  
  // Beiträge aufteilen
  const totalBavContrib = bavMonthlyContribution * yearsUntilRetirement * 12;
  const employerTotal = bavEmployerContribution * yearsUntilRetirement * 12;
  const employeeTotal = totalBavContrib - employerTotal;
  
  return {
    inputs: {
      yearsUntilRetirement,
      retirementYears,
      monthlyNetForEtf,
      bavEffectiveReturn,        // vor Produktkosten (Lifecycle)
      bavEffectiveReturnNet,    // nach Produktkosten (für Anzeige/Analysen)
      taxSavings,
      grvLoss,
      rentenfaktorBreakEven,
    },
    bav: {
      // UI-kompatible Feldnamen
      endCapitalNominal: bavEndCapital,
      endCapitalReal: bavEndCapitalReal,
      guaranteedCapital: bavGuaranteedCapital,
      totalContributions: totalBavContrib,
      employeeContributions: employeeTotal,
      employerContributions: employerTotal,
      monthlyPensionGross: bavMonthlyPension,
      monthlyPensionNet: bavNetPension.monthlyNet,
      effectivePensionTaxRate: bavNetPension.effectiveTaxRate,
      totalNetPension: bavTotalNet,
      grvLossMonthly: grvLoss.lostMonthlyNet,
      breakEvenAge: retirementAge + rentenfaktorBreakEven.yearsToBreakEven,
      returnPA: bavEffectiveReturnNet,
      history: bavHistory,
    },
    etf: {
      // UI-kompatible Feldnamen
      endCapitalNominal: etfEndCapital,
      endCapitalReal: etfEndCapitalReal,
      totalContributions: monthlyNetForEtf * yearsUntilRetirement * 12,
      monthlyWithdrawalGross: etfMonthlyGross,
      monthlyWithdrawalNet: etfMonthlyNet,
      withdrawal4PercentNet: etf4PercentNet,
      totalNetWithdrawal: etfTotalNet,
      capitalGainRatio: gainRatio,
      returnPA: etfExpectedReturn,
      history: etfSavingsHistory,
    },
    comparison: {
      bavAdvantage: bavTotalNet - etfTotalNet,
      bavAdvantageReal: (bavTotalNet - etfTotalNet) / inflationFactor,
      bavAdvantagePercent: etfTotalNet > 0 ? ((bavTotalNet / etfTotalNet) - 1) * 100 : 0,
      monthlyNetDifference: bavNetPension.monthlyNet - etfMonthlyNet,
      recommendation: bavTotalNet > etfTotalNet ? 'bAV' : 'ETF',
    },
  };
}

/**
 * Beitragsfreistellung-Szenario
 */
export function simulateBeitragsfreistellung(params) {
  const {
    currentAge,
    retirementAge = 67,
    expectedLifespan = 85,
    annualGrossIncome,
    hasKinder = false,
    otherPensionIncome = 1500 * 12,
    
    bavCurrentCapital,
    bavMonthlyContribution = 292,
    bavEmployerContribution = 48.67,
    bavRentenfaktor = 20.50,
    bavExpectedReturn = 5.0,
    bavProductCosts = 0,
    
    etfExpectedReturn = 7.0,
    etfTER = 0.22,
    
    inflationPA = 2.0,
    sparerpauschbetrag = SPARERPAUSCHBETRAG_SINGLE,
  } = params;
  
  const yearsUntilRetirement = retirementAge - currentAge;
  const retirementYears = expectedLifespan - retirementAge;
  const employeeContribution = bavMonthlyContribution - bavEmployerContribution;
  const taxSavings = calculateBavTaxSavings(employeeContribution, annualGrossIncome, hasKinder);
  const monthlyNetForEtf = taxSavings.monthlyNetCost;
  
  // Szenario A: bAV weiterführen
  const scenarioA = compareBavVsEtf(params);
  
  // Szenario B: Freistellung + ETF
  // bAV wächst ohne neue Beiträge weiter
  // WICHTIG: bAV bleibt steuerfrei in der Ansparphase (keine Vorabpauschale)
  const bavFreiParams = {
    start_savings: 0,
    start_etf: bavCurrentCapital,
    monthly_savings: 0,
    monthly_etf: 0,  // Keine neuen Beiträge!
    savings_rate_pa: 0,
    etf_rate_pa: Math.max(bavExpectedReturn - bavProductCosts, 0),
    etf_ter_pa: 0,
    savings_target: 0,
    annual_raise_percent: 0,
    savings_years: yearsUntilRetirement,
    withdrawal_years: 0,
    monthly_payout_net: 0,
    inflation_rate_pa: inflationPA,
    sparerpauschbetrag: 0,
    basiszins: -1,  // bAV: keine Vorabpauschale (steuerfrei in Ansparphase)
  };
  
  const bavFreiHistory = simulate(bavFreiParams, 0, {});
  const bavFreiEndCapital = bavFreiHistory.length > 0
    ? bavFreiHistory[bavFreiHistory.length - 1].total
    : bavCurrentCapital;
  
  const bavFreiPension = (bavFreiEndCapital / 10000) * bavRentenfaktor;
  const bavFreiNetPension = calculateBavNetPension(bavFreiPension, otherPensionIncome, hasKinder);
  
  // ETF mit freigewordenem Netto-Gehalt (OHNE AG-Zuschuss!)
  const etfFreiParams = {
    start_savings: 0,
    start_etf: 0,
    monthly_savings: 0,
    monthly_etf: monthlyNetForEtf,  // Nur Netto-Eigenanteil!
    savings_rate_pa: 0,
    etf_rate_pa: etfExpectedReturn,
    etf_ter_pa: etfTER,
    savings_target: 0,
    annual_raise_percent: 0,
    savings_years: yearsUntilRetirement,
    withdrawal_years: 0,
    monthly_payout_net: 0,
    inflation_rate_pa: inflationPA,
    sparerpauschbetrag,
  };
  
  const etfFreiHistory = simulate(etfFreiParams, 0, {});
  const etfFreiEndCapital = etfFreiHistory.length > 0
    ? etfFreiHistory[etfFreiHistory.length - 1].total
    : 0;
  
  // ETF-Entnahme mit korrekter jährlicher SPB-Anwendung
  const months = retirementYears * 12;
  const monthlyRate = toMonthlyRate(3.0);
  const etfFreiMonthlyGross = monthlyRate > 0
    ? etfFreiEndCapital * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months))
    : etfFreiEndCapital / months;
  
  const gainRatio = etfFreiEndCapital > 0
    ? (etfFreiEndCapital - monthlyNetForEtf * yearsUntilRetirement * 12) / etfFreiEndCapital
    : 0;
  
  // Jährliche Berechnung für korrekte SPB-Anwendung
  const etfFreiAnnualGross = etfFreiMonthlyGross * 12;
  const taxableGainAnnual = etfFreiAnnualGross * gainRatio * 0.7;
  const etfFreiAnnualTax = Math.max(0, taxableGainAnnual - sparerpauschbetrag) * 0.26375;
  const etfFreiMonthlyNet = etfFreiMonthlyGross - (etfFreiAnnualTax / 12);
  
  const totalNetA = scenarioA.bav.totalNetPension;
  const totalNetB = (bavFreiNetPension.monthlyNet + etfFreiMonthlyNet) * 12 * retirementYears;
  
  return {
    scenarioA: {
      name: 'bAV weiterführen',
      bavEndCapital: scenarioA.bav.endCapitalNominal,
      bavMonthlyPensionNet: scenarioA.bav.monthlyPensionNet,
      etfEndCapital: 0,
      etfMonthlyNet: 0,
      totalMonthlyNet: scenarioA.bav.monthlyPensionNet,
      totalRetirementNet: totalNetA,
    },
    scenarioB: {
      name: 'Beitragsfreistellung + ETF',
      bavEndCapital: bavFreiEndCapital,
      bavMonthlyPensionNet: bavFreiNetPension.monthlyNet,
      etfEndCapital: etfFreiEndCapital,
      etfMonthlyNet: etfFreiMonthlyNet,
      totalMonthlyNet: bavFreiNetPension.monthlyNet + etfFreiMonthlyNet,
      totalRetirementNet: totalNetB,
      agZuschussVerloren: bavEmployerContribution * yearsUntilRetirement * 12,
    },
    comparison: {
      monthlyDifference: (bavFreiNetPension.monthlyNet + etfFreiMonthlyNet) - scenarioA.bav.monthlyPensionNet,
      totalDifference: totalNetB - totalNetA,
      percentDifference: totalNetA > 0 ? ((totalNetB / totalNetA) - 1) * 100 : 0,
      recommendation: totalNetB > totalNetA ? 'Beitragsfreistellung' : 'bAV weiterführen',
    },
    warnings: [
      `⚠️ AG-Zuschuss entfällt vollständig: ${(bavEmployerContribution * yearsUntilRetirement * 12).toFixed(0)}€`,
      '⚠️ Garantieleistungen werden stark reduziert',
      '⚠️ GRV-Verlust aus bisherigen Einzahlungen bleibt',
    ],
  };
}

/**
 * Sensitivitätsanalyse
 */
export function sensitivityAnalysis(baseParams, paramToVary, values) {
  return values.map(value => {
    const params = { ...baseParams, [paramToVary]: value };
    const result = compareBavVsEtf(params);
    return {
      [paramToVary]: value,
      bavTotal: result.bav.totalNetPension,
      etfTotal: result.etf.totalNetWithdrawal,
      difference: result.comparison.bavAdvantage,
      recommendation: result.comparison.recommendation,
    };
  });
}

export default {
  compareBavVsEtf,
  simulateBeitragsfreistellung,
  calculateBavTaxSavings,
  calculateGrvLoss,
  calculateRentenfaktorBreakEven,
  sensitivityAnalysis,
  BAV_CONSTANTS,
};
