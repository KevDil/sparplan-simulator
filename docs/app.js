/**
 * ETF Sparplan Simulator - Steuermodell und Vereinfachungen
 * 
 * STEUERMODELL (realitätsnah):
 * - Vorabpauschale: Wird im Dezember berechnet, aber erst im Januar des Folgejahres eingezogen
 *   → Nutzt den Sparerpauschbetrag des NEUEN Jahres (korrekt nach § 18 InvStG)
 * - Tagesgeldzinsen: Brutto ansammeln, am Jahresende (Dezember) versteuern
 *   → Nutzt den Sparerpauschbetrag des AKTUELLEN Jahres
 * - Reihenfolge Freibetrag-Nutzung: TG-Zinsen (Dezember) → Vorabpauschale (Januar Folgejahr)
 * 
 * MODELLVEREINFACHUNGEN:
 * - Nur thesaurierende Fonds modelliert (keine Ausschüttungen)
 * - Teilfreistellung je nach Fondstyp (§ 20 InvStG):
 *   → Aktienfonds: 30% steuerfrei (70% steuerpflichtig)
 *   → Mischfonds: 15% steuerfrei (85% steuerpflichtig)
 *   → Rentenfonds/Andere: 0% steuerfrei (100% steuerpflichtig)
 * - Quellensteuer auf ausländische Erträge nicht berücksichtigt
 * - Vorabpauschale-Liquidität: Bei Unterdeckung des Tagesgeldes wird die Steuer auf verfügbares
 *   Guthaben automatischer ETF-Verkauf, bei Totalausfall Shortfall-Flag (keine Dispo-Aufnahme).
 * 
 * VERLUSTVERRECHNUNG (vollständig implementiert):
 * - Ein allgemeiner Verlusttopf für ETF-Verkaufsgewinne/-verluste, Zinsen und Vorabpauschale
 *   (nach deutschem Steuerrecht gehören ETFs in den allgemeinen Topf, nicht in den Aktien-Topf)
 * - Aktien-Verlusttopf wäre nur für Einzelaktien relevant (hier nicht modelliert)
 * - Reihenfolge: Verlusttopf → Sparerpauschbetrag → Rest versteuern (banknah)
 * - Topf wird über Jahre fortgeschrieben (kein Reset am Jahreswechsel)
 * 
 * STEUERBERECHNUNG:
 * - Basisertrag = Wert × Basiszins × 0,7 (§ 18 Abs. 1 InvStG)
 * - Vorabpauschale = min(Basisertrag, Wertzuwachs) 
 * - Steuerpflichtig = Vorabpauschale × 0,7 (Teilfreistellung Aktienfonds, § 20 InvStG)
 * 
 * VERKAUFSREIHENFOLGE:
 * - Standard: FIFO (gesetzlich vorgeschrieben, § 20 Abs. 4 EStG)
 * - Optional: LIFO (nur zur Analyse, NICHT gesetzeskonform für Privatanleger)
 */

const TAX_RATE_BASE = 0.25; // Kapitalertragsteuer
const SOLI_RATE = 0.055; // Solidaritätszuschlag auf KESt
// Teilfreistellung nach § 20 InvStG - steuerpflichtiger Anteil
const TEILFREISTELLUNG_MAP = {
  aktien: 0.7,  // 30% steuerfrei bei Aktienfonds (≥51% Aktien)
  misch: 0.85,  // 15% steuerfrei bei Mischfonds (≥25% Aktien)
  renten: 1.0,  // 0% steuerfrei bei Rentenfonds/Andere
};
const SPARERPAUSCHBETRAG_SINGLE = 1000;
const SPARERPAUSCHBETRAG_VERHEIRATET = 2000;
const KIRCHENSTEUER_SATZ_8 = 0.08; // Bayern, Baden-Württemberg
const KIRCHENSTEUER_SATZ_9 = 0.09; // Restliche Bundesländer

// Berechnet effektiven Steuersatz inkl. Kirchensteuer.
// Hinweis: Bei KiSt darf die Gesamtbelastung nicht unter die 26,375% (ohne KiSt) fallen.
// Wir nutzen die in der Praxis verwendeten Effektiv-Sätze (Kirchensteuerabzugsverfahren).
function calculateTaxRate(kirchensteuerSatz = 0) {
  const basePlusSoli = TAX_RATE_BASE * (1 + SOLI_RATE); // 26,375% ohne KiSt

  if (kirchensteuerSatz === 0) return basePlusSoli;

  // Effektivbelastung laut KiSt-Abzugsverfahren (gerundet):
  // 8% KiSt: ~27,82%, 9% KiSt: ~27,99%
  if (kirchensteuerSatz === KIRCHENSTEUER_SATZ_8) return 0.27818;
  if (kirchensteuerSatz === KIRCHENSTEUER_SATZ_9) return 0.27995;

  // Fallback: additiver Aufschlag (konservativ, etwas höher als basePlusSoli)
  return basePlusSoli + TAX_RATE_BASE * kirchensteuerSatz;
}
const MONTHS_PER_YEAR = 12;
const INITIAL_ETF_PRICE = 100;
const Y_AXIS_STEPS = 5;
const STORAGE_KEY = "etf_simulator_params";

const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const form = document.getElementById("sim-form");
const graphCanvas = document.getElementById("graph");
const tooltip = document.getElementById("tooltip");
const messageEl = document.getElementById("message");
const tableBody = document.querySelector("#year-table tbody");

let graphState = null;
let lastHistory = [];
let lastParams = null;
let includeSpecialWithdrawals = false; // Toggle: Sonderausgaben in Statistik einbeziehen
let stdUseLogScale = false; // Standard: lineare Skala für Standard-Chart
let showRealStats = false; // Toggle: Nominale vs. inflationsbereinigte Statistiken

// ============ UTILITY FUNCTIONS ============

function toMonthlyRate(annualPercent) {
  return Math.pow(1 + annualPercent / 100, 1 / MONTHS_PER_YEAR) - 1;
}

// Konvertiert jährliche Volatilität zu monatlicher
function toMonthlyVolatility(annualVolatility) {
  return annualVolatility / Math.sqrt(12);
}

// Globaler RNG - wird für Seeded Monte-Carlo überschrieben
let currentRng = Math.random;

// Box-Muller Transform für Normalverteilung (für Monte-Carlo)
// Nutzt currentRng für reproduzierbare Ergebnisse wenn Seed gesetzt
function randomNormal(mean = 0, stdDev = 1) {
  let u1, u2;
  do {
    u1 = currentRng();
    u2 = currentRng();
  } while (u1 === 0);
  
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev + mean;
}

function readNumber(id, { min = null, max = null, allowZero = true } = {}) {
  const el = document.getElementById(id);
  const label = el.previousElementSibling?.textContent || id;
  const val = parseFloat(String(el.value).replace(",", "."));
  
  if (Number.isNaN(val)) {
    throw new Error(`Bitte Wert prüfen: ${label}`);
  }
  if (!allowZero && val === 0) {
    throw new Error(`${label} darf nicht 0 sein.`);
  }
  if (min !== null && val < min) {
    throw new Error(`${label} muss mindestens ${min} sein.`);
  }
  if (max !== null && val > max) {
    throw new Error(`${label} darf maximal ${max} sein.`);
  }
  return val;
}

// ============ LOCALSTORAGE ============

function saveToStorage(params) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch (e) { /* ignore */ }
}

function loadFromStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    return null;
  }
}

function applyStoredValues() {
  const stored = loadFromStorage();
  if (!stored) return;
  
  const fieldMap = {
    start_savings: "start_savings",
    start_etf: "start_etf",
    start_etf_cost_basis: "start_etf_cost_basis",
    savings_rate_pa: "savings_rate",
    etf_rate_pa: "etf_rate",
    etf_ter_pa: "etf_ter",
    savings_target: "savings_target",
    savings_years: "years_save",
    monthly_savings: "monthly_savings",
    monthly_etf: "monthly_etf",
    annual_raise_percent: "annual_raise",
    special_payout_net_savings: "special_savings",
    special_interval_years_savings: "special_savings_interval",
    withdrawal_years: "years_withdraw",
    monthly_payout_net: "rent_eur",
    monthly_payout_percent: "rent_percent",
    withdrawal_min: "withdrawal_min",
    withdrawal_max: "withdrawal_max",
    special_payout_net_withdrawal: "special_withdraw",
    special_interval_years_withdrawal: "special_withdraw_interval",
    inflation_rate_pa: "inflation_rate",
    sparerpauschbetrag: "sparerpauschbetrag",
    basiszins: "basiszins",
    capital_preservation_threshold: "capital_preservation_threshold",
    capital_preservation_reduction: "capital_preservation_reduction",
    capital_preservation_recovery: "capital_preservation_recovery",
    loss_pot: "loss_pot",
  };
  
  // Select-Elemente (Dropdowns)
  const selectFields = [
    { key: "kirchensteuer", id: "kirchensteuer" },
    { key: "fondstyp", id: "fondstyp" },
  ];
  for (const { key, id } of selectFields) {
    const el = document.getElementById(id);
    if (el && stored[key] != null) {
      el.value = stored[key];
    }
  }
  
  // Checkboxen separat behandeln
  const checkboxes = [
    { id: "inflation_adjust_withdrawal", key: "inflation_adjust_withdrawal" },
    { id: "inflation_adjust_special_savings", key: "inflation_adjust_special_savings" },
    { id: "inflation_adjust_special_withdrawal", key: "inflation_adjust_special_withdrawal" },
    { id: "capital_preservation_enabled", key: "capital_preservation_enabled" },
    { id: "use_lifo", key: "use_lifo" },
  ];
  for (const { id, key } of checkboxes) {
    const el = document.getElementById(id);
    if (el && stored[key] != null) {
      el.checked = stored[key];
    }
  }
  
  for (const [paramKey, inputId] of Object.entries(fieldMap)) {
    const el = document.getElementById(inputId);
    if (el && stored[paramKey] != null) {
      el.value = stored[paramKey];
    }
  }
  
  if (stored.rent_mode) {
    const radio = form.querySelector(`input[name="rent_mode"][value="${stored.rent_mode}"]`);
    if (radio) radio.checked = true;
  }
}

function getDefaultValues() {
  return {
    start_savings: 4000,
    start_etf: 100,
    start_etf_cost_basis: 0,
    savings_rate: 3.0,
    etf_rate: 6.0,
    etf_ter: 0.2,
    savings_target: 5000,
    years_save: 36,
    monthly_savings: 100,
    monthly_etf: 150,
    annual_raise: 3.0,
    special_savings: 15000,
    special_savings_interval: 10,
    inflation_adjust_special_savings: true,
    years_withdraw: 30,
    rent_eur: 1000,
    rent_percent: 4.0,
    withdrawal_min: 0,
    withdrawal_max: 0,
    inflation_adjust_withdrawal: true,
    special_withdraw: 15000,
    special_withdraw_interval: 10,
    inflation_adjust_special_withdrawal: true,
    inflation_rate: 2.0,
    sparerpauschbetrag: SPARERPAUSCHBETRAG_SINGLE,
    kirchensteuer: "keine",
    fondstyp: "aktien",
    basiszins: 2.53,
    use_lifo: false,
    capital_preservation_enabled: false,
    capital_preservation_threshold: 80,
    capital_preservation_reduction: 25,
    capital_preservation_recovery: 10,
    loss_pot: 0,
  };
}

function resetToDefaults() {
  const defaults = getDefaultValues();
  for (const [id, val] of Object.entries(defaults)) {
    const el = document.getElementById(id);
    if (el) {
      if (el.type === "checkbox") {
        el.checked = val;
      } else {
        el.value = val;
      }
    }
  }
  const eurRadio = form.querySelector('input[name="rent_mode"][value="eur"]');
  if (eurRadio) eurRadio.checked = true;
  updateRentModeFields();
  localStorage.removeItem(STORAGE_KEY);
  messageEl.textContent = "Standardwerte wiederhergestellt.";
}

// ============ CSV EXPORT ============

function exportToCsv(history, params = lastParams) {
  if (!history.length) {
    messageEl.textContent = "Keine Daten zum Exportieren.";
    return;
  }
  if (!params) {
    messageEl.textContent = "Bitte zuerst eine Simulation ausführen, damit Eingaben exportiert werden.";
    return;
  }
  
  const settingsHeader = ["Einstellung", "Wert"];
  const settingsRows = [
    settingsHeader,
    ["Exportzeitpunkt", new Date().toISOString()],
    ...Object.entries(params).map(([key, val]) => [key, val ?? ""]),
    [],
  ];
  
  const dataHeader = [
    "Jahr",
    "Monat",
    "Phase",
    "Tagesgeld",
    "ETF",
    "Gesamt",
    "Gesamt (real)",
    "Rendite",
    "Entnahme",
    "Steuern",
    "Shortfall Entnahme",
    "Shortfall Steuer",
    "Vorabpauschale",
    "Freibetrag genutzt (Jahr)",
    "Verlusttopf",
  ];
  const dataRows = history.map(r => [
    r.year,
    r.month,
    r.phase,
    r.savings.toFixed(2),
    r.etf.toFixed(2),
    r.total.toFixed(2),
    (r.total_real || r.total).toFixed(2),
    (r.return_gain || 0).toFixed(2),
    (r.withdrawal || 0).toFixed(2),
    (r.tax_paid || 0).toFixed(2),
    (r.shortfall || 0).toFixed(2),
    (r.tax_shortfall || 0).toFixed(2),
    (r.vorabpauschale_tax || 0).toFixed(2),
    (r.yearly_used_freibetrag || 0).toFixed(2),
    (r.loss_pot || 0).toFixed(2),
  ]);
  
  const csvContent = [...settingsRows, dataHeader, ...dataRows].map(row => row.join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `etf_simulation_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  messageEl.textContent = "CSV exportiert (inkl. Einstellungen).";
}

// ============ MONTE-CARLO CSV EXPORT ============

function exportMonteCarloToCsv(results, params = lastParams) {
  if (!results) {
    messageEl.textContent = "Keine Monte-Carlo-Daten zum Exportieren. Bitte zuerst Simulation starten.";
    return;
  }
  
  // MC-Optionen aus Results extrahieren
  const mcOpts = results.mcOptions || {};
  const successThreshold = mcOpts.successThreshold ?? 100;
  const ruinThreshold = mcOpts.ruinThresholdPercent ?? 10;
  const seed = mcOpts.seed ?? "zufällig";
  
  const settingsHeader = ["Einstellung", "Wert"];
  const settingsRows = [
    settingsHeader,
    ["Exportzeitpunkt", new Date().toISOString()],
    ["Simulationstyp", "Monte-Carlo"],
    ["Anzahl Simulationen", results.iterations],
    ["Volatilität p.a.", `${results.volatility || ""}%`],
    ["Random Seed", seed],
    [],
    ["=== MC-KRITERIEN ===", ""],
    ["Erfolgsschwelle (real)", `${successThreshold}€`],
    ["Ruin-Schwelle", `${ruinThreshold}% des Rentenbeginn-Vermögens`],
    ["LIFO-Modus", params?.use_lifo ? "Ja (nur Analyse)" : "Nein (FIFO, gesetzeskonform)"],
    [],
    ["=== EINGABEPARAMETER ===", ""],
    ...Object.entries(params || {}).map(([key, val]) => [key, val ?? ""]),
    [],
  ];
  
  // Zusammenfassung mit dynamischen Labels
  const summaryRows = [
    ["=== ZUSAMMENFASSUNG ===", ""],
    [`Erfolgswahrscheinlichkeit (keine Entnahme-Shortfalls & Endvermögen >${successThreshold}€ real)`, `${results.successRate.toFixed(1)}%`],
    ["Kapitalerhalt-Rate (nominal)", `${results.capitalPreservationRate.toFixed(1)}%`],
    ["Kapitalerhalt-Rate (real/inflationsbereinigt)", `${results.capitalPreservationRateReal.toFixed(1)}%`],
    [`Pleite-Risiko (Entnahmephase: <${ruinThreshold}% Rentenbeginn-Vermögen oder Shortfall)`, `${results.ruinProbability.toFixed(1)}%`],
    [],
    ["=== ENDVERMÖGEN NOMINAL ===", ""],
    ["Endvermögen (Median)", results.medianEnd.toFixed(2)],
    ["Endvermögen (5%-Perzentil, Worst)", results.p5End.toFixed(2)],
    ["Endvermögen (10%-Perzentil)", results.p10End.toFixed(2)],
    ["Endvermögen (90%-Perzentil)", results.p90End.toFixed(2)],
    ["Endvermögen (95%-Perzentil, Best)", results.p95End.toFixed(2)],
    ["Endvermögen (Durchschnitt)", results.meanEnd.toFixed(2)],
    [],
    ["=== ENDVERMÖGEN REAL (inflationsbereinigt) ===", ""],
    ["Endvermögen real (Median)", results.medianEndReal.toFixed(2)],
    ["Endvermögen real (5%-Perzentil, Worst)", results.p5EndReal.toFixed(2)],
    ["Endvermögen real (10%-Perzentil)", results.p10EndReal.toFixed(2)],
    ["Endvermögen real (90%-Perzentil)", results.p90EndReal.toFixed(2)],
    ["Endvermögen real (95%-Perzentil, Best)", results.p95EndReal.toFixed(2)],
    ["Endvermögen real (Durchschnitt)", results.meanEndReal.toFixed(2)],
    [],
    ["Vermögen bei Rentenbeginn (Median nominal)", results.retirementMedian.toFixed(2)],
    ["Vermögen bei Rentenbeginn (Median real)", results.retirementMedianReal.toFixed(2)],
    [],
    ["=== SEQUENCE-OF-RETURNS RISK (Portfolio-Rendite) ===", ""],
    ["SoRR-Spreizung", `${results.sorr?.sorRiskScore?.toFixed(1) || 0}%`],
    ["Früher Crash-Effekt", `${results.sorr?.earlyBadImpact?.toFixed(1) || 0}%`],
    ["Früher Boom-Effekt", `+${results.sorr?.earlyGoodImpact?.toFixed(1) || 0}%`],
    ["Korrelation frühe Portfolio-Rendite <-> Endvermögen", `${((results.sorr?.correlationEarlyReturns || 0) * 100).toFixed(1)}%`],
    ["Endvermögen (schlechte Sequenz)", (results.sorr?.worstSequenceEnd || 0).toFixed(2)],
    ["Endvermögen (gute Sequenz)", (results.sorr?.bestSequenceEnd || 0).toFixed(2)],
    ["Kritisches Fenster", `Jahr 1-${results.sorr?.vulnerabilityWindow || 5}`],
    [],
    ["=== VERLUSTTOPF & FREIBETRAG (Endstände) ===", ""],
    ["Allg. Verlusttopf (Median)", results.medianFinalLossPot.toFixed(2)],
    ["Freibetrag genutzt im letzten Jahr (Median)", results.medianFinalYearlyFreibetrag.toFixed(2)],
    [],
  ];
  
  // Perzentile pro Monat (nominal)
  const percentileHeader = ["Monat", "Jahr", "P5", "P10", "P25", "P50 (Median)", "P75", "P90", "P95"];
  const percentileRows = results.months.map((month, idx) => [
    month,
    Math.ceil(month / 12),
    results.percentiles.p5[idx].toFixed(2),
    results.percentiles.p10[idx].toFixed(2),
    results.percentiles.p25[idx].toFixed(2),
    results.percentiles.p50[idx].toFixed(2),
    results.percentiles.p75[idx].toFixed(2),
    results.percentiles.p90[idx].toFixed(2),
    results.percentiles.p95[idx].toFixed(2),
  ]);
  
  // Perzentile pro Monat (real/inflationsbereinigt)
  const percentileRealHeader = ["Monat", "Jahr", "P5 real", "P10 real", "P25 real", "P50 real (Median)", "P75 real", "P90 real", "P95 real"];
  const percentileRealRows = results.months.map((month, idx) => [
    month,
    Math.ceil(month / 12),
    results.percentilesReal.p5[idx].toFixed(2),
    results.percentilesReal.p10[idx].toFixed(2),
    results.percentilesReal.p25[idx].toFixed(2),
    results.percentilesReal.p50[idx].toFixed(2),
    results.percentilesReal.p75[idx].toFixed(2),
    results.percentilesReal.p90[idx].toFixed(2),
    results.percentilesReal.p95[idx].toFixed(2),
  ]);
  
  const csvContent = [
    ...settingsRows,
    ...summaryRows,
    ["=== PERZENTILE PRO MONAT (nominal) ===", "", "", "", "", "", "", "", ""],
    percentileHeader,
    ...percentileRows,
    [],
    ["=== PERZENTILE PRO MONAT (real/inflationsbereinigt) ===", "", "", "", "", "", "", "", ""],
    percentileRealHeader,
    ...percentileRealRows
  ].map(row => row.join(";")).join("\n");
  
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `monte_carlo_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  messageEl.textContent = "Monte-Carlo CSV exportiert.";
}

// ============ PDF EXPORT ============

async function exportToPdf(history, params = lastParams) {
  if (!history.length) {
    messageEl.textContent = "Keine Daten zum Exportieren.";
    return;
  }
  
  messageEl.textContent = "PDF wird erstellt...";
  
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    let y = margin;
    
    // Header
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text("ETF Sparplan-Simulation", margin, y);
    y += 8;
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100);
    doc.text(`Erstellt am ${new Date().toLocaleDateString("de-DE")} um ${new Date().toLocaleTimeString("de-DE")}`, margin, y);
    y += 12;
    
    doc.setTextColor(0);
    
    // Eingabeparameter
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Eingabeparameter", margin, y);
    y += 7;
    
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    
    const paramLabels = {
      start_savings: "Start Tagesgeld",
      start_etf: "Start ETF",
      savings_rate_pa: "TG-Zins p.a.",
      etf_rate_pa: "ETF-Rendite p.a.",
      etf_ter_pa: "ETF TER p.a.",
      savings_target: "Tagesgeld-Ziel",
      savings_years: "Ansparphase (Jahre)",
      withdrawal_years: "Entnahmephase (Jahre)",
      monthly_savings: "Monatl. TG-Sparrate",
      monthly_etf: "Monatl. ETF-Sparrate",
      annual_raise_percent: "Gehaltserh. p.a.",
      monthly_payout_net: "Wunschrente (EUR)",
      monthly_payout_percent: "Wunschrente (%)",
      inflation_rate_pa: "Inflation p.a.",
      sparerpauschbetrag: "Sparerpauschbetrag",
      capital_preservation_enabled: "Kapitalerhalt aktiv",
      capital_preservation_threshold: "Kapitalerhalt Schwelle",
      capital_preservation_reduction: "Kapitalerhalt Reduktion",
      capital_preservation_recovery: "Kapitalerhalt Erholung",
    };
    
    const col1X = margin;
    const col2X = margin + 55;
    const col3X = margin + 110;
    let paramY = y;
    let colIdx = 0;
    
    for (const [key, label] of Object.entries(paramLabels)) {
      if (params[key] !== undefined && params[key] !== null) {
        const x = colIdx === 0 ? col1X : colIdx === 1 ? col2X : col3X;
        const val = typeof params[key] === "number" 
          ? (key.includes("rate") || key.includes("percent") ? `${params[key]}%` : `${nf0.format(params[key])} €`)
          : params[key];
        doc.text(`${label}: ${val}`, x, paramY);
        colIdx++;
        if (colIdx > 2) {
          colIdx = 0;
          paramY += 5;
        }
      }
    }
    y = paramY + 10;
    
    // Chart als Bild
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Vermögensverlauf", margin, y);
    y += 5;
    
    try {
      const canvas = document.getElementById("graph");
      const chartImage = canvas.toDataURL("image/png", 1.0);
      const chartWidth = pageWidth - 2 * margin;
      const chartHeight = chartWidth * 0.5;
      doc.addImage(chartImage, "PNG", margin, y, chartWidth, chartHeight);
      y += chartHeight + 10;
    } catch (e) {
      doc.setFontSize(9);
      doc.text("(Chart konnte nicht eingefügt werden)", margin, y);
      y += 10;
    }
    
    // Statistiken
    if (y > pageHeight - 80) {
      doc.addPage();
      y = margin;
    }
    
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Ergebnisse", margin, y);
    y += 7;
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    
    const lastRow = history[history.length - 1];
    const ansparRows = history.filter(r => r.phase === "Anspar");
    const entnahmeRows = history.filter(r => r.phase === "Entnahme");
    const totalInvested = (params.start_savings || 0) + (params.start_etf || 0) +
      ansparRows.reduce((sum, r) => sum + (r.savings_contrib || 0) + (r.etf_contrib || 0), 0);
    const totalReturn = history.reduce((sum, r) => sum + (r.return_gain || 0), 0);
    const totalTax = history.reduce((sum, r) => sum + (r.tax_paid || 0), 0);
    
    const stats = [
      ["Endvermögen (nominal)", formatCurrency(lastRow.total)],
      ["Endvermögen (real)", formatCurrency(lastRow.total_real || lastRow.total)],
      ["Eingezahlt gesamt", formatCurrency(totalInvested)],
      ["Rendite gesamt", formatCurrency(totalReturn)],
      ["Steuern gesamt", formatCurrency(totalTax)],
    ];
    
    if (entnahmeRows.length > 0) {
      // KORRIGIERT: Nutze tatsächlich gezahlte Beträge (monthly_payout), nicht gewünschte
      const withdrawals = entnahmeRows.filter(r => r.monthly_payout > 0).map(r => r.monthly_payout);
      if (withdrawals.length > 0) {
        const avgWithdrawal = withdrawals.reduce((a, b) => a + b, 0) / withdrawals.length;
        stats.push(["Ø Entnahme/Monat (tatsächlich)", formatCurrency(avgWithdrawal)]);
      }
    }
    
    for (const [label, val] of stats) {
      doc.text(`${label}: ${val}`, margin, y);
      y += 5;
    }
    y += 5;
    
    // Jahresübersicht (kompakt)
    if (y > pageHeight - 60) {
      doc.addPage();
      y = margin;
    }
    
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Jahresübersicht", margin, y);
    y += 7;
    
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    const tableHeaders = ["Jahr", "Phase", "Tagesgeld", "ETF", "Gesamt", "Gesamt (real)", "Entnahme", "Steuern"];
    const colWidths = [12, 18, 25, 25, 25, 28, 22, 20];
    let x = margin;
    for (let i = 0; i < tableHeaders.length; i++) {
      doc.text(tableHeaders[i], x, y);
      x += colWidths[i];
    }
    y += 5;
    
    // Trennlinie
    doc.setDrawColor(200);
    doc.line(margin, y - 2, pageWidth - margin, y - 2);
    
    doc.setFont("helvetica", "normal");
    
    // Aggregiere nach Jahr
    let currentYear = history[0].year;
    let yearData = { withdrawal: 0, tax: 0, lastRow: null };
    
    const flushYear = () => {
      if (!yearData.lastRow) return;
      x = margin;
      const r = yearData.lastRow;
      const rowData = [
        String(currentYear),
        r.phase,
        formatCurrency(r.savings),
        formatCurrency(r.etf),
        formatCurrency(r.total),
        formatCurrency(r.total_real || r.total),
        formatCurrency(yearData.withdrawal),
        formatCurrency(yearData.tax)
      ];
      for (let i = 0; i < rowData.length; i++) {
        doc.text(rowData[i], x, y);
        x += colWidths[i];
      }
      y += 4;
      
      if (y > pageHeight - 15) {
        doc.addPage();
        y = margin;
      }
    };
    
    for (const row of history) {
      if (row.year !== currentYear) {
        flushYear();
        currentYear = row.year;
        yearData = { withdrawal: 0, tax: 0, lastRow: null };
      }
      yearData.withdrawal += row.withdrawal || 0;
      yearData.tax += row.tax_paid || 0;
      yearData.lastRow = row;
    }
    flushYear();
    
    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text("Erstellt mit ETF Sparplan-Simulator | Simulation, keine Anlageberatung", margin, pageHeight - 10);
    
    doc.save(`etf_simulation_${new Date().toISOString().slice(0, 10)}.pdf`);
    messageEl.textContent = "PDF exportiert.";
    
  } catch (err) {
    console.error("PDF Export Error:", err);
    messageEl.textContent = "Fehler beim PDF-Export: " + err.message;
  }
}

// ============ MONTE-CARLO PDF EXPORT ============

async function exportMonteCarloToPdf(results, params = lastParams) {
  if (!results) {
    messageEl.textContent = "Keine Monte-Carlo-Daten zum Exportieren. Bitte zuerst Simulation starten.";
    return;
  }
  
  messageEl.textContent = "PDF wird erstellt...";
  
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    let y = margin;
    
    // Header
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text("Monte-Carlo-Simulation", margin, y);
    y += 8;
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100);
    doc.text(`${nf0.format(results.iterations)} Simulationen | Erstellt am ${new Date().toLocaleDateString("de-DE")}`, margin, y);
    y += 12;
    
    doc.setTextColor(0);
    
    // Erfolgswahrscheinlichkeit (prominent)
    doc.setFillColor(240, 240, 240);
    doc.roundedRect(margin, y, pageWidth - 2 * margin, 25, 3, 3, "F");
    
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text("Erfolgswahrscheinlichkeit", margin + 5, y + 8);
    
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    const successColor = results.successRate >= 95 ? [34, 197, 94] : results.successRate >= 80 ? [245, 158, 11] : [239, 68, 68];
    doc.setTextColor(...successColor);
    doc.text(`${results.successRate.toFixed(1)}%`, margin + 5, y + 20);
    
    doc.setTextColor(0);
    y += 32;
    
    // Chart
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Vermögensverteilung über Zeit", margin, y);
    y += 5;
    
    try {
      const canvas = document.getElementById("mc-graph");
      const chartImage = canvas.toDataURL("image/png", 1.0);
      const chartWidth = pageWidth - 2 * margin;
      const chartHeight = chartWidth * 0.5;
      doc.addImage(chartImage, "PNG", margin, y, chartWidth, chartHeight);
      y += chartHeight + 10;
    } catch (e) {
      doc.setFontSize(9);
      doc.text("(Chart konnte nicht eingefügt werden)", margin, y);
      y += 10;
    }
    
    // Statistiken
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Ergebnisse", margin, y);
    y += 7;
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    
    const statsLeft = [
      ["Endvermögen (Median)", formatCurrency(results.medianEnd)],
      ["Endvermögen (10%-90%)", `${formatCurrency(results.p10End)} - ${formatCurrency(results.p90End)}`],
      ["Worst Case (5%)", formatCurrency(results.p5End)],
      ["Best Case (95%)", formatCurrency(results.p95End)],
      ["Durchschnitt", formatCurrency(results.meanEnd)],
    ];
    
    const statsRight = [
      ["Endvermögen real (Median)", formatCurrency(results.medianEndReal)],
      ["Endvermögen real (10%-90%)", `${formatCurrency(results.p10EndReal)} - ${formatCurrency(results.p90EndReal)}`],
      ["Kapitalerhalt-Rate", `${results.capitalPreservationRate.toFixed(1)}%`],
      ["Pleite-Risiko (Pfad)", `${results.ruinProbability.toFixed(1)}%`],
      ["Vermögen bei Rentenbeginn", formatCurrency(results.retirementMedian)],
    ];
    
    const leftX = margin;
    const rightX = margin + 90;
    
    for (let i = 0; i < Math.max(statsLeft.length, statsRight.length); i++) {
      if (statsLeft[i]) {
        doc.text(`${statsLeft[i][0]}: ${statsLeft[i][1]}`, leftX, y);
      }
      if (statsRight[i]) {
        doc.text(`${statsRight[i][0]}: ${statsRight[i][1]}`, rightX, y);
      }
      y += 5;
    }
    y += 10;
    
    // Sequence-of-Returns Risk
    if (results.sorr && results.sorr.sorRiskScore > 0) {
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Sequence-of-Returns Risk", margin, y);
      y += 6;
      
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      
      const sorrStats = [
        ["SoRR-Spreizung", `${results.sorr.sorRiskScore.toFixed(0)}%`],
        ["Früher Crash-Effekt", `${results.sorr.earlyBadImpact.toFixed(0)}%`],
        ["Früher Boom-Effekt", `+${results.sorr.earlyGoodImpact.toFixed(0)}%`],
        ["Korrelation frühe Rendite ↔ Ende", `${(results.sorr.correlationEarlyReturns * 100).toFixed(0)}%`],
        ["Kritisches Fenster", `Jahr 1-${results.sorr.vulnerabilityWindow}`],
      ];
      
      for (const [label, val] of sorrStats) {
        doc.text(`${label}: ${val}`, margin, y);
        y += 4;
      }
      y += 5;
    }
    
    // Eingabeparameter (Seite 2)
    doc.addPage();
    y = margin;
    
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Eingabeparameter", margin, y);
    y += 7;
    
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    
    if (params) {
      const paramLabels = {
        start_savings: "Start Tagesgeld",
        start_etf: "Start ETF",
        savings_rate_pa: "TG-Zins p.a.",
        etf_rate_pa: "ETF-Rendite p.a.",
        etf_ter_pa: "ETF TER p.a.",
        savings_target: "Tagesgeld-Ziel",
        savings_years: "Ansparphase (Jahre)",
        withdrawal_years: "Entnahmephase (Jahre)",
        monthly_savings: "Monatl. TG-Sparrate",
        monthly_etf: "Monatl. ETF-Sparrate",
        annual_raise_percent: "Gehaltserh. p.a.",
        monthly_payout_net: "Wunschrente (EUR)",
        monthly_payout_percent: "Wunschrente (%)",
        inflation_rate_pa: "Inflation p.a.",
        sparerpauschbetrag: "Sparerpauschbetrag",
        capital_preservation_enabled: "Kapitalerhalt aktiv",
        capital_preservation_threshold: "Kapitalerhalt Schwelle",
        capital_preservation_reduction: "Kapitalerhalt Reduktion",
        capital_preservation_recovery: "Kapitalerhalt Erholung",
      };
      
      for (const [key, label] of Object.entries(paramLabels)) {
        if (params[key] !== undefined && params[key] !== null) {
          const val = typeof params[key] === "number" 
            ? (key.includes("rate") || key.includes("percent") ? `${params[key]}%` : `${nf0.format(params[key])} €`)
            : params[key];
          doc.text(`${label}: ${val}`, margin, y);
          y += 5;
        }
      }
    }
    
    // Perzentil-Tabelle (Jahresweise)
    y += 10;
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Perzentile nach Jahr", margin, y);
    y += 7;
    
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    const tableHeaders = ["Jahr", "5%", "10%", "25%", "50%", "75%", "90%", "95%"];
    const colWidths = [15, 23, 23, 23, 23, 23, 23, 23];
    let x = margin;
    for (let i = 0; i < tableHeaders.length; i++) {
      doc.text(tableHeaders[i], x, y);
      x += colWidths[i];
    }
    y += 4;
    
    doc.setDrawColor(200);
    doc.line(margin, y - 1, pageWidth - margin, y - 1);
    
    doc.setFont("helvetica", "normal");
    
    // Nur Jahresende-Werte
    for (let year = 1; year <= Math.ceil(results.months.length / 12); year++) {
      const monthIdx = Math.min(year * 12 - 1, results.months.length - 1);
      x = margin;
      const rowData = [
        String(year),
        formatCurrency(results.percentiles.p5[monthIdx]),
        formatCurrency(results.percentiles.p10[monthIdx]),
        formatCurrency(results.percentiles.p25[monthIdx]),
        formatCurrency(results.percentiles.p50[monthIdx]),
        formatCurrency(results.percentiles.p75[monthIdx]),
        formatCurrency(results.percentiles.p90[monthIdx]),
        formatCurrency(results.percentiles.p95[monthIdx]),
      ];
      for (let i = 0; i < rowData.length; i++) {
        doc.text(rowData[i], x, y);
        x += colWidths[i];
      }
      y += 4;
      
      if (y > pageHeight - 15) {
        doc.addPage();
        y = margin;
      }
    }
    
    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text("Erstellt mit ETF Sparplan-Simulator | Simulation, keine Anlageberatung", margin, pageHeight - 10);
    
    doc.save(`monte_carlo_${new Date().toISOString().slice(0, 10)}.pdf`);
    messageEl.textContent = "Monte-Carlo PDF exportiert.";
    
  } catch (err) {
    console.error("PDF Export Error:", err);
    messageEl.textContent = "Fehler beim PDF-Export: " + err.message;
  }
}

// ============ LOT CONSOLIDATION (Performance) ============

/**
 * Konsolidiert ETF-Lots mit gleichem Kaufpreis (nach Rundung), um die Array-Größe zu reduzieren.
 * Wird jährlich aufgerufen, um bei langen Simulationen die Performance zu verbessern.
 * @param {Array} etfLots - Array von {amount, price, monthIdx}
 * @param {number} priceTolerance - Preistoleranz für Zusammenführung (Standard: 0.01 = 1 Cent)
 * @returns {Array} Konsolidiertes Lot-Array
 */
function consolidateLots(etfLots, priceTolerance = 0.01) {
  if (etfLots.length <= 1) return etfLots;
  
  // Gruppiere Lots nach gerundetem Preis
  const grouped = new Map();
  
  for (const lot of etfLots) {
    if (lot.amount <= 0) continue;
    
    // Runde Preis auf 2 Dezimalstellen für Gruppierung
    const roundedPrice = Math.round(lot.price / priceTolerance) * priceTolerance;
    const key = roundedPrice.toFixed(4);
    
    if (grouped.has(key)) {
      const existing = grouped.get(key);
      // Gewichteter Durchschnittspreis
      const totalAmount = existing.amount + lot.amount;
      const avgPrice = (existing.price * existing.amount + lot.price * lot.amount) / totalAmount;
      existing.amount = totalAmount;
      existing.price = avgPrice;
      // Behalte ältesten monthIdx (für FIFO-Reihenfolge)
      existing.monthIdx = Math.min(existing.monthIdx, lot.monthIdx);
    } else {
      grouped.set(key, { ...lot });
    }
  }
  
  // Konvertiere Map zurück zu Array, sortiert nach monthIdx (FIFO-Ordnung)
  return Array.from(grouped.values()).sort((a, b) => a.monthIdx - b.monthIdx);
}

// ============ ETF SELLING (EXTRACTED) ============

/**
 * Verkauft ETF-Anteile steueroptimiert mit Verlusttopf-Verrechnung.
 * Reihenfolge: 1) Teilfreistellung → 2) ETF-Verlusttopf → 3) Sparerpauschbetrag → 4) Steuer
 * Bei Verlusten: Verlust (nach Teilfreistellung) erhöht den ETF-Verlusttopf.
 * 
 * @param {number} remaining - Benötigter Netto-Betrag
 * @param {Array} etfLots - Array von Lots {amount, price, monthIdx}
 * @param {number} currentEtfPrice - Aktueller ETF-Preis
 * @param {number} yearlyUsedFreibetrag - Bereits genutzter Freibetrag im Jahr
 * @param {number} sparerpauschbetrag - Jährlicher Sparerpauschbetrag
 * @param {number} taxRate - Effektiver Steuersatz
 * @param {number} lossPot - Allgemeiner Verlusttopf (Startwert)
 * @param {boolean} useFifo - true = FIFO, false = LIFO
 * @param {number} teilfreistellung - Steuerpflichtiger Anteil (0.7 Aktien, 0.85 Misch, 1.0 Renten)
 * @returns {Object} { remaining, taxPaid, yearlyUsedFreibetrag, lossPot, grossProceeds, taxableGainTotal }
 */
function sellEtfOptimized(remaining, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate, lossPotStart = 0, useFifo = true, teilfreistellung = 0.7) {
  let taxPaid = 0;
  let freibetragUsed = yearlyUsedFreibetrag;
  let lossPot = lossPotStart;
  let grossProceeds = 0; // Brutto-Verkaufserlös für Vorabpauschale-Tracking
  let taxableGainTotal = 0; // Steuerpflichtiger Gewinn/Verlust gesamt (nach Teilfreistellung)
  
  while (remaining > 0.01 && etfLots.length) {
    // FIFO: Erstes Element (ältestes Lot), LIFO: Letztes Element (neuestes Lot)
    const lotIndex = useFifo ? 0 : etfLots.length - 1;
    const lot = etfLots[lotIndex];
    const gainPerShare = currentEtfPrice - lot.price;
    const remainingFreibetrag = Math.max(0, sparerpauschbetrag - freibetragUsed);
    let sharesNeeded;

    if (gainPerShare > 0) {
      // Gewinn: Berechne wie viele Shares wir verkaufen müssen
      const taxableGainPerShare = gainPerShare * teilfreistellung;
      
      // Verlusttopf deckt wie viele Shares ab? (zuerst, banknah)
      const lossPotCoversShares = Math.min(
        taxableGainPerShare > 0 ? lossPot / taxableGainPerShare : Number.POSITIVE_INFINITY,
        lot.amount
      );
      
      // Freibetrag deckt wie viele zusätzliche Shares ab? (danach)
      const freibetragCoversShares = Math.min(
        taxableGainPerShare > 0 ? remainingFreibetrag / taxableGainPerShare : Number.POSITIVE_INFINITY,
        lot.amount - lossPotCoversShares
      );
      
      const totalTaxFreeShares = lossPotCoversShares + freibetragCoversShares;
      const sharesIfTaxFree = remaining / currentEtfPrice;

      if (sharesIfTaxFree <= totalTaxFreeShares) {
        sharesNeeded = sharesIfTaxFree;
      } else {
        const netFromTaxFree = totalTaxFreeShares * currentEtfPrice;
        const stillNeeded = remaining - netFromTaxFree;
        const taxPerShareFull = taxableGainPerShare * taxRate;
        const netPerShareTaxed = currentEtfPrice - taxPerShareFull;
        if (netPerShareTaxed <= 0) break;
        const additionalShares = stillNeeded / netPerShareTaxed;
        sharesNeeded = totalTaxFreeShares + additionalShares;
      }
    } else {
      // Verlust oder Break-Even: Keine Steuer, Verlust erhöht Verlusttopf
      sharesNeeded = remaining / currentEtfPrice;
    }

    const sharesToSell = Math.min(sharesNeeded, lot.amount);
    grossProceeds += sharesToSell * currentEtfPrice;
    
    // Brutto-Gewinn/Verlust des Lots
    const bruttoGainLoss = sharesToSell * gainPerShare;
    // Steuerpflichtiger Betrag nach Teilfreistellung
    const taxableGainLoss = bruttoGainLoss * teilfreistellung;
    taxableGainTotal += taxableGainLoss;
    
    let partTax = 0;
    
    if (taxableGainLoss > 0) {
      // GEWINN: Reihenfolge Verlusttopf → Sparerpauschbetrag → Steuer (banknah)
      // 1. Verlusttopf nutzen
      const usedLossPot = Math.min(taxableGainLoss, lossPot);
      lossPot -= usedLossPot;
      const afterLossPot = taxableGainLoss - usedLossPot;
      
      // 2. Sparerpauschbetrag nutzen
      const currentRemainingFreibetrag = Math.max(0, sparerpauschbetrag - freibetragUsed);
      const usedFreibetrag = Math.min(afterLossPot, currentRemainingFreibetrag);
      freibetragUsed += usedFreibetrag;
      
      // 3. Rest versteuern
      const taxableAfterAll = afterLossPot - usedFreibetrag;
      partTax = taxableAfterAll * taxRate;
    } else if (taxableGainLoss < 0) {
      // VERLUST: Erhöht den ETF-Verlusttopf (bereits nach Teilfreistellung, d.h. 70% des Verlustes)
      lossPot += Math.abs(taxableGainLoss);
    }
    // Bei 0: Keine Aktion
    
    const partNet = sharesToSell * currentEtfPrice - partTax;
    remaining -= partNet;
    taxPaid += partTax;

    if (sharesNeeded >= lot.amount) {
      // FIFO: Erstes Element entfernen, LIFO: Letztes Element entfernen
      if (useFifo) {
        etfLots.shift();
      } else {
        etfLots.pop();
      }
    } else {
      lot.amount -= sharesToSell;
    }
  }
  
  return { 
    remaining, 
    taxPaid, 
    yearlyUsedFreibetrag: freibetragUsed, 
    lossPot,
    grossProceeds,
    taxableGainTotal 
  };
}

/**
 * Verkauft ETF-Anteile für einen BRUTTO-Betrag (vor Steuern).
 * Der Nutzer erhält den Brutto-Betrag abzüglich Steuern als Netto.
 * @param {number} grossAmount - Gewünschter Brutto-Verkaufserlös
 * @param {Array} etfLots - Array von Lots {amount, price, monthIdx}
 * @param {number} currentEtfPrice - Aktueller ETF-Preis
 * @param {number} yearlyUsedFreibetrag - Bereits genutzter Freibetrag im Jahr
 * @param {number} sparerpauschbetrag - Jährlicher Sparerpauschbetrag
 * @param {number} taxRate - Effektiver Steuersatz
 * @param {number} lossPot - Allgemeiner Verlusttopf
 * @param {boolean} useFifo - true = FIFO, false = LIFO
 * @param {number} teilfreistellung - Steuerpflichtiger Anteil (0.7 Aktien, 0.85 Misch, 1.0 Renten)
 * @returns {Object} { netProceeds, taxPaid, yearlyUsedFreibetrag, lossPot, shortfall }
 */
function sellEtfGross(grossAmount, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate, lossPotStart = 0, useFifo = true, teilfreistellung = 0.7) {
  let taxPaid = 0;
  let freibetragUsed = yearlyUsedFreibetrag;
  let lossPot = lossPotStart;
  let grossRemaining = grossAmount;
  let netProceeds = 0;
  
  while (grossRemaining > 0.01 && etfLots.length) {
    const lotIndex = useFifo ? 0 : etfLots.length - 1;
    const lot = etfLots[lotIndex];
    const gainPerShare = currentEtfPrice - lot.price;
    
    // Berechne wie viele Shares wir für den Brutto-Betrag verkaufen müssen
    const sharesNeeded = grossRemaining / currentEtfPrice;
    const sharesToSell = Math.min(sharesNeeded, lot.amount);
    const grossFromSale = sharesToSell * currentEtfPrice;
    
    // Gewinn/Verlust berechnen
    const bruttoGainLoss = sharesToSell * gainPerShare;
    const taxableGainLoss = bruttoGainLoss * teilfreistellung;
    
    let partTax = 0;
    
    if (taxableGainLoss > 0) {
      // GEWINN: Reihenfolge Verlusttopf → Sparerpauschbetrag → Steuer
      const usedLossPot = Math.min(taxableGainLoss, lossPot);
      lossPot -= usedLossPot;
      const afterLossPot = taxableGainLoss - usedLossPot;
      
      const remainingFreibetrag = Math.max(0, sparerpauschbetrag - freibetragUsed);
      const usedFreibetrag = Math.min(afterLossPot, remainingFreibetrag);
      freibetragUsed += usedFreibetrag;
      
      const taxableAfterAll = afterLossPot - usedFreibetrag;
      partTax = taxableAfterAll * taxRate;
    } else if (taxableGainLoss < 0) {
      // VERLUST: Erhöht den Verlusttopf
      lossPot += Math.abs(taxableGainLoss);
    }
    
    // Netto = Brutto - Steuer
    const partNet = grossFromSale - partTax;
    netProceeds += partNet;
    taxPaid += partTax;
    grossRemaining -= grossFromSale;
    
    if (sharesNeeded >= lot.amount) {
      if (useFifo) {
        etfLots.shift();
      } else {
        etfLots.pop();
      }
    } else {
      lot.amount -= sharesToSell;
    }
  }
  
  const shortfall = grossRemaining > 0.01 ? grossRemaining : 0;
  
  return { 
    netProceeds, 
    taxPaid, 
    yearlyUsedFreibetrag: freibetragUsed, 
    lossPot,
    shortfall
  };
}

/**
 * Deckt Steuerzahlungen ab: zuerst TG, danach ETF-Verkauf inkl. Steuer auf realisierte Gewinne.
 * Liefert bezahlte Steuer (Original + Verkaufssteuer), aktualisiertes TG, Freibetrag, Verlusttopf sowie Shortfall.
 * 
 * @param {number} taxAmount - Zu zahlende Steuer
 * @param {number} savings - Tagesgeld-Guthaben
 * @param {Array} etfLots - ETF-Lots
 * @param {number} currentEtfPrice - Aktueller ETF-Preis
 * @param {number} yearlyUsedFreibetrag - Genutzter Freibetrag im Jahr
 * @param {number} sparerpauschbetrag - Jährlicher Sparerpauschbetrag
 * @param {number} taxRate - Steuersatz
 * @param {number} lossPot - Allgemeiner Verlusttopf
 * @param {boolean} useFifo - FIFO oder LIFO
 * @param {number} teilfreistellung - Steuerpflichtiger Anteil (0.7 Aktien, 0.85 Misch, 1.0 Renten)
 */
function coverTaxWithSavingsAndEtf(taxAmount, savings, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate, lossPotStart = 0, useFifo = true, teilfreistellung = 0.7) {
  if (taxAmount <= 0) {
    return {
      savings,
      yearlyUsedFreibetrag,
      lossPot: lossPotStart,
      taxPaidOriginal: 0,
      saleTax: 0,
      totalTaxRecorded: 0,
      shortfall: 0,
    };
  }

  let remainingTax = taxAmount;
  let lossPot = lossPotStart;

  const useCash = Math.min(savings, remainingTax);
  savings -= useCash;
  remainingTax -= useCash;

  let saleTax = 0;
  if (remainingTax > 0.01 && etfLots.length) {
    const sellResult = sellEtfOptimized(remainingTax, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate, lossPot, useFifo, teilfreistellung);
    remainingTax = sellResult.remaining;
    saleTax = sellResult.taxPaid;
    yearlyUsedFreibetrag = sellResult.yearlyUsedFreibetrag;
    lossPot = sellResult.lossPot;
  }

  remainingTax = Math.max(0, remainingTax);
  const taxPaidOriginal = taxAmount - remainingTax;
  const shortfall = remainingTax > 0.01 ? remainingTax : 0;
  const totalTaxRecorded = taxPaidOriginal + saleTax;

  return {
    savings,
    yearlyUsedFreibetrag,
    lossPot,
    taxPaidOriginal,
    saleTax,
    totalTaxRecorded,
    shortfall,
  };
}

/**
 * Unified simulation function for both standard and Monte-Carlo simulations.
 * @param {Object} params - Simulation parameters
 * @param {number} volatility - Annual volatility for stochastic simulation (0 = deterministic)
 * @returns {Array} History array with monthly data points
 */
function simulate(params, volatility = 0) {
  const {
    start_savings,
    start_etf,
    start_etf_cost_basis = 0,
    monthly_savings,
    monthly_etf,
    savings_rate_pa,
    etf_rate_pa,
    etf_ter_pa = 0,
    savings_target,
    annual_raise_percent,
    savings_years,
    withdrawal_years,
    monthly_payout_net,
    monthly_payout_percent,
    withdrawal_min = 0,
    withdrawal_max = 0,
    inflation_adjust_withdrawal = true,
    special_payout_net_savings,
    special_interval_years_savings,
    inflation_adjust_special_savings = true,
    special_payout_net_withdrawal,
    special_interval_years_withdrawal,
    inflation_adjust_special_withdrawal = true,
    inflation_rate_pa = 0,
    sparerpauschbetrag = SPARERPAUSCHBETRAG_SINGLE,
    kirchensteuer = "keine",
    basiszins = 2.53,
    use_lifo = false,
    rent_is_gross = false,
    capital_preservation_enabled = false,
    capital_preservation_threshold = 80,
    capital_preservation_reduction = 25,
    capital_preservation_recovery = 10,
    loss_pot: initialLossPot = 0,
    fondstyp = "aktien",
  } = params;
  
  // Stochastic mode: volatility > 0 aktiviert Monte-Carlo-Modus
  const isStochastic = volatility > 0;
  const monthlyVolatility = isStochastic ? toMonthlyVolatility(volatility / 100) : 0;

  // Teilfreistellung basierend auf Fondstyp (§ 20 InvStG)
  const teilfreistellung = TEILFREISTELLUNG_MAP[fondstyp] || TEILFREISTELLUNG_MAP.aktien;

  // Steuersatz berechnen (inkl. Kirchensteuer falls gewählt)
  let kirchensteuerSatz = 0;
  if (kirchensteuer === "8") kirchensteuerSatz = KIRCHENSTEUER_SATZ_8;
  else if (kirchensteuer === "9") kirchensteuerSatz = KIRCHENSTEUER_SATZ_9;
  const taxRate = calculateTaxRate(kirchensteuerSatz);

  const history = [];
  let savings = start_savings;
  let currentEtfPrice = INITIAL_ETF_PRICE;
  const etfLots = [];
  if (start_etf > 0) {
    const shares = start_etf / currentEtfPrice;
    // Berechne Einstandspreis: wenn cost_basis angegeben und > 0, nutze diesen
    // sonst Einstand = aktueller Wert (kein unrealisierter Gewinn)
    const effectiveCostBasis = start_etf_cost_basis > 0 ? start_etf_cost_basis : start_etf;
    const costPricePerShare = effectiveCostBasis / shares;
    etfLots.push({ amount: shares, price: costPricePerShare, monthIdx: 0 });
  }

  // ETF-Rendite nach Abzug der TER
  const effectiveEtfRate = etf_rate_pa - etf_ter_pa;
  
  const monthlySavingsRate = toMonthlyRate(savings_rate_pa);
  const monthlyEtfRate = toMonthlyRate(effectiveEtfRate);
  const monthlyInflationRate = toMonthlyRate(inflation_rate_pa);
  const annualRaise = annual_raise_percent / 100;
  const totalMonths = (savings_years + withdrawal_years) * MONTHS_PER_YEAR;

  let savingsFull = savings >= savings_target;
  let yearlyUsedFreibetrag = 0;
  let currentTaxYear = 0;
  let payoutFromPercentDone = false;
  let payoutValue = monthly_payout_net;
  let payoutPercentPa = monthly_payout_percent;
  let entnahmeStartTotal = null;
  let basePayoutValue = null; // Basis-Entnahme für Inflationsanpassung

  let cumulativeInflation = 1;
  
  // Kapitalerhalt-Modus Tracking
  let capitalPreservationActive = false;
  let capitalPreservationMonths = 0;
  
  // Vorabpauschale-Tracking: ETF-Wert und Preis am Jahresanfang
  let etfValueYearStart = start_etf;
  let etfPriceAtYearStart = currentEtfPrice;
  let vorabpauschaleTaxYearly = 0;
  
  // Allgemeiner Verlusttopf: Fortlaufend, kein Reset am Jahreswechsel
  // Für ETF-Verkaufsgewinne/-verluste (nach Teilfreistellung), Zinsen und Vorabpauschale
  // Nach deutschem Steuerrecht gehören ETFs in den allgemeinen Topf (nicht Aktien-Topf,
  // der nur für Einzelaktien gilt).
  let lossPot = initialLossPot;
  
  // JAHRESWEISE STEUERLOGIK: Tracking-Variablen
  // TG-Zinsen: Brutto ansammeln, am Jahresende versteuern
  let yearlyAccumulatedInterestGross = 0;
  // Vorabpauschale: Im Dezember berechnen, im Januar des Folgejahres einziehen
  // Nutzt Freibetrag des NEUEN Jahres (daher separate Speicherung)
  let pendingVorabpauschaleTax = 0;           // Berechnete Steuer, fällig im Januar
  let pendingVorabpauschaleAmount = 0;        // Steuerpflichtiger Betrag für Freibetrag-Berechnung

  for (let monthIdx = 1; monthIdx <= totalMonths; monthIdx += 1) {
    const isSavingsPhase = monthIdx <= savings_years * MONTHS_PER_YEAR;
    const yearIdx = Math.floor((monthIdx - 1) / MONTHS_PER_YEAR);
    const monthInYear = ((monthIdx - 1) % MONTHS_PER_YEAR) + 1; // 1-12
    let vorabpauschaleTaxPaidThisMonth = 0;
    let taxPaidThisMonth = 0;
    let taxShortfall = 0;
    
    // Inflation kumulieren
    cumulativeInflation *= (1 + monthlyInflationRate);
    const totalEtfSharesStart = etfLots.reduce((acc, l) => acc + l.amount, 0);
    const totalEtfValueStart = totalEtfSharesStart * currentEtfPrice;
    const totalPortfolioStart = savings + totalEtfValueStart; // Für Portfolio-Rendite (SoRR)

    // ============ JAHRESWECHSEL-LOGIK ============
    // Am Jahresanfang (Januar): Vorabpauschale des Vorjahres einziehen
    // Diese nutzt den Freibetrag des NEUEN Jahres
    if (yearIdx !== currentTaxYear) {
      yearlyUsedFreibetrag = 0; // Neues Jahr, Freibetrag zurücksetzen
      vorabpauschaleTaxYearly = 0;
      // ZUERST: Vorabpauschale des Vorjahres einziehen (falls vorhanden)
      // Reihenfolge: Verlusttopf → Sparerpauschbetrag → Rest versteuern
      if (pendingVorabpauschaleAmount > 0) {
        // 1. Verlusttopf nutzen
        const usedLossPot = Math.min(pendingVorabpauschaleAmount, lossPot);
        lossPot -= usedLossPot;
        const afterLossPot = pendingVorabpauschaleAmount - usedLossPot;
        
        // 2. Sparerpauschbetrag nutzen (neues Jahr, noch voll verfügbar)
        const remainingFreibetrag = sparerpauschbetrag;
        const usedFreibetrag = Math.min(afterLossPot, remainingFreibetrag);
        yearlyUsedFreibetrag = usedFreibetrag;
        
        // 3. Rest versteuern
        const taxableAfterAll = Math.max(0, afterLossPot - usedFreibetrag);
        const dueTax = taxableAfterAll * taxRate;

        const coverResult = coverTaxWithSavingsAndEtf(
          dueTax,
          savings,
          etfLots,
          currentEtfPrice,
          yearlyUsedFreibetrag,
          sparerpauschbetrag,
          taxRate,
          lossPot,
          !use_lifo,
          teilfreistellung
        );
        savings = coverResult.savings;
        yearlyUsedFreibetrag = coverResult.yearlyUsedFreibetrag;
        lossPot = coverResult.lossPot;
        vorabpauschaleTaxPaidThisMonth = coverResult.taxPaidOriginal;
        vorabpauschaleTaxYearly = coverResult.taxPaidOriginal;
        taxPaidThisMonth += coverResult.totalTaxRecorded;
        taxShortfall += coverResult.shortfall;
      } else {
        yearlyUsedFreibetrag = 0;
        vorabpauschaleTaxYearly = 0;
      }
      
      // Dann: Jahreswechsel-Variablen zurücksetzen
      currentTaxYear = yearIdx;
      etfValueYearStart = totalEtfValueStart;
      etfPriceAtYearStart = currentEtfPrice;
      yearlyAccumulatedInterestGross = 0;
      pendingVorabpauschaleTax = 0;
      pendingVorabpauschaleAmount = 0;
    }

    // Wertentwicklung vor Cashflows
    // Bei stochastischer Simulation: GBM (Geometric Brownian Motion)
    // Bei deterministischer Simulation: feste monatliche Rendite
    let monthlyEtfReturn;
    if (isStochastic) {
      // GBM: S_t+1 = S_t * exp((μ - σ²/2) + σ*Z)
      const continuousMonthlyRate = Math.log(1 + monthlyEtfRate);
      const drift = continuousMonthlyRate - 0.5 * monthlyVolatility * monthlyVolatility;
      const z = randomNormal(0, 1);
      monthlyEtfReturn = Math.exp(drift + monthlyVolatility * z);
      currentEtfPrice *= monthlyEtfReturn;
    } else {
      monthlyEtfReturn = 1 + monthlyEtfRate;
      currentEtfPrice *= monthlyEtfReturn;
    }
    const etfGrowth = totalEtfValueStart * (monthlyEtfReturn - 1);

    const savingsInterest = savings * monthlySavingsRate;
    
    // JAHRESWEISE STEUERLOGIK: TG-Zinsen brutto ansammeln
    // Besteuerung erfolgt am Jahresende (Dezember), nicht monatlich
    let savingsInterestTax = 0;
    yearlyAccumulatedInterestGross += savingsInterest;
    savings += savingsInterest; // Zinsen brutto gutschreiben

    let savings_contrib = 0;
    let etf_contrib = 0;
    let overflow = 0;
    let withdrawal = 0;
    let tax_paid = taxPaidThisMonth; // Startet mit evtl. Vorabpauschale vom Januar (inkl. Verkaufssteuer)
    let withdrawal_paid = 0;
    let withdrawal_net = 0;
    let monthlyPayout = 0; // Reguläre monatliche Entnahme (ohne Sonderausgaben)
    let capitalPreservationActiveThisMonth = false;
    let netWithdrawalThisMonth = 0;

    // ANSPARPHASE
    if (isSavingsPhase) {
      const raiseFactor = Math.pow(1 + annualRaise, yearIdx);
      const currMonthlySav = monthly_savings * raiseFactor;
      const currMonthlyEtf = monthly_etf * raiseFactor;

      if (savingsFull) {
        etf_contrib = currMonthlyEtf + currMonthlySav;
      } else {
        savings += currMonthlySav;
        savings_contrib = currMonthlySav;
        etf_contrib = currMonthlyEtf;
      }

      if (savings > savings_target) {
        overflow = savings - savings_target;
        savings = savings_target;
        etf_contrib += overflow;
        savingsFull = true;
      }

      if (etf_contrib > 0) {
        const newShares = etf_contrib / currentEtfPrice;
        etfLots.push({ amount: newShares, price: currentEtfPrice, monthIdx });
      }

      // Sonderausgaben Ansparphase
      const inSpecial = special_interval_years_savings > 0
        && monthIdx % (special_interval_years_savings * MONTHS_PER_YEAR) === 0
        && monthIdx > 0;

      if (inSpecial) {
        // Inflationsanpassung der Sonderausgabe
        // Verwende tatsächlich verstrichene Jahre (monthIdx/12) statt nullbasiertem yearIdx
        let specialAmount = special_payout_net_savings;
        if (inflation_adjust_special_savings) {
          const yearsElapsed = monthIdx / MONTHS_PER_YEAR;
          specialAmount = special_payout_net_savings * Math.pow(1 + inflation_rate_pa / 100, yearsElapsed);
        }
        let remaining = specialAmount;
        withdrawal = remaining;

        const extraCash = Math.max(0, savings - savings_target);
        if (extraCash > 0) {
          const use = Math.min(extraCash, remaining);
          savings -= use;
          remaining -= use;
        }

        // ETF verkaufen (steueroptimiert) - extrahierte Funktion
        const sellResult = sellEtfOptimized(remaining, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate, lossPot, !use_lifo, teilfreistellung);
        remaining = sellResult.remaining;
        tax_paid += sellResult.taxPaid;
        yearlyUsedFreibetrag = sellResult.yearlyUsedFreibetrag;
        lossPot = sellResult.lossPot;

        // TG unter Ziel
        if (remaining > 0.01) {
          const draw = Math.min(savings, remaining);
          savings -= draw;
          remaining -= draw;
          if (savings < savings_target) savingsFull = false;
        }

        if (remaining < 0) {
          savings += Math.abs(remaining);
          remaining = 0;
        }

        withdrawal_paid = withdrawal - Math.max(0, remaining);
      }
    }

    // ENTNAHMEPHASE
    else {
      if (entnahmeStartTotal === null) {
        const totalEtfShares = etfLots.reduce((acc, l) => acc + l.amount, 0);
        entnahmeStartTotal = savings + totalEtfShares * currentEtfPrice;
        if (monthly_payout_percent != null && !payoutFromPercentDone) {
          payoutValue = entnahmeStartTotal * (monthly_payout_percent / 100) / 12;
          basePayoutValue = payoutValue;
          payoutFromPercentDone = true;
          payoutPercentPa = monthly_payout_percent;
        } else if (payoutValue != null) {
          basePayoutValue = payoutValue;
          payoutPercentPa = entnahmeStartTotal > 0 ? (payoutValue * 12 / entnahmeStartTotal * 100) : 0;
        }
      }

      // Inflationsanpassung der Entnahme (für beide Modi: EUR und Prozent)
      // Die 4%-Regel: X% vom Startvermögen, dann jährlich um Inflation erhöhen
      let currentPayout = payoutValue || 0;
      if (inflation_adjust_withdrawal && basePayoutValue != null) {
        // Entnahme jährlich um Inflation erhöhen (gilt für EUR UND Prozent-Modus)
        const withdrawalYearIdx = yearIdx - savings_years;
        currentPayout = basePayoutValue * Math.pow(1 + inflation_rate_pa / 100, withdrawalYearIdx);
      }

      // Min/Max Grenzen anwenden
      if (withdrawal_min > 0 && currentPayout < withdrawal_min) {
        currentPayout = withdrawal_min;
      }
      if (withdrawal_max > 0 && currentPayout > withdrawal_max) {
        currentPayout = withdrawal_max;
      }

      // Kapitalerhalt-Modus: Entnahme reduzieren wenn Vermögen unter Schwelle fällt
      if (capital_preservation_enabled && entnahmeStartTotal > 0) {
        const totalEtfSharesNow = etfLots.reduce((acc, l) => acc + l.amount, 0);
        const currentTotal = savings + totalEtfSharesNow * currentEtfPrice;
        const thresholdValue = entnahmeStartTotal * (capital_preservation_threshold / 100);
        const recoveryValue = entnahmeStartTotal * ((capital_preservation_threshold + capital_preservation_recovery) / 100);
        
        // Hysterese: Aktivieren bei Unterschreitung, Deaktivieren erst bei Erholung über recoveryValue
        if (currentTotal < thresholdValue) {
          capitalPreservationActive = true;
        } else if (currentTotal >= recoveryValue) {
          capitalPreservationActive = false;
        }
        // Sonst: Zustand beibehalten (Hysterese)
        
        if (capitalPreservationActive) {
          // Entnahme um den Reduktionsprozentsatz verringern
          currentPayout = currentPayout * (1 - capital_preservation_reduction / 100);
          capitalPreservationActiveThisMonth = true;
          capitalPreservationMonths++;
        }
      }

      const requestedMonthlyPayout = currentPayout; // Gewünschte reguläre monatliche Entnahme
      let specialExpenseThisMonth = 0;
      let needed_net = currentPayout;
      if (special_interval_years_withdrawal > 0
        && monthIdx % (special_interval_years_withdrawal * MONTHS_PER_YEAR) === 0) {
        // Inflationsanpassung der Sonderausgabe
        // Verwende tatsächlich verstrichene Jahre (monthIdx/12) statt nullbasiertem yearIdx
        specialExpenseThisMonth = special_payout_net_withdrawal;
        if (inflation_adjust_special_withdrawal) {
          const yearsElapsed = monthIdx / MONTHS_PER_YEAR;
          specialExpenseThisMonth = special_payout_net_withdrawal * Math.pow(1 + inflation_rate_pa / 100, yearsElapsed);
        }
        needed_net += specialExpenseThisMonth;
      }

      if (needed_net > 0) {
        let remaining = needed_net;
        withdrawal = needed_net;

        const extraCash = Math.max(0, savings - savings_target);
        if (extraCash > 0) {
          const use = Math.min(extraCash, remaining);
          savings -= use;
          remaining -= use;
          // Netto-Entnahme aus TG (steuerfrei)
          if (rent_is_gross) {
            netWithdrawalThisMonth += use;
          }
        }

        // ETF verkaufen - je nach Modus unterschiedliche Logik
        if (rent_is_gross && remaining > 0) {
          // BRUTTO-MODUS: Verkaufe ETF für Brutto-Betrag, Steuern werden abgezogen
          // Nutzer erhält: Brutto - Steuer = Netto
          // WICHTIG: Für Shortfall-Analyse zählt nur echter Shortfall (nicht genug Assets),
          // NICHT die Steuerdifferenz zwischen Brutto und Netto!
          const sellResult = sellEtfGross(remaining, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate, lossPot, !use_lifo, teilfreistellung);
          const netReceived = sellResult.netProceeds;
          tax_paid += sellResult.taxPaid;
          yearlyUsedFreibetrag = sellResult.yearlyUsedFreibetrag;
          lossPot = sellResult.lossPot;
          // remaining = echter Shortfall (konnte nicht genug ETF verkaufen)
          remaining = sellResult.shortfall;
          // Bei Brutto-Modus: withdrawal_paid = BRUTTO (was wir verkauft haben), nicht Netto!
          // Damit wird die Shortfall-Analyse korrekt: shortfall nur wenn remaining > 0
          withdrawal_paid = withdrawal - remaining;
          // Speichere Netto separat für Statistiken (Netto-Erlös nach Steuern)
          netWithdrawalThisMonth += netReceived;
        } else if (remaining > 0) {
          // NETTO-MODUS (Standard): Verkaufe genug ETF um Netto-Betrag zu erhalten
          const sellResult = sellEtfOptimized(remaining, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate, lossPot, !use_lifo, teilfreistellung);
          remaining = sellResult.remaining;
          tax_paid += sellResult.taxPaid;
          yearlyUsedFreibetrag = sellResult.yearlyUsedFreibetrag;
          lossPot = sellResult.lossPot;
        }

        if (remaining > 0.01) {
          const draw = Math.min(savings, remaining);
          savings -= draw;
          remaining -= draw;
          if (rent_is_gross) {
            // Zusätzliche TG-Entnahme ist vollständig netto
            netWithdrawalThisMonth += draw;
          }
        }

        if (remaining < 0) {
          savings += Math.abs(remaining);
          remaining = 0;
        }

        // Bei Netto-Modus: Standard-Berechnung
        if (!rent_is_gross) {
          withdrawal_paid = withdrawal - Math.max(0, remaining);
        }
      }
      
      // KORRIGIERT: Berechne tatsächlich gezahlte monatliche Entnahme (ohne Sonderausgaben)
      // Bei Shortfalls wird proportional gekürzt
      if (withdrawal > 0 && withdrawal_paid < withdrawal) {
        // Proportionale Kürzung: beide (regular + special) werden anteilig reduziert
        const payoutRatio = withdrawal_paid / withdrawal;
        monthlyPayout = requestedMonthlyPayout * payoutRatio;
      } else {
        monthlyPayout = requestedMonthlyPayout;
      }
    }

    // ============ JAHRESENDE-LOGIK (Dezember) ============
    // 1. TG-Zinsen des Jahres besteuern (Allg. Topf → Freibetrag des AKTUELLEN Jahres)
    // 2. Vorabpauschale berechnen, aber erst im Januar des Folgejahres einziehen
    let totalVorabpauschale = 0;
    if (monthInYear === 12) {
      // SCHRITT 1: Jährliche TG-Zinsen besteuern
      // Reihenfolge: Verlusttopf → Sparerpauschbetrag → Rest versteuern (banknah)
      if (yearlyAccumulatedInterestGross > 0) {
        // 1. Verlusttopf nutzen (zuerst)
        const usedLossPot = Math.min(yearlyAccumulatedInterestGross, lossPot);
        lossPot -= usedLossPot;
        const afterLossPot = yearlyAccumulatedInterestGross - usedLossPot;
        
        // 2. Sparerpauschbetrag nutzen (danach)
        const remainingFreibetrag = Math.max(0, sparerpauschbetrag - yearlyUsedFreibetrag);
        const usedFreibetrag = Math.min(afterLossPot, remainingFreibetrag);
        yearlyUsedFreibetrag += usedFreibetrag;
        
        // 3. Rest versteuern
        const taxableAfterAll = Math.max(0, afterLossPot - usedFreibetrag);
        savingsInterestTax = taxableAfterAll * taxRate;

        if (savingsInterestTax > 0.01) {
          const coverResult = coverTaxWithSavingsAndEtf(
            savingsInterestTax,
            savings,
            etfLots,
            currentEtfPrice,
            yearlyUsedFreibetrag,
            sparerpauschbetrag,
            taxRate,
            lossPot,
            !use_lifo,
            teilfreistellung
          );
          savings = coverResult.savings;
          yearlyUsedFreibetrag = coverResult.yearlyUsedFreibetrag;
          lossPot = coverResult.lossPot;
          tax_paid += coverResult.totalTaxRecorded;
          taxShortfall += coverResult.shortfall;
        }
      }
      
      // SCHRITT 2: Vorabpauschale berechnen (falls Basiszins > 0)
      // Die Steuer wird NICHT jetzt eingezogen, sondern im Januar des Folgejahres
      if (basiszins > 0) {
        const yearStartMonth = yearIdx * MONTHS_PER_YEAR; // Monat 0, 12, 24, ...
        
        // Pro-Lot-Berechnung der Vorabpauschale
        for (const lot of etfLots) {
          if (lot.amount <= 0) continue;
          
          const boughtThisYear = lot.monthIdx > yearStartMonth;
          
          // Basisertrag-Grundlage: Wert am Jahresanfang (alte Lots) oder Kaufwert (neue Lots)
          const basisertragBase = boughtThisYear 
            ? lot.amount * lot.price  // Neue Lots: Kaufwert
            : lot.amount * etfPriceAtYearStart;  // Alte Lots: Wert am Jahresanfang
          
          // Zeitanteil: Für neue Lots nur anteilig (Kaufmonat bis Dezember) / 12
          let zeitanteil = 1;
          if (boughtThisYear) {
            const kaufMonatImJahr = ((lot.monthIdx - 1) % MONTHS_PER_YEAR) + 1;
            zeitanteil = (12 - kaufMonatImJahr + 1) / 12;
          }
          
          // Basisertrag = Grundlage × Basiszins × 0,7 × Zeitanteil
          // HINWEIS: Der Faktor 0,7 ist der gesetzliche Dämpfungsfaktor nach § 18 Abs. 1 InvStG,
          // NICHT die Teilfreistellung nach § 20 InvStG! Beide haben zufällig denselben Wert.
          const BASISERTRAG_FAKTOR = 0.7; // § 18 Abs. 1 InvStG
          const lotBasisertrag = basisertragBase * (basiszins / 100) * BASISERTRAG_FAKTOR * zeitanteil;
          
          // Wertzuwachs pro Lot (unabhängig von Verkäufen anderer Lots)
          const lotValueYearEnd = lot.amount * currentEtfPrice;
          const lotValueStart = boughtThisYear 
            ? lot.amount * lot.price  // Neue Lots: Kaufwert
            : lot.amount * etfPriceAtYearStart;  // Alte Lots: Wert am Jahresanfang
          const lotActualGain = Math.max(0, lotValueYearEnd - lotValueStart);
          
          // Vorabpauschale = min(Basisertrag, Wertzuwachs)
          const lotVorabpauschale = Math.min(lotBasisertrag, lotActualGain);
          
          if (lotVorabpauschale > 0) {
            totalVorabpauschale += lotVorabpauschale;
            // Cost-Basis erhöhen (verhindert Doppelbesteuerung bei späterem Verkauf)
            lot.price += lotVorabpauschale / lot.amount;
          }
        }
        
        if (totalVorabpauschale > 0) {
          // Teilfreistellung nach § 20 InvStG: Steuerpflichtiger Anteil je nach Fondstyp
          // Aktienfonds: 70%, Mischfonds: 85%, Rentenfonds: 100%
          const taxableVorabpauschale = totalVorabpauschale * teilfreistellung;
          
          // WICHTIG: Steuer wird NICHT jetzt eingezogen!
          // Stattdessen für Januar des Folgejahres vormerken
          // Dort wird der Freibetrag des NEUEN Jahres genutzt
          pendingVorabpauschaleAmount = taxableVorabpauschale;
        }
      }
    }
    // Hinweis: Vorabpauschale-Steuer wird im Januar des Folgejahres gezahlt (siehe Jahreswechsel-Logik)
    
    // Lot-Konsolidierung am Jahresende für Performance (alle 12 Monate)
    if (monthInYear === 12 && etfLots.length > 50) {
      const consolidated = consolidateLots(etfLots);
      etfLots.length = 0;
      etfLots.push(...consolidated);
    }

    // Gesamtwerte
    const totalEtfShares = etfLots.reduce((acc, l) => acc + l.amount, 0);
    const etf_value = totalEtfShares * currentEtfPrice;
    const total = savings + etf_value;

    // Aktuelle Entnahme für diesen Monat (nach Limits)
    const effectivePayout = isSavingsPhase ? null : (withdrawal > 0 ? withdrawal : null);
    
    // Shortfall = angeforderte Entnahme konnte nicht vollständig bedient werden (nur für MC relevant)
    const shortfall = withdrawal > 0 ? Math.max(0, withdrawal - withdrawal_paid) : 0;
    
    // Netto-Entnahme für Statistiken (unabhängig von Shortfall-Definition)
    if (!isSavingsPhase && withdrawal > 0) {
      if (rent_is_gross) {
        // Im Brutto-Modus ist withdrawal_paid BRUTTO, netWithdrawalThisMonth ist Netto
        withdrawal_net = netWithdrawalThisMonth;
      } else {
        // Im Netto-Modus entspricht withdrawal_paid bereits der Netto-Entnahme
        withdrawal_net = withdrawal_paid;
      }
    } else {
      withdrawal_net = 0;
    }
    
    // Portfolio-Gesamtrendite (gewichtet nach ETF/Cash-Anteil am Periodenstart)
    const savingsReturnFactor = 1 + monthlySavingsRate;
    let portfolioReturn = monthlyEtfReturn;
    if (totalPortfolioStart > 0) {
      const etfWeight = totalEtfValueStart / totalPortfolioStart;
      const cashWeight = 1 - etfWeight;
      portfolioReturn = etfWeight * monthlyEtfReturn + cashWeight * savingsReturnFactor;
    }
    
    history.push({
      month: monthIdx,
      year: yearIdx + 1,
      phase: isSavingsPhase ? "Anspar" : "Entnahme",
      savings,
      etf: etf_value,
      total,
      total_real: total / cumulativeInflation,
      savings_contrib,
      etf_contrib,
      savings_interest: savingsInterest,
      withdrawal: withdrawal_paid,
      withdrawal_real: withdrawal_paid / cumulativeInflation,
      withdrawal_net,
      withdrawal_net_real: withdrawal_net / cumulativeInflation,
      withdrawal_requested: withdrawal, // Für Shortfall-Analyse (MC)
      shortfall, // Differenz zwischen angefordert und tatsächlich ausgezahlt (MC)
      tax_shortfall: taxShortfall, // Steuer konnte nicht vollständig bezahlt werden
      monthly_payout: monthlyPayout, // Nur reguläre monatliche Entnahme (ohne Sonderausgaben)
      monthly_payout_real: monthlyPayout / cumulativeInflation,
      tax_paid,
      vorabpauschale_tax: vorabpauschaleTaxPaidThisMonth, // Gezahlte Vorabpauschale-Steuer (im Januar)
      payout_value: effectivePayout,
      payout_percent_pa: isSavingsPhase ? null : payoutPercentPa,
      return_gain: etfGrowth + savingsInterest,
      etfReturn: monthlyEtfReturn, // Nur ETF-Rendite (für MC)
      portfolioReturn, // Portfolio-Gesamtrendite inkl. Cash (für SoRR-Analyse)
      cumulative_inflation: cumulativeInflation,
      capital_preservation_active: capitalPreservationActiveThisMonth || false,
      yearly_used_freibetrag: yearlyUsedFreibetrag, // Im laufenden Steuerjahr genutzter Freibetrag
      loss_pot: lossPot, // Allgemeiner Verlusttopf am Monatsende
    });
  }

  // ============ NACHBEARBEITUNG: Pending Vorabpauschale des letzten Jahres ============
  // Falls die Simulation im Dezember endet, ist noch eine Vorabpauschale vorgemerkt,
  // die im Januar des Folgejahres fällig wäre. Diese muss noch berücksichtigt werden.
  if (pendingVorabpauschaleAmount > 0 && history.length > 0) {
    // Reihenfolge: Verlusttopf → Sparerpauschbetrag → Rest versteuern
    // 1. Verlusttopf nutzen
    const usedLossPot = Math.min(pendingVorabpauschaleAmount, lossPot);
    lossPot -= usedLossPot;
    const afterLossPot = pendingVorabpauschaleAmount - usedLossPot;
    
    // 2. Sparerpauschbetrag nutzen (neues Jahr, voll verfügbar)
    const finalRemainingFreibetrag = sparerpauschbetrag;
    const usedFreibetrag = Math.min(afterLossPot, finalRemainingFreibetrag);
    
    // 3. Rest versteuern
    const finalTaxableAfterAll = Math.max(0, afterLossPot - usedFreibetrag);
    const finalVorabpauschaleTax = finalTaxableAfterAll * taxRate;
    
    const coverResult = coverTaxWithSavingsAndEtf(
      finalVorabpauschaleTax,
      savings,
      etfLots,
      currentEtfPrice,
      usedFreibetrag, // Freibetrag wurde durch VAP teilweise verbraucht
      sparerpauschbetrag,
      taxRate,
      lossPot,
      !use_lifo,
      teilfreistellung
    );
    savings = coverResult.savings;
    lossPot = coverResult.lossPot;
    const totalEtfShares = etfLots.reduce((acc, l) => acc + l.amount, 0);
    const updatedEtfValue = totalEtfShares * currentEtfPrice;
    
    // Letzten History-Eintrag aktualisieren (als "fällig im Folgejahr" markiert)
    const lastEntry = history[history.length - 1];
    lastEntry.savings = savings;
    lastEntry.etf = updatedEtfValue; // ETF-Bestand wurde evtl. verkauft
    lastEntry.total = lastEntry.savings + lastEntry.etf;
    lastEntry.total_real = lastEntry.total / lastEntry.cumulative_inflation;
    lastEntry.tax_paid += coverResult.totalTaxRecorded;
    // Vorabpauschale-Steuer auch in vorabpauschale_tax addieren (für UI-Summe/CSV)
    lastEntry.vorabpauschale_tax = (lastEntry.vorabpauschale_tax || 0) + coverResult.taxPaidOriginal;
    // Speichere die pending Vorabpauschale-Steuer als Meta-Info
    lastEntry.pending_vorabpauschale_tax = coverResult.taxPaidOriginal;
    lastEntry.loss_pot = lossPot;
    if (coverResult.shortfall > 0.01) {
      lastEntry.tax_shortfall = (lastEntry.tax_shortfall || 0) + coverResult.shortfall;
    }
    
    // Auch savings-Variable aktualisieren (für konsistente Rückgabe)
    if (savings < 0) savings = 0;
  }

  // Kapitalerhalt-Statistiken am Ende anhängen (als Meta-Info)
  if (history.length > 0) {
    history.capitalPreservationMonths = capitalPreservationMonths;
    history.capitalPreservationEnabled = capital_preservation_enabled;
  }

  return history;
}

function formatCurrency(val) {
  return nf0.format(Math.round(val)).replace(/\u00a0/, " ") + " €";
}

function formatForInput(val) {
  return Number.isFinite(val) ? val.toFixed(2) : "";
}

function renderTable(history) {
  tableBody.innerHTML = "";
  if (!history.length) return;

  let currentYear = history[0].year;
  let yearWithdrawal = 0;
  let yearTax = 0;
  let yearReturn = 0;
  let lastRow = null;

  const flush = () => {
    if (!lastRow) return;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${currentYear}</td>
      <td>${lastRow.phase}</td>
      <td>${formatCurrency(lastRow.savings)}</td>
      <td>${formatCurrency(lastRow.etf)}</td>
      <td>${formatCurrency(lastRow.total)}</td>
      <td>${formatCurrency(lastRow.total_real || lastRow.total)}</td>
      <td>${formatCurrency(yearReturn)}</td>
      <td>${formatCurrency(yearWithdrawal)}</td>
      <td>${formatCurrency(yearTax)}</td>
      <td>${formatCurrency(lastRow.yearly_used_freibetrag || 0)}</td>
      <td>${formatCurrency(lastRow.loss_pot || 0)}</td>
    `;
    tableBody.appendChild(tr);
  };

  for (const row of history) {
    if (row.year !== currentYear) {
      flush();
      currentYear = row.year;
      yearWithdrawal = 0;
      yearTax = 0;
      yearReturn = 0;
    }
    yearWithdrawal += row.withdrawal;
    yearTax += row.tax_paid;
    yearReturn += row.return_gain || 0;
    lastRow = row;
  }
  flush();
}

function renderStats(history, params) {
  if (!history.length) return;

  const lastRow = history[history.length - 1];
  const ansparRows = history.filter(r => r.phase === "Anspar");
  const entnahmeRows = history.filter(r => r.phase === "Entnahme");
  
  // Vermögen bei Rentenbeginn berechnen
  // KORRIGIERT: Nutze den ERSTEN Entnahmemonat (nach Vorabpauschale-Abzug im Januar),
  // nicht den letzten Ansparmonat, da die Januar-Steuer das verfügbare Kapital reduziert.
  const entnahmeStartIdx = ansparRows.length;
  // Falls Entnahmephase existiert: erster Entnahmemonat; sonst: letzter Ansparmonat als Fallback
  const entnahmeStartRow = entnahmeRows.length > 0 
    ? entnahmeRows[0] 
    : (entnahmeStartIdx > 0 ? history[entnahmeStartIdx - 1] : history[0]);
  const retirementWealth = entnahmeStartRow.total;
  const retirementWealthReal = entnahmeStartRow.total_real || retirementWealth;

  // === NOMINALE WERTE ===
  
  // Endvermögen
  document.getElementById("stat-end-nominal").textContent = formatCurrency(lastRow.total);
  
  // Vermögen bei Rentenbeginn (nominal)
  const retirementNominalEl = document.getElementById("stat-retirement-wealth-nominal");
  if (retirementNominalEl) {
    retirementNominalEl.textContent = formatCurrency(retirementWealth);
  }

  // Eingezahlt gesamt (Start + alle Beiträge)
  // KORRIGIERT: Nutze cost_basis für Start-ETF statt Marktwert, falls angegeben
  const effectiveStartEtf = (params.start_etf_cost_basis > 0) 
    ? params.start_etf_cost_basis 
    : (params.start_etf || 0);
  const totalInvested = (params.start_savings || 0) + effectiveStartEtf +
    ansparRows.reduce((sum, r) => sum + (r.savings_contrib || 0) + (r.etf_contrib || 0), 0);
  document.getElementById("stat-total-invested").textContent = formatCurrency(totalInvested);

  // Rendite gesamt (nominal)
  const totalReturn = history.reduce((sum, r) => sum + (r.return_gain || 0), 0);
  document.getElementById("stat-total-return").textContent = formatCurrency(totalReturn);

  // Entnahme-Statistiken (Toggle: mit/ohne Sonderausgaben)
  const useWithdrawals = includeSpecialWithdrawals;
  
  const displayValues = entnahmeRows
    .filter(r => useWithdrawals ? r.withdrawal > 0 : r.monthly_payout > 0)
    .map(r => useWithdrawals ? r.withdrawal : r.monthly_payout);
  const displayValuesReal = entnahmeRows
    .filter(r => useWithdrawals ? r.withdrawal_real > 0 : r.monthly_payout_real > 0)
    .map(r => useWithdrawals ? r.withdrawal_real : r.monthly_payout_real);
  
  // Toggle-Hinweise aktualisieren
  const hintText = useWithdrawals ? "mit Sonder" : "ohne Sonder";
  const hintClass = useWithdrawals ? "stat-toggle-hint stat-toggle-hint--active" : "stat-toggle-hint";
  for (let i = 1; i <= 4; i++) {
    const hint = document.getElementById(`stat-toggle-hint-${i}`);
    if (hint) {
      hint.textContent = hintText;
      hint.className = hintClass;
    }
  }
  
  // Entnahmen gesamt (nominal)
  const totalWithdrawals = entnahmeRows.reduce((sum, r) => sum + (r.withdrawal || 0), 0);
  const totalWithdrawalsEl = document.getElementById("stat-total-withdrawals");
  if (totalWithdrawalsEl) {
    totalWithdrawalsEl.textContent = formatCurrency(totalWithdrawals);
  }
  
  if (displayValues.length > 0) {
    const avgWithdrawal = displayValues.reduce((a, b) => a + b, 0) / displayValues.length;
    document.getElementById("stat-avg-withdrawal").textContent = formatCurrency(avgWithdrawal);
    
    // Min/Max (nominal)
    const minVal = Math.min(...displayValues);
    const maxVal = Math.max(...displayValues);
    document.getElementById("stat-minmax-withdrawal").textContent = 
      `${formatCurrency(minVal)} / ${formatCurrency(maxVal)}`;
  } else {
    document.getElementById("stat-avg-withdrawal").textContent = "-";
    document.getElementById("stat-minmax-withdrawal").textContent = "-";
  }

  // Steuern gesamt
  const totalTax = history.reduce((sum, r) => sum + (r.tax_paid || 0), 0);
  document.getElementById("stat-total-tax").textContent = formatCurrency(totalTax);
  
  // Vorabpauschale gesamt
  const totalVorabpauschale = history.reduce((sum, r) => sum + (r.vorabpauschale_tax || 0), 0);
  document.getElementById("stat-vorabpauschale").textContent = formatCurrency(totalVorabpauschale);

  // Effektive Entnahmerate (bezogen auf Startvermögen Entnahmephase)
  let effectiveRate = 0;
  if (entnahmeRows.length > 0 && displayValues.length > 0) {
    const avgAnnualWithdrawal = (displayValues.reduce((a, b) => a + b, 0) / displayValues.length) * 12;
    effectiveRate = retirementWealth > 0 ? (avgAnnualWithdrawal / retirementWealth * 100) : 0;
    document.getElementById("stat-effective-rate").textContent = `${nf2.format(effectiveRate)} % p.a.`;
  } else {
    document.getElementById("stat-effective-rate").textContent = "-";
  }

  // Kapitalerhalt-Statistik anzeigen
  const cpCard = document.getElementById("stat-card-capital-preservation");
  const cpMonthsEl = document.getElementById("stat-capital-preservation-months");
  const cpHintEl = document.getElementById("stat-capital-preservation-hint");
  
  if (cpCard && cpMonthsEl) {
    if (history.capitalPreservationEnabled && entnahmeRows.length > 0) {
      cpCard.style.display = "";
      const cpMonths = history.capitalPreservationMonths || 0;
      const cpYears = (cpMonths / 12).toFixed(1);
      const cpPercent = entnahmeRows.length > 0 ? ((cpMonths / entnahmeRows.length) * 100).toFixed(0) : 0;
      
      if (cpMonths > 0) {
        cpMonthsEl.textContent = `${cpMonths} Monate`;
        cpHintEl.textContent = `${cpPercent}% der Entnahmephase (${cpYears} Jahre)`;
        cpCard.classList.add("stat-card--active");
      } else {
        cpMonthsEl.textContent = "0 Monate";
        cpHintEl.textContent = "Schwelle nie unterschritten";
        cpCard.classList.remove("stat-card--active");
      }
    } else {
      cpCard.style.display = "none";
    }
  }

  // === INFLATIONSBEREINIGTE WERTE ===
  
  // Endvermögen (real)
  document.getElementById("stat-end-real").textContent = formatCurrency(lastRow.total_real || lastRow.total);
  
  // Vermögen bei Rentenbeginn (real)
  const retirementRealEl = document.getElementById("stat-retirement-wealth-real");
  if (retirementRealEl) {
    retirementRealEl.textContent = formatCurrency(retirementWealthReal);
  }
  
  // Eingezahlt gesamt (real) - Einzahlungen inflationsbereinigt
  // KORRIGIERT: Jede Einzahlung wird auf heutige Kaufkraft umgerechnet (durch kumulative Inflation)
  // Startvermögen wird mit Inflation zum Zeitpunkt 0 (=1) bewertet
  const effectiveStartEtfReal = (params.start_etf_cost_basis > 0) 
    ? params.start_etf_cost_basis 
    : (params.start_etf || 0);
  let totalInvestedReal = (params.start_savings || 0) + effectiveStartEtfReal; // Startwerte bei Inflation=1
  
  // Laufende Beiträge inflationsbereinigen (dividieren durch kumulative Inflation)
  for (const row of ansparRows) {
    const monthContrib = (row.savings_contrib || 0) + (row.etf_contrib || 0);
    const inflation = row.cumulative_inflation || 1;
    totalInvestedReal += monthContrib / inflation;
  }
  
  const totalInvestedRealEl = document.getElementById("stat-total-invested-real");
  if (totalInvestedRealEl) {
    totalInvestedRealEl.textContent = formatCurrency(totalInvestedReal);
  }
  
  // Rendite gesamt (real) - Endvermögen real minus Einzahlungen real
  // KORRIGIERT: Konsistente Berechnung mit inflationsbereinigten Einzahlungen
  const totalReturnReal = (lastRow.total_real || lastRow.total) - totalInvestedReal;
  const totalReturnRealEl = document.getElementById("stat-total-return-real");
  if (totalReturnRealEl) {
    totalReturnRealEl.textContent = formatCurrency(totalReturnReal);
  }
  
  // Entnahmen gesamt (real)
  const totalWithdrawalsReal = entnahmeRows.reduce((sum, r) => sum + (r.withdrawal_real || r.withdrawal || 0), 0);
  const totalWithdrawalsRealEl = document.getElementById("stat-total-withdrawals-real");
  if (totalWithdrawalsRealEl) {
    totalWithdrawalsRealEl.textContent = formatCurrency(totalWithdrawalsReal);
  }
  
  if (displayValuesReal.length > 0) {
    // Durchschnittliche Entnahme (real)
    const avgWithdrawalReal = displayValuesReal.reduce((a, b) => a + b, 0) / displayValuesReal.length;
    document.getElementById("stat-avg-withdrawal-real").textContent = formatCurrency(avgWithdrawalReal);
    
    // Min/Max (real)
    const minValReal = Math.min(...displayValuesReal);
    const maxValReal = Math.max(...displayValuesReal);
    document.getElementById("stat-minmax-withdrawal-real").textContent = 
      `${formatCurrency(minValReal)} / ${formatCurrency(maxValReal)}`;
  } else {
    document.getElementById("stat-avg-withdrawal-real").textContent = "-";
    document.getElementById("stat-minmax-withdrawal-real").textContent = "-";
  }
  
  // Kaufkraftverlust durch Inflation
  const inflationFactor = lastRow.cumulative_inflation || 1;
  const purchasingPowerLoss = (1 - 1 / inflationFactor) * 100;
  const purchasingPowerLossEl = document.getElementById("stat-purchasing-power-loss");
  if (purchasingPowerLossEl) {
    purchasingPowerLossEl.textContent = `${nf2.format(purchasingPowerLoss)} %`;
  }
  
  // Reale Rendite p.a. - berechnet aus tatsächlichem Vermögensverlauf
  // Nur für Ansparphase sinnvoll; in der Entnahmephase dominieren Auszahlungen
  const realReturnPaEl = document.getElementById("stat-real-return-pa");
  if (realReturnPaEl) {
    const endValueReal = lastRow.total_real || lastRow.total;
    
    if (endValueReal < 1) {
      realReturnPaEl.textContent = "Vermögen aufgebraucht";
    } else if (entnahmeRows.length > 0) {
      // Entnahmephase aktiv: Berechne tatsächliche reale Performance aus der Ansparphase
      // (Entnahme verzerrt die Renditeberechnung)
      const ansparEnd = ansparRows.length > 0 ? ansparRows[ansparRows.length - 1] : null;
      if (ansparEnd) {
        // KORRIGIERT: Nutze cost_basis für Start-ETF wenn angegeben
        const effectiveStartEtfCost = (params.start_etf_cost_basis > 0) 
          ? params.start_etf_cost_basis 
          : (params.start_etf || 0);
        const startTotal = (params.start_savings || 0) + effectiveStartEtfCost;
        const totalContribs = ansparRows.reduce((sum, r) => sum + (r.savings_contrib || 0) + (r.etf_contrib || 0), 0);
        const costBasis = startTotal + totalContribs;
        const ansparEndValue = ansparEnd.total || 0;
        const yearsAnsparen = params.savings_years || 1;
        
        if (costBasis > 0 && ansparEndValue > 0) {
          // Approximierte CAGR unter Berücksichtigung von Einzahlungen
          // (Modified Dietz-Näherung für grobe Schätzung)
          const gain = ansparEndValue - costBasis;
          const avgInvested = startTotal + totalContribs * 0.5; // Annahme: lineare Einzahlung
          const nominalCagr = avgInvested > 0 ? Math.pow(ansparEndValue / avgInvested, 1 / yearsAnsparen) - 1 : 0;
          const inflationRate = params.inflation_rate_pa / 100 || 0.02;
          const realCagr = ((1 + nominalCagr) / (1 + inflationRate) - 1) * 100;
          realReturnPaEl.textContent = `${nf2.format(realCagr)} % (Anspar)`;
        } else {
          realReturnPaEl.textContent = "-";
        }
      } else {
        realReturnPaEl.textContent = "-";
      }
    } else {
      // Nur Ansparphase: Berechne CAGR aus tatsächlichem Verlauf
      // KORRIGIERT: Nutze cost_basis für Start-ETF wenn angegeben
      const effectiveStartEtfCost = (params.start_etf_cost_basis > 0) 
        ? params.start_etf_cost_basis 
        : (params.start_etf || 0);
      const startTotal = (params.start_savings || 0) + effectiveStartEtfCost;
      const totalContribs = ansparRows.reduce((sum, r) => sum + (r.savings_contrib || 0) + (r.etf_contrib || 0), 0);
      const endValue = lastRow.total || 0;
      const yearsTotal = history.length / 12;
      const avgInvested = startTotal + totalContribs * 0.5;
      
      if (avgInvested > 0 && endValue > 0 && yearsTotal > 0) {
        const nominalCagr = Math.pow(endValue / avgInvested, 1 / yearsTotal) - 1;
        const inflationRate = params.inflation_rate_pa / 100 || 0.02;
        const realCagr = ((1 + nominalCagr) / (1 + inflationRate) - 1) * 100;
        realReturnPaEl.textContent = `${nf2.format(realCagr)} %`;
      } else {
        realReturnPaEl.textContent = "-";
      }
    }
  }
  
  // Effektive Entnahmerate (real)
  const effectiveRateRealEl = document.getElementById("stat-effective-rate-real");
  if (effectiveRateRealEl) {
    if (entnahmeRows.length > 0 && displayValuesReal.length > 0) {
      const avgAnnualWithdrawalReal = (displayValuesReal.reduce((a, b) => a + b, 0) / displayValuesReal.length) * 12;
      const effectiveRateReal = retirementWealthReal > 0 ? (avgAnnualWithdrawalReal / retirementWealthReal * 100) : 0;
      effectiveRateRealEl.textContent = `${nf2.format(effectiveRateReal)} % p.a.`;
    } else {
      effectiveRateRealEl.textContent = "-";
    }
  }

  // Warnung bei Vermögensaufbrauch
  const warningEl = document.getElementById("stat-warning");
  if (warningEl) {
    const taxShortfallMonths = history.filter(r => (r.tax_shortfall || 0) > 0.01).length;
    if (entnahmeRows.length > 0) {
      const startCapital = retirementWealth;
      const endCapital = lastRow.total;
      const capitalRatio = startCapital > 0 ? endCapital / startCapital : 1;
      
      // Prüfe ob Entnahmen nicht vollständig bedient werden konnten
      // KORRIGIERT: Nutze withdrawal_requested (gesamt angefordert) vs withdrawal (tatsächlich gezahlt)
      const shortfallMonths = entnahmeRows.filter(r => {
        const requested = r.withdrawal_requested || 0;
        const paid = r.withdrawal || 0;
        return requested > 0 && paid < requested * 0.99; // 1% Toleranz
      }).length;
      
      if (endCapital < 100) {
        warningEl.textContent = "\u26a0\ufe0f Vermögen vollständig aufgebraucht! Entnahmen können nicht gedeckt werden.";
        warningEl.className = "stat-warning stat-warning--critical";
      } else if (capitalRatio < 0.1) {
        warningEl.textContent = "\u26a0\ufe0f Vermögen fast aufgebraucht (< 10% des Startvermögens). Entnahmerate prüfen!";
        warningEl.className = "stat-warning stat-warning--critical";
      } else if (capitalRatio < 0.3) {
        warningEl.textContent = "\u26a0 Vermögen stark reduziert (< 30% des Startvermögens). Evtl. Entnahme anpassen.";
        warningEl.className = "stat-warning stat-warning--warning";
      } else if (taxShortfallMonths > 0) {
        warningEl.textContent = `\u26a0 Steuern konnten in ${taxShortfallMonths} Monaten nicht vollständig beglichen werden.`;
        warningEl.className = "stat-warning stat-warning--warning";
      } else if (shortfallMonths > 0) {
        warningEl.textContent = `\u26a0 In ${shortfallMonths} Monaten konnte die gewünschte Entnahme nicht vollständig bedient werden.`;
        warningEl.className = "stat-warning stat-warning--warning";
      } else {
        warningEl.textContent = "\u2705 Vermögen reicht für den gewählten Entnahmezeitraum.";
        warningEl.className = "stat-warning stat-warning--ok";
      }
    } else {
      if (taxShortfallMonths > 0) {
        warningEl.textContent = `\u26a0 Steuern konnten in ${taxShortfallMonths} Monaten nicht vollständig beglichen werden.`;
        warningEl.className = "stat-warning stat-warning--warning";
      } else {
        warningEl.textContent = "";
        warningEl.className = "stat-warning";
      }
    }
  }
}

function renderGraph(history) {
  const ctx = graphCanvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = graphCanvas.clientWidth || graphCanvas.parentElement.clientWidth || 800;
  const height = graphCanvas.clientHeight || 320;
  
  // HiDPI-Fix: Canvas-Größe und CSS-Größe korrekt setzen
  graphCanvas.width = width * dpr;
  graphCanvas.height = height * dpr;
  graphCanvas.style.width = `${width}px`;
  graphCanvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  if (!history.length) {
    graphState = null;
    return;
  }

  const padX = 60;
  const padY = 50;
  const totals = history.map(r => r.total);
  const totalsReal = history.map(r => r.total_real ?? r.total);
  const xDenom = Math.max(history.length - 1, 1);
  
  // Min/Max für beide Skalierungen
  // KORRIGIERT: Fallback wenn alle Werte <= 0 sind (z.B. alle Eingaben 0)
  const positiveVals = [...totals.filter(v => v > 0), ...totalsReal.filter(v => v > 0)];
  const minVal = positiveVals.length > 0 
    ? Math.max(1000, Math.min(...positiveVals)) 
    : 1000; // Fallback auf 1000 wenn keine positiven Werte
  const maxVal = Math.max(minVal * 10, ...totals, ...totalsReal, 10000); // Mindestens 10000 als Max
  
  let toXY;
  
  if (stdUseLogScale) {
    // Logarithmische Skala
    const logMin = Math.log10(minVal);
    const logMax = Math.log10(maxVal);
    const logRange = logMax - logMin;
    
    toXY = (idx, val) => {
      const x = padX + (idx / xDenom) * (width - 2 * padX);
      const clampedVal = Math.max(minVal, val);
      const logVal = Math.log10(clampedVal);
      // KORRIGIERT: Verhindere Division durch 0 wenn logMax === logMin
      const yNorm = logRange > 0 ? (logVal - logMin) / logRange : 0.5;
      const y = height - padY - yNorm * (height - 2 * padY);
      return [x, y];
    };
  } else {
    // Lineare Skala
    toXY = (idx, val) => {
      const x = padX + (idx / xDenom) * (width - 2 * padX);
      // KORRIGIERT: Verhindere Division durch 0
      const y = height - padY - (maxVal > 0 ? (val / maxVal) : 0) * (height - 2 * padY);
      return [x, y];
    };
  }

  // Achsen
  ctx.strokeStyle = "#8b96a9";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, height - padY);
  ctx.lineTo(width - padX, height - padY);
  ctx.moveTo(padX, height - padY);
  ctx.lineTo(padX, padY);
  ctx.stroke();

  // Y Hilfslinien
  ctx.font = "12px 'Segoe UI', sans-serif";
  ctx.fillStyle = "#94a3b8";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  
  if (stdUseLogScale) {
    // Logarithmische Schritte
    const logMin = Math.log10(minVal);
    const logSteps = [];
    let step = Math.pow(10, Math.floor(logMin));
    while (step <= maxVal) {
      if (step >= minVal) logSteps.push(step);
      if (step * 2 >= minVal && step * 2 <= maxVal) logSteps.push(step * 2);
      if (step * 5 >= minVal && step * 5 <= maxVal) logSteps.push(step * 5);
      step *= 10;
    }
    
    for (const val of logSteps) {
      const [, y] = toXY(0, val);
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(width - padX, y);
      ctx.stroke();
      ctx.fillStyle = "#94a3b8";
      const label = val >= 1000000 ? `${(val / 1000000).toFixed(val % 1000000 === 0 ? 0 : 1)}M` : `${Math.round(val / 1000)}k`;
      ctx.fillText(label, padX - 8, y);
    }
  } else {
    // Lineare Schritte
    for (let i = 0; i <= Y_AXIS_STEPS; i += 1) {
      const val = maxVal * (i / Y_AXIS_STEPS);
      const [, y] = toXY(0, val);
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(width - padX, y);
      ctx.stroke();
      const label = val >= 1000000 ? `${(val / 1000000).toFixed(1)}M` : `${Math.round(val / 1000)}k`;
      ctx.fillText(label, padX - 8, y);
    }
  }

  // X Labels (Jahre)
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const lastYear = history[history.length - 1].year;
  for (let year = 1; year <= lastYear; year += 1) {
    const idx = Math.min(year * MONTHS_PER_YEAR - 1, history.length - 1);
    const [x] = toXY(idx, 0);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.moveTo(x, height - padY);
    ctx.lineTo(x, height - padY + 6);
    ctx.stroke();
    ctx.fillText(String(year), x, height - padY + 8);
  }

  const drawLine = (data, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((val, i) => {
      const [x, y] = toXY(i, val);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  drawLine(totals, "#f59e0b");
  drawLine(totalsReal, "#22c55e");

  // Phasen-Trennung
  const switchIdx = history.findIndex(r => r.phase === "Entnahme");
  if (switchIdx !== -1) {
    const [sx] = toXY(switchIdx, 0);
    ctx.strokeStyle = "#6b7280";
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(sx, padY);
    ctx.lineTo(sx, height - padY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("Entnahme ->", sx - 6, padY + 40);
  }

  graphState = { history, padX, padY, width, height, maxVal, xDenom };
}

function handleHover(evt) {
  if (!graphState || !graphState.history.length) {
    tooltip.setAttribute("data-visible", "false");
    tooltip.setAttribute("aria-hidden", "true");
    return;
  }
  const rect = graphCanvas.getBoundingClientRect();
  const x = evt.clientX - rect.left;
  if (x < graphState.padX || x > graphState.width - graphState.padX) {
    tooltip.setAttribute("data-visible", "false");
    tooltip.setAttribute("aria-hidden", "true");
    return;
  }

  const idxFloat = (x - graphState.padX) / (graphState.width - 2 * graphState.padX) * graphState.xDenom;
  const idx = Math.max(0, Math.min(graphState.history.length - 1, Math.round(idxFloat)));
  const row = graphState.history[idx];

  const lines = [
    `Jahr ${row.year}, Monat ${row.month}`,
    `Gesamt: ${formatCurrency(row.total)}`,
    `Gesamt (inflationsbereinigt): ${formatCurrency(row.total_real || row.total)}`
  ];
  tooltip.textContent = lines.join("\n");
  tooltip.style.left = `${evt.clientX + 14}px`;
  tooltip.style.top = `${evt.clientY + 12}px`;
  tooltip.setAttribute("data-visible", "true");
  tooltip.setAttribute("aria-hidden", "false");
}

function hideTooltip() {
  tooltip.setAttribute("data-visible", "false");
  tooltip.setAttribute("aria-hidden", "true");
}

function updateRentFields(history, mode) {
  const firstEntnahme = history.find(r => r.phase === "Entnahme" && r.payout_value != null);
  if (!firstEntnahme) return;
  const rentEur = document.getElementById("rent_eur");
  const rentPercent = document.getElementById("rent_percent");

  if (mode === "percent" && rentEur) {
    rentEur.value = formatForInput(firstEntnahme.payout_value || 0);
  }
  if (rentPercent) {
    const pct = firstEntnahme.payout_percent_pa != null ? firstEntnahme.payout_percent_pa : 0;
    rentPercent.value = formatForInput(pct);
  }
}

function updateRentModeFields() {
  const mode = form.querySelector('input[name="rent_mode"]:checked')?.value || "eur";
  const rentEur = document.getElementById("rent_eur");
  const rentPercent = document.getElementById("rent_percent");
  
  if (rentEur) {
    rentEur.disabled = mode !== "eur";
    rentEur.closest(".field")?.classList.toggle("field--disabled", mode !== "eur");
  }
  if (rentPercent) {
    rentPercent.disabled = mode !== "percent";
    rentPercent.closest(".field")?.classList.toggle("field--disabled", mode !== "percent");
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  try {
    messageEl.textContent = "";
    const mode = form.querySelector('input[name="rent_mode"]:checked')?.value || "eur";
    const inflationAdjust = document.getElementById("inflation_adjust_withdrawal")?.checked ?? true;
    const inflationAdjustSpecialSavings = document.getElementById("inflation_adjust_special_savings")?.checked ?? true;
    const inflationAdjustSpecialWithdrawal = document.getElementById("inflation_adjust_special_withdrawal")?.checked ?? true;
    
    // Validierte Parameter mit Grenzen
    const params = {
      start_savings: readNumber("start_savings", { min: 0 }),
      start_etf: readNumber("start_etf", { min: 0 }),
      start_etf_cost_basis: readNumber("start_etf_cost_basis", { min: 0 }),
      monthly_savings: readNumber("monthly_savings", { min: 0 }),
      monthly_etf: readNumber("monthly_etf", { min: 0 }),
      savings_rate_pa: readNumber("savings_rate", { min: -10, max: 50 }),
      etf_rate_pa: readNumber("etf_rate", { min: -50, max: 50 }),
      etf_ter_pa: readNumber("etf_ter", { min: 0, max: 5 }),
      savings_target: readNumber("savings_target", { min: 0 }),
      annual_raise_percent: readNumber("annual_raise", { min: -10, max: 50 }),
      savings_years: readNumber("years_save", { min: 1, max: 100 }),
      withdrawal_years: readNumber("years_withdraw", { min: 1, max: 100 }),
      monthly_payout_net: mode === "eur" ? readNumber("rent_eur", { min: 0 }) : null,
      monthly_payout_percent: mode === "percent" ? readNumber("rent_percent", { min: 0, max: 100 }) : null,
      withdrawal_min: readNumber("withdrawal_min", { min: 0 }),
      withdrawal_max: readNumber("withdrawal_max", { min: 0 }),
      inflation_adjust_withdrawal: inflationAdjust,
      special_payout_net_savings: readNumber("special_savings", { min: 0 }),
      special_interval_years_savings: readNumber("special_savings_interval", { min: 0 }),
      inflation_adjust_special_savings: inflationAdjustSpecialSavings,
      special_payout_net_withdrawal: readNumber("special_withdraw", { min: 0 }),
      special_interval_years_withdrawal: readNumber("special_withdraw_interval", { min: 0 }),
      inflation_adjust_special_withdrawal: inflationAdjustSpecialWithdrawal,
      inflation_rate_pa: readNumber("inflation_rate", { min: -10, max: 30 }),
      sparerpauschbetrag: readNumber("sparerpauschbetrag", { min: 0, max: 10000 }),
      kirchensteuer: document.getElementById("kirchensteuer")?.value || "keine",
      fondstyp: document.getElementById("fondstyp")?.value || "aktien",
      basiszins: readNumber("basiszins", { min: 0, max: 10 }),
      use_lifo: document.getElementById("use_lifo")?.checked ?? false,
      rent_mode: mode,
      rent_is_gross: document.getElementById("rent_is_gross")?.checked ?? false,
      capital_preservation_enabled: document.getElementById("capital_preservation_enabled")?.checked ?? false,
      capital_preservation_threshold: readNumber("capital_preservation_threshold", { min: 10, max: 100 }),
      capital_preservation_reduction: readNumber("capital_preservation_reduction", { min: 5, max: 75 }),
      capital_preservation_recovery: readNumber("capital_preservation_recovery", { min: 0, max: 50 }),
      loss_pot: readNumber("loss_pot", { min: 0 }),
    };

    lastHistory = simulate(params);
    lastParams = params;
    
    // Wechsle zum Standard-Tab
    switchToTab("standard");
    
    // Kurze Verzögerung für korrektes Canvas-Sizing nach Tab-Wechsel
    setTimeout(() => {
      renderGraph(lastHistory);
      renderTable(lastHistory);
      renderStats(lastHistory, params);
      updateRentFields(lastHistory, mode);
    }, 20);
    
    saveToStorage(params);
    messageEl.textContent = "Simulation aktualisiert.";
  } catch (err) {
    messageEl.textContent = err.message || String(err);
  }
});

// Event-Listener für Rentenmodus-Toggle
form.querySelectorAll('input[name="rent_mode"]').forEach(radio => {
  radio.addEventListener("change", updateRentModeFields);
});

// Reset-Button
document.getElementById("btn-reset")?.addEventListener("click", resetToDefaults);

// ============ EXPORT DROPDOWN ============

const exportMenu = document.getElementById("export-menu");
const exportToggle = document.getElementById("btn-export-toggle");

// Toggle Export Dropdown
exportToggle?.addEventListener("click", (e) => {
  e.stopPropagation();
  exportMenu?.classList.toggle("active");
});

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
  if (!e.target.closest(".export-dropdown")) {
    exportMenu?.classList.remove("active");
  }
});

// Standard CSV Export
document.getElementById("btn-export-csv")?.addEventListener("click", () => {
  exportMenu?.classList.remove("active");
  exportToCsv(lastHistory);
});

// Standard PDF Export
document.getElementById("btn-export-pdf")?.addEventListener("click", () => {
  exportMenu?.classList.remove("active");
  exportToPdf(lastHistory, lastParams);
});

// Monte-Carlo CSV Export
document.getElementById("btn-export-mc-csv")?.addEventListener("click", () => {
  exportMenu?.classList.remove("active");
  exportMonteCarloToCsv(lastMcResults, lastParams);
});

// Monte-Carlo PDF Export
document.getElementById("btn-export-mc-pdf")?.addEventListener("click", () => {
  exportMenu?.classList.remove("active");
  exportMonteCarloToPdf(lastMcResults, lastParams);
});

graphCanvas.addEventListener("mousemove", handleHover);
graphCanvas.addEventListener("mouseleave", hideTooltip);
window.addEventListener("resize", () => {
  if (lastHistory.length) renderGraph(lastHistory);
});

// Log/Linear Toggle für Standard Graph
const btnStdLog = document.getElementById("btn-std-log");
const btnStdLinear = document.getElementById("btn-std-linear");

btnStdLog?.addEventListener("click", () => {
  if (stdUseLogScale) return;
  stdUseLogScale = true;
  btnStdLog.classList.add("btn-scale--active");
  btnStdLinear.classList.remove("btn-scale--active");
  if (lastHistory.length) renderGraph(lastHistory);
});

btnStdLinear?.addEventListener("click", () => {
  if (!stdUseLogScale) return;
  stdUseLogScale = false;
  btnStdLinear.classList.add("btn-scale--active");
  btnStdLog.classList.remove("btn-scale--active");
  if (lastHistory.length) renderGraph(lastHistory);
});

// Toggle für Entnahme-Statistiken (mit/ohne Sonderausgaben)
function toggleWithdrawalStats() {
  includeSpecialWithdrawals = !includeSpecialWithdrawals;
  if (lastHistory.length && lastParams) {
    renderStats(lastHistory, lastParams);
  }
}

// Event-Listener für klickbare Stat-Karten
["stat-card-avg-nominal", "stat-card-avg-real", "stat-card-minmax-nominal", "stat-card-minmax-real"].forEach(id => {
  document.getElementById(id)?.addEventListener("click", toggleWithdrawalStats);
});

// Toggle für Nominal/Real Statistiken
const btnStatsNominal = document.getElementById("btn-stats-nominal");
const btnStatsReal = document.getElementById("btn-stats-real");
const statsSectionNominal = document.getElementById("stats-section-nominal");
const statsSectionReal = document.getElementById("stats-section-real");

function updateStatsView() {
  if (showRealStats) {
    statsSectionNominal?.classList.add("stats-section--hidden");
    statsSectionReal?.classList.remove("stats-section--hidden");
    btnStatsNominal?.classList.remove("stats-toggle-btn--active");
    btnStatsReal?.classList.add("stats-toggle-btn--active");
  } else {
    statsSectionNominal?.classList.remove("stats-section--hidden");
    statsSectionReal?.classList.add("stats-section--hidden");
    btnStatsNominal?.classList.add("stats-toggle-btn--active");
    btnStatsReal?.classList.remove("stats-toggle-btn--active");
  }
}

btnStatsNominal?.addEventListener("click", () => {
  if (!showRealStats) return;
  showRealStats = false;
  updateStatsView();
});

btnStatsReal?.addEventListener("click", () => {
  if (showRealStats) return;
  showRealStats = true;
  updateStatsView();
});

// Toggle für Monte-Carlo Nominal/Real Statistiken
let showMcRealStats = false;
const btnMcStatsNominal = document.getElementById("btn-mc-stats-nominal");
const btnMcStatsReal = document.getElementById("btn-mc-stats-real");
const mcStatsSectionNominal = document.getElementById("mc-stats-section-nominal");
const mcStatsSectionReal = document.getElementById("mc-stats-section-real");

function updateMcStatsView() {
  if (showMcRealStats) {
    mcStatsSectionNominal?.classList.add("stats-section--hidden");
    mcStatsSectionReal?.classList.remove("stats-section--hidden");
    btnMcStatsNominal?.classList.remove("stats-toggle-btn--active");
    btnMcStatsReal?.classList.add("stats-toggle-btn--active");
  } else {
    mcStatsSectionNominal?.classList.remove("stats-section--hidden");
    mcStatsSectionReal?.classList.add("stats-section--hidden");
    btnMcStatsNominal?.classList.add("stats-toggle-btn--active");
    btnMcStatsReal?.classList.remove("stats-toggle-btn--active");
  }
  
  // Graph auch auf Real/Nominal umschalten
  mcUseRealValues = showMcRealStats;
  if (lastMcResults) {
    renderMonteCarloGraph(lastMcResults);
  }
}

btnMcStatsNominal?.addEventListener("click", () => {
  if (!showMcRealStats) return;
  showMcRealStats = false;
  updateMcStatsView();
});

btnMcStatsReal?.addEventListener("click", () => {
  if (showMcRealStats) return;
  showMcRealStats = true;
  updateMcStatsView();
});

// Gespeicherte Werte laden
applyStoredValues();
updateRentModeFields();

// ============ INFO MODAL ============

const infoModal = document.getElementById("info-modal");
const btnInfo = document.getElementById("btn-info");
const modalClose = document.getElementById("modal-close");
const formulaModal = document.getElementById("formula-modal");
const btnFormula = document.getElementById("btn-formula");
const formulaModalClose = document.getElementById("formula-modal-close");

function openInfoModal() {
  infoModal?.classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeInfoModal() {
  infoModal?.classList.remove("active");
  document.body.style.overflow = "";
}

function openFormulaModal() {
  formulaModal?.classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeFormulaModal() {
  formulaModal?.classList.remove("active");
  document.body.style.overflow = "";
}

btnInfo?.addEventListener("click", openInfoModal);
modalClose?.addEventListener("click", closeInfoModal);
btnFormula?.addEventListener("click", openFormulaModal);
formulaModalClose?.addEventListener("click", closeFormulaModal);

// Schließen bei Klick außerhalb des Modals
infoModal?.addEventListener("click", (e) => {
  if (e.target === infoModal) closeInfoModal();
});

formulaModal?.addEventListener("click", (e) => {
  if (e.target === formulaModal) closeFormulaModal();
});

// Schließen mit Escape-Taste
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (infoModal?.classList.contains("active")) {
      closeInfoModal();
    }
    if (formulaModal?.classList.contains("active")) {
      closeFormulaModal();
    }
  }
});

// ============ TAB SYSTEM ============

function initTabs() {
  const tabs = document.querySelectorAll(".tab");
  const tabContents = document.querySelectorAll(".tab-content");
  
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const targetId = tab.dataset.tab;
      
      // Deactivate all tabs
      tabs.forEach(t => t.classList.remove("tab--active"));
      tabContents.forEach(c => c.classList.remove("tab-content--active"));
      
      // Activate clicked tab
      tab.classList.add("tab--active");
      const targetContent = document.getElementById(`tab-${targetId}`);
      if (targetContent) {
        targetContent.classList.add("tab-content--active");
      }
      
      // Re-render graphs when switching tabs (for correct sizing)
      if (targetId === "standard" && lastHistory.length) {
        setTimeout(() => renderGraph(lastHistory), 10);
      } else if (targetId === "monte-carlo" && lastMcResults) {
        setTimeout(() => renderMonteCarloGraph(lastMcResults), 10);
      }
    });
  });
}

function switchToTab(tabName) {
  const tab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  if (tab) tab.click();
}

initTabs();

// ============ MONTE-CARLO SIMULATION ============

const mcGraphCanvas = document.getElementById("mc-graph");
const mcResultsEl = document.getElementById("mc-results");
const mcEmptyStateEl = document.getElementById("mc-empty-state");
const mcProgressEl = document.getElementById("mc-progress");
const mcProgressTextEl = document.getElementById("mc-progress-text");
const mcBadgeEl = document.getElementById("mc-badge");

let mcGraphState = null;
let lastMcResults = null;
let mcUseLogScale = true; // Standard: logarithmische Skala
let mcUseRealValues = false; // Standard: nominale Werte im Graph

/**
 * Wrapper for stochastic Monte-Carlo simulation.
 * Calls the unified simulate() function with volatility parameter.
 * @param {Object} params - Simulation parameters
 * @param {number} annualVolatility - Annual volatility in percent (e.g., 15 for 15%)
 * @returns {Array} History array with monthly data points
 */
function simulateStochastic(params, annualVolatility) {
  return simulate(params, annualVolatility);
}

// Berechnet Perzentil aus sortiertem Array
function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedArr[lower];
  return sortedArr[lower] * (upper - idx) + sortedArr[upper] * (idx - lower);
}

// Seeded PRNG (Mulberry32) für reproduzierbare Ergebnisse
function createSeededRandom(seed) {
  let s = seed;
  return function() {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Prüft Parameter auf historisch unrealistische Kombinationen
// Gibt Array von {text, severity} zurück ('warning' = gelb, 'critical' = rot)
function checkOptimisticParameters(params, volatility) {
  const warnings = [];
  const etfRate = params.etf_rate_pa || 6;
  const ter = params.etf_ter_pa || 0;
  const effectiveRate = etfRate - ter;
  const withdrawalRate = params.monthly_payout_percent || 0;
  const inflation = params.inflation_rate_pa || 2;
  
  // Rendite > 8% ist historisch optimistisch (MSCI World Durchschnitt ~7%)
  if (effectiveRate > 10) {
    warnings.push({ text: `ETF-Rendite von ${effectiveRate.toFixed(1)}% ist unrealistisch hoch – historischer Durchschnitt liegt bei ~6-7% nach Kosten.`, severity: "critical" });
  } else if (effectiveRate > 8) {
    warnings.push({ text: `ETF-Rendite von ${effectiveRate.toFixed(1)}% ist optimistisch – historischer Durchschnitt liegt bei ~6-7% nach Kosten.`, severity: "warning" });
  }
  
  // Niedrige Volatilität bei hoher Rendite
  if (effectiveRate > 6 && volatility < 10) {
    warnings.push({ text: `Volatilität von ${volatility}% bei ${effectiveRate.toFixed(1)}% Rendite ist unrealistisch niedrig – Aktien-ETFs schwanken typisch 15-20%.`, severity: "critical" });
  } else if (effectiveRate > 6 && volatility < 12) {
    warnings.push({ text: `Volatilität von ${volatility}% bei ${effectiveRate.toFixed(1)}% Rendite ist niedrig – Aktien-ETFs schwanken typisch 15-20%.`, severity: "warning" });
  }
  
  // Hohe Entnahmerate
  if (withdrawalRate > 5) {
    warnings.push({ text: `Entnahmerate von ${withdrawalRate}% p.a. ist sehr riskant – hohes Pleite-Risiko über 30 Jahre!`, severity: "critical" });
  } else if (withdrawalRate > 4.5) {
    warnings.push({ text: `Entnahmerate von ${withdrawalRate}% p.a. ist aggressiv – die "sichere" 4%-Regel basiert auf 30 Jahren.`, severity: "warning" });
  }
  
  // Sehr hohe Rendite + hohe Entnahme = überkonfident
  if (effectiveRate > 7 && withdrawalRate > 4) {
    warnings.push({ text: `Kombination aus ${effectiveRate.toFixed(1)}% Rendite und ${withdrawalRate}% Entnahme ist sehr optimistisch – plane konservativer.`, severity: "warning" });
  }
  
  // Niedrige Inflation
  if (inflation < 1.5) {
    warnings.push({ text: `Inflationsannahme von ${inflation}% liegt unter dem EZB-Ziel von 2% – reale Ergebnisse könnten schlechter sein.`, severity: "warning" });
  }
  
  return warnings;
}

// Berechnet, in welchem Jahr das Vermögen für P5/P10 auf 0 fällt
function calculateDepletionYears(results, params) {
  const savingsMonths = params.savings_years * MONTHS_PER_YEAR;
  const percentiles = results.percentilesReal || results.percentiles;
  
  let p5DepletionYear = null;
  let p10DepletionYear = null;
  
  // Suche nach dem ersten Monat in der Entnahmephase, wo P5/P10 auf 0 oder nahe 0 fällt
  const threshold = 100; // 100€ als "praktisch aufgebraucht"
  
  for (let i = savingsMonths; i < percentiles.p5.length; i++) {
    if (p5DepletionYear === null && percentiles.p5[i] <= threshold) {
      p5DepletionYear = Math.ceil((i - savingsMonths + 1) / MONTHS_PER_YEAR);
    }
    if (p10DepletionYear === null && percentiles.p10[i] <= threshold) {
      p10DepletionYear = Math.ceil((i - savingsMonths + 1) / MONTHS_PER_YEAR);
    }
    if (p5DepletionYear !== null && p10DepletionYear !== null) break;
  }
  
  return { p5DepletionYear, p10DepletionYear };
}

// Hauptfunktion für Monte-Carlo-Simulation
async function runMonteCarloSimulation(params, iterations, volatility, showIndividual, mcOptions = {}) {
  // Switch to Monte-Carlo tab and show results
  switchToTab("monte-carlo");
  
  if (mcEmptyStateEl) mcEmptyStateEl.style.display = "none";
  if (mcResultsEl) mcResultsEl.style.display = "block";
  
  // Prüfe auf optimistische Parameter und zeige Warnungen
  const paramWarnings = checkOptimisticParameters(params, volatility);
  const warningsEl = document.getElementById("mc-warnings");
  const warningContainerEl = document.getElementById("mc-warning-optimistic");
  const warningTextEl = document.getElementById("mc-warning-text");
  if (warningsEl && warningTextEl && warningContainerEl) {
    if (paramWarnings.length > 0) {
      // Höchster Schweregrad bestimmt die Farbe
      const hasCritical = paramWarnings.some(w => w.severity === "critical");
      warningContainerEl.classList.toggle("mc-warning--critical", hasCritical);
      
      // Icon anpassen
      const iconEl = warningContainerEl.querySelector(".mc-warning-icon");
      if (iconEl) iconEl.textContent = hasCritical ? "🚨" : "⚠️";
      
      // Texte zusammenbauen
      warningTextEl.innerHTML = paramWarnings.map(w => w.text).join("<br>");
      warningsEl.style.display = "block";
    } else {
      warningsEl.style.display = "none";
    }
  }
  
  mcProgressEl.value = 0;
  mcProgressTextEl.textContent = "Starte...";
  
  // Seeded RNG falls Seed angegeben
  if (mcOptions.seed != null) {
    currentRng = createSeededRandom(mcOptions.seed);
  } else {
    currentRng = Math.random; // Zurücksetzen auf Standard-RNG
  }
  
  const allHistories = [];
  const batchSize = 50; // Verarbeite in Batches für UI-Updates
  
  for (let i = 0; i < iterations; i += batchSize) {
    const batchEnd = Math.min(i + batchSize, iterations);
    
    for (let j = i; j < batchEnd; j++) {
      const history = simulateStochastic(params, volatility);
      allHistories.push(history);
    }
    
    // UI Update
    const progress = Math.round((batchEnd / iterations) * 100);
    mcProgressEl.value = progress;
    mcProgressTextEl.textContent = `${batchEnd} / ${iterations} (${progress}%)`;
    
    // Yield to browser
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  mcProgressTextEl.textContent = "Analysiere Ergebnisse...";
  await new Promise(resolve => setTimeout(resolve, 0));
  
  // Analysiere Ergebnisse mit konfigurierbaren Schwellen
  const results = analyzeMonteCarloResults(allHistories, params, mcOptions);
  results.volatility = volatility;
  results.showIndividual = showIndividual;
  results.allHistories = showIndividual ? allHistories.slice(0, 50) : [];
  results.mcOptions = mcOptions; // Speichere für Export
  
  lastMcResults = results;
  
  renderMonteCarloStats(results);
  renderMonteCarloGraph(results);
  
  mcProgressTextEl.textContent = "Fertig!";
  
  return results;
}

// Berechnet Sequence-of-Returns Risk Metriken
function analyzeSequenceOfReturnsRisk(allHistories, params) {
  const savingsMonths = params.savings_years * MONTHS_PER_YEAR;
  const withdrawalMonths = params.withdrawal_years * MONTHS_PER_YEAR;
  const numMonths = allHistories[0]?.length || 0;
  const numSims = allHistories.length;
  
  if (withdrawalMonths === 0 || numSims < 10) {
    return {
      sorRiskScore: 0,
      earlyBadImpact: 0,
      earlyGoodImpact: 0,
      correlationEarlyReturns: 0,
      worstSequenceEnd: 0,
      bestSequenceEnd: 0,
      medianSequenceEnd: 0,
      vulnerabilityWindow: 0,
    };
  }
  
  // Berechne frühe Renditen (erste 5 Jahre der Entnahmephase) für jede Simulation
  // Verwendet Time-Weighted Return (TWR) auf PORTFOLIO-Ebene (ETF + Cash gewichtet)
  const earlyYears = Math.min(5, params.withdrawal_years);
  const earlyMonths = earlyYears * MONTHS_PER_YEAR;
  
  const simData = allHistories.map(history => {
    // Vermögen am Start der Entnahme
    const startWealth = history[savingsMonths - 1]?.total || history[savingsMonths]?.total || 0;
    
    // Zeitgewichtete Rendite (TWR) für die ersten Jahre der Entnahmephase
    // TWR = Produkt der monatlichen Portfolio-Renditen (inkl. Cash-Anteil)
    // Nutzt portfolioReturn statt etfReturn für akkurate Gesamtportfolio-Analyse
    let twrProduct = 1;
    const earlyEndIdx = Math.min(savingsMonths + earlyMonths - 1, numMonths - 1);
    
    for (let m = savingsMonths; m <= earlyEndIdx && m < history.length; m++) {
      const monthlyReturn = history[m]?.portfolioReturn || history[m]?.etfReturn || 1;
      twrProduct *= monthlyReturn;
    }
    
    // Annualisierte TWR: (TWR_total)^(12/months) - 1
    const actualMonths = earlyEndIdx - savingsMonths + 1;
    const earlyReturn = actualMonths > 0 
      ? Math.pow(twrProduct, 12 / actualMonths) - 1 
      : 0;
    
    // Endvermögen
    const endWealth = history[numMonths - 1]?.total || 0;
    
    return { startWealth, earlyReturn, endWealth, history };
  });
  
  // Sortiere nach früher Rendite
  simData.sort((a, b) => a.earlyReturn - b.earlyReturn);
  
  // Unterteile in Quintile
  const quintileSize = Math.floor(numSims / 5);
  const worstEarlyQuintile = simData.slice(0, quintileSize);
  const bestEarlyQuintile = simData.slice(-quintileSize);
  const middleQuintiles = simData.slice(quintileSize * 2, quintileSize * 3);
  
  // Durchschnittliches Endvermögen pro Quintil
  const avgWorst = worstEarlyQuintile.reduce((s, d) => s + d.endWealth, 0) / worstEarlyQuintile.length;
  const avgBest = bestEarlyQuintile.reduce((s, d) => s + d.endWealth, 0) / bestEarlyQuintile.length;
  const avgMiddle = middleQuintiles.reduce((s, d) => s + d.endWealth, 0) / middleQuintiles.length;
  
  // Korrelation zwischen früher Rendite und Endvermögen (Pearson)
  const meanEarlyReturn = simData.reduce((s, d) => s + d.earlyReturn, 0) / numSims;
  const meanEndWealth = simData.reduce((s, d) => s + d.endWealth, 0) / numSims;
  
  let numerator = 0;
  let denomEarly = 0;
  let denomEnd = 0;
  
  for (const d of simData) {
    const diffEarly = d.earlyReturn - meanEarlyReturn;
    const diffEnd = d.endWealth - meanEndWealth;
    numerator += diffEarly * diffEnd;
    denomEarly += diffEarly * diffEarly;
    denomEnd += diffEnd * diffEnd;
  }
  
  const correlation = (denomEarly > 0 && denomEnd > 0) 
    ? numerator / Math.sqrt(denomEarly * denomEnd) 
    : 0;
  
  // SoRR Score: Wie stark beeinflusst die frühe Rendite das Endergebnis?
  // Basiert auf der Differenz zwischen bestem und schlechtestem Quintil
  const avgStartWealth = simData.reduce((s, d) => s + d.startWealth, 0) / numSims;
  const sorRiskScore = avgStartWealth > 0 
    ? ((avgBest - avgWorst) / avgStartWealth) * 100 
    : 0;
  
  // Impact: Prozentuale Abweichung vom Median
  const earlyBadImpact = avgMiddle > 0 ? ((avgWorst - avgMiddle) / avgMiddle) * 100 : 0;
  const earlyGoodImpact = avgMiddle > 0 ? ((avgBest - avgMiddle) / avgMiddle) * 100 : 0;
  
  // Vulnerabilitätsfenster: In welchem Jahr ist die Sensitivität am höchsten?
  // Berechne Korrelation zwischen TWR für jedes Jahr und dem Endvermögen
  let maxCorrelationYear = 1;
  let maxCorrelation = 0;
  
  for (let year = 1; year <= Math.min(10, params.withdrawal_years); year++) {
    const yearEndIdx = Math.min(savingsMonths + year * MONTHS_PER_YEAR - 1, numMonths - 1);
    
    const yearData = allHistories.map(h => {
      // TWR für dieses Jahr berechnen (Produkt der monatlichen Portfolio-Renditen)
      let twrProduct = 1;
      for (let m = savingsMonths; m <= yearEndIdx && m < h.length; m++) {
        const monthlyReturn = h[m]?.portfolioReturn || h[m]?.etfReturn || 1;
        twrProduct *= monthlyReturn;
      }
      const yearReturn = twrProduct - 1; // TWR als Prozent
      const endW = h[numMonths - 1]?.total || 0;
      return { yearReturn, endW };
    });
    
    const meanYR = yearData.reduce((s, d) => s + d.yearReturn, 0) / numSims;
    const meanEW = yearData.reduce((s, d) => s + d.endW, 0) / numSims;
    
    let num = 0, denYR = 0, denEW = 0;
    for (const d of yearData) {
      const dYR = d.yearReturn - meanYR;
      const dEW = d.endW - meanEW;
      num += dYR * dEW;
      denYR += dYR * dYR;
      denEW += dEW * dEW;
    }
    
    const corr = (denYR > 0 && denEW > 0) ? Math.abs(num / Math.sqrt(denYR * denEW)) : 0;
    if (corr > maxCorrelation) {
      maxCorrelation = corr;
      maxCorrelationYear = year;
    }
  }
  
  return {
    sorRiskScore: Math.abs(sorRiskScore),
    earlyBadImpact,
    earlyGoodImpact,
    correlationEarlyReturns: correlation,
    worstSequenceEnd: avgWorst,
    bestSequenceEnd: avgBest,
    medianSequenceEnd: avgMiddle,
    vulnerabilityWindow: maxCorrelationYear,
  };
}

function analyzeMonteCarloResults(allHistories, params, mcOptions = {}) {
  const numMonths = allHistories[0]?.length || 0;
  const numSims = allHistories.length;
  const savingsMonths = params.savings_years * MONTHS_PER_YEAR;
  
  // Konfigurierbare Schwellen (mit Defaults)
  const SUCCESS_THRESHOLD_REAL = mcOptions.successThreshold ?? 100; // € in heutiger Kaufkraft
  const RUIN_THRESHOLD_PERCENT = (mcOptions.ruinThresholdPercent ?? 10) / 100; // % des Rentenbeginn-Vermögens
  
  // Sammle Endvermögen
  const finalTotals = allHistories.map(h => h[h.length - 1]?.total || 0).sort((a, b) => a - b);
  const finalTotalsReal = allHistories.map(h => h[h.length - 1]?.total_real || 0).sort((a, b) => a - b);
  // Sammle Verlusttöpfe & genutzten Freibetrag am Ende
  const finalLossPot = allHistories.map(h => h[h.length - 1]?.loss_pot || 0).sort((a, b) => a - b);
  const finalYearlyFreibetrag = allHistories.map(h => h[h.length - 1]?.yearly_used_freibetrag || 0).sort((a, b) => a - b);
  
  // Sequence-of-Returns Risk Analyse
  const sorr = analyzeSequenceOfReturnsRisk(allHistories, params);
  
  // Vermögen bei Rentenbeginn (Index = savingsMonths - 1, da 0-basiert)
  const retirementIdx = Math.min(savingsMonths - 1, numMonths - 1);
  const retirementTotals = allHistories.map(h => h[retirementIdx]?.total || 0).sort((a, b) => a - b);
  const retirementMedian = percentile(retirementTotals, 50);
  
  // Erfolgsrate: Vermögen > Schwelle (real) am Ende UND keine Shortfalls während Entnahmephase
  // Shortfall = angeforderte Entnahme konnte nicht vollständig bedient werden
  
  let successCountStrict = 0;
  let successCountNominal = 0;
  let totalShortfallCount = 0; // Simulationen mit mindestens einem Shortfall
  let ansparShortfallCount = 0; // Shortfalls NUR in Ansparphase
  let entnahmeShortfallCount = 0; // Shortfalls NUR in Entnahmephase
  
  // Sinnvolle Shortfall-Toleranz: 1% der angeforderten Entnahme oder 50€, je nachdem was größer ist
  const SHORTFALL_TOLERANCE_PERCENT = 0.01;
  const SHORTFALL_TOLERANCE_ABS = 50;
  
  for (const history of allHistories) {
    const lastRow = history[history.length - 1];
    const endWealth = lastRow?.total || 0;
    const endInflation = lastRow?.cumulative_inflation || 1;
    // Schwelle ist REAL: 100€ in heutiger Kaufkraft = 100 * Inflation in nominalen €
    const successThresholdNominal = SUCCESS_THRESHOLD_REAL * endInflation;
    const hasPositiveEnd = endWealth > successThresholdNominal;
    
    // Prüfe auf Shortfalls GETRENNT nach Phase
    let hasAnsparShortfall = false;
    let hasEntnahmeShortfall = false;
    
    // Ansparphase (0 bis savingsMonths-1)
    for (let m = 0; m < savingsMonths && m < numMonths; m++) {
      if ((history[m]?.shortfall || 0) > SHORTFALL_TOLERANCE_ABS || 
          (history[m]?.tax_shortfall || 0) > SHORTFALL_TOLERANCE_ABS) {
        hasAnsparShortfall = true;
        break;
      }
    }
    
    // Entnahmephase (ab savingsMonths): Nutze relative Toleranz
    for (let m = savingsMonths; m < numMonths; m++) {
      const requested = history[m]?.withdrawal_requested || 0;
      const shortfall = history[m]?.shortfall || 0;
      const taxShortfall = history[m]?.tax_shortfall || 0;
      const tolerance = Math.max(SHORTFALL_TOLERANCE_ABS, requested * SHORTFALL_TOLERANCE_PERCENT);
      
      if (shortfall > tolerance || taxShortfall > tolerance) {
        hasEntnahmeShortfall = true;
        break;
      }
    }
    
    const hasShortfall = hasAnsparShortfall || hasEntnahmeShortfall;
    
    if (hasPositiveEnd) successCountNominal++;
    // Strenge Erfolgsrate: Nur Entnahme-Shortfalls zählen (Anspar-Shortfalls sind weniger kritisch)
    if (hasPositiveEnd && !hasEntnahmeShortfall) successCountStrict++;
    if (hasShortfall) totalShortfallCount++;
    if (hasAnsparShortfall) ansparShortfallCount++;
    if (hasEntnahmeShortfall) entnahmeShortfallCount++;
  }
  
  // Strenge Erfolgsrate: Keine Shortfalls UND positives Endvermögen (real)
  const successRate = (successCountStrict / numSims) * 100;
  // Nominale Erfolgsrate (Endvermögen > 100€ real, wie oben)
  const successRateNominal = (successCountNominal / numSims) * 100;
  // Shortfall-Quote: Anteil der Simulationen mit mindestens einem Shortfall
  const shortfallRate = (totalShortfallCount / numSims) * 100;
  
  // Kapitalerhalt (nominal): Endvermögen >= Vermögen bei Rentenbeginn
  let capitalPreservationCount = 0;
  for (let i = 0; i < numSims; i++) {
    const retirementWealth = allHistories[i][retirementIdx]?.total || 0;
    const endWealth = allHistories[i][numMonths - 1]?.total || 0;
    if (endWealth >= retirementWealth) capitalPreservationCount++;
  }
  const capitalPreservationRate = (capitalPreservationCount / numSims) * 100;
  
  // Kapitalerhalt (real/inflationsbereinigt): Kaufkraft erhalten
  // Vergleicht reale Werte: Endvermögen_real >= Rentenbeginn_real
  let capitalPreservationRealCount = 0;
  for (let i = 0; i < numSims; i++) {
    const retirementWealthReal = allHistories[i][retirementIdx]?.total_real || 0;
    const endWealthReal = allHistories[i][numMonths - 1]?.total_real || 0;
    if (endWealthReal >= retirementWealthReal) capitalPreservationRealCount++;
  }
  const capitalPreservationRateReal = (capitalPreservationRealCount / numSims) * 100;
  
  // Pleite-Risiko: Vermögen fällt NUR IN DER ENTNAHMEPHASE unter X% des 
  // Rentenbeginn-Vermögens ODER signifikanter Shortfall tritt in Entnahmephase auf.
  // Die Ansparphase wird ignoriert, da dort niedrige Vermögen normal sind.
  // RUIN_THRESHOLD_PERCENT wird oben aus mcOptions gelesen (Default: 10%)
  // GEGLÄTTET: Shortfall muss signifikant sein (analog zu Shortfall-Toleranz)
  let ruinCount = 0;
  for (const history of allHistories) {
    let isRuin = false;
    // Rentenbeginn-Vermögen als Referenz für diese Simulation
    const retirementWealthSim = history[retirementIdx]?.total || 0;
    const ruinThresholdAbsolute = retirementWealthSim * RUIN_THRESHOLD_PERCENT;
    
    // NUR Entnahmephase prüfen (ab savingsMonths)
    for (let m = savingsMonths; m < numMonths; m++) {
      // GEGLÄTTET: Nutze gleiche Toleranz wie bei Shortfall-Analyse
      // Ruin nur bei SIGNIFIKANTEM Shortfall (max(50€, 1% der angeforderten Entnahme))
      const requested = history[m]?.withdrawal_requested || 0;
      const shortfallTolerance = Math.max(SHORTFALL_TOLERANCE_ABS, requested * SHORTFALL_TOLERANCE_PERCENT);
      const shortfall = history[m]?.shortfall || 0;
      const taxShortfall = history[m]?.tax_shortfall || 0;
      const significantShortfall = shortfall > shortfallTolerance || taxShortfall > shortfallTolerance;
      
      // Nominal prüfen, da Referenz auch nominal ist
      if ((history[m]?.total || 0) < ruinThresholdAbsolute || significantShortfall) {
        isRuin = true;
        break;
      }
    }
    if (isRuin) ruinCount++;
  }
  const ruinProbability = (ruinCount / numSims) * 100;
  
  // Durchschnittliches Endvermögen
  const meanEnd = finalTotals.reduce((a, b) => a + b, 0) / numSims;
  
  // Durchschnittliche monatliche Rente und Gesamtentnahmen berechnen
  // Brutto = withdrawal (tatsächlich aus Vermögen entnommener Betrag)
  // Netto  = withdrawal_net (tatsächlich beim Nutzer ankommender Betrag nach Steuern)
  const avgMonthlyWithdrawalsGross = [];
  const avgMonthlyWithdrawalsGrossReal = [];
  const avgMonthlyWithdrawalsNet = [];
  const avgMonthlyWithdrawalsNetReal = [];
  const totalWithdrawalsGross = [];
  const totalWithdrawalsGrossReal = [];
  const totalWithdrawalsNet = [];
  const totalWithdrawalsNetReal = [];
  
  for (const history of allHistories) {
    // Filter auf Entnahmephase mit tatsächlicher Auszahlung > 0 (Brutto oder Netto)
    const entnahmeRows = history.filter(r => r.phase === "Entnahme" && (((r.withdrawal || 0) > 0) || ((r.withdrawal_net || 0) > 0)));
    if (!entnahmeRows.length) continue;

    // Brutto: tatsächliche Entnahme aus Vermögen (withdrawal)
    const avgWithdrawalGross = entnahmeRows.reduce((sum, r) => sum + (r.withdrawal || 0), 0) / entnahmeRows.length;
    const avgWithdrawalGrossReal = entnahmeRows.reduce((sum, r) => sum + (r.withdrawal_real || 0), 0) / entnahmeRows.length;
    avgMonthlyWithdrawalsGross.push(avgWithdrawalGross);
    avgMonthlyWithdrawalsGrossReal.push(avgWithdrawalGrossReal);
    
    const totalGross = history.reduce((sum, r) => sum + (r.withdrawal || 0), 0);
    const totalGrossReal = history.reduce((sum, r) => sum + (r.withdrawal_real || r.withdrawal || 0), 0);
    totalWithdrawalsGross.push(totalGross);
    totalWithdrawalsGrossReal.push(totalGrossReal);

    // Netto: tatsächlich ankommende Rente (withdrawal_net)
    const avgWithdrawalNet = entnahmeRows.reduce((sum, r) => sum + (r.withdrawal_net || 0), 0) / entnahmeRows.length;
    const avgWithdrawalNetReal = entnahmeRows.reduce((sum, r) => sum + (r.withdrawal_net_real || 0), 0) / entnahmeRows.length;
    avgMonthlyWithdrawalsNet.push(avgWithdrawalNet);
    avgMonthlyWithdrawalsNetReal.push(avgWithdrawalNetReal);

    const totalNet = history.reduce((sum, r) => sum + (r.withdrawal_net || 0), 0);
    const totalNetReal = history.reduce((sum, r) => sum + (r.withdrawal_net_real || r.withdrawal_net || 0), 0);
    totalWithdrawalsNet.push(totalNet);
    totalWithdrawalsNetReal.push(totalNetReal);
  }
  
  avgMonthlyWithdrawalsGross.sort((a, b) => a - b);
  avgMonthlyWithdrawalsGrossReal.sort((a, b) => a - b);
  avgMonthlyWithdrawalsNet.sort((a, b) => a - b);
  avgMonthlyWithdrawalsNetReal.sort((a, b) => a - b);
  totalWithdrawalsGross.sort((a, b) => a - b);
  totalWithdrawalsGrossReal.sort((a, b) => a - b);
  totalWithdrawalsNet.sort((a, b) => a - b);
  totalWithdrawalsNetReal.sort((a, b) => a - b);
  
  const medianAvgMonthlyWithdrawalGross = avgMonthlyWithdrawalsGross.length > 0 ? percentile(avgMonthlyWithdrawalsGross, 50) : 0;
  const medianAvgMonthlyWithdrawalGrossReal = avgMonthlyWithdrawalsGrossReal.length > 0 ? percentile(avgMonthlyWithdrawalsGrossReal, 50) : 0;
  const medianAvgMonthlyWithdrawalNet = avgMonthlyWithdrawalsNet.length > 0 ? percentile(avgMonthlyWithdrawalsNet, 50) : 0;
  const medianAvgMonthlyWithdrawalNetReal = avgMonthlyWithdrawalsNetReal.length > 0 ? percentile(avgMonthlyWithdrawalsNetReal, 50) : 0;
  const medianTotalWithdrawalsGross = totalWithdrawalsGross.length > 0 ? percentile(totalWithdrawalsGross, 50) : 0;
  const medianTotalWithdrawalsGrossReal = totalWithdrawalsGrossReal.length > 0 ? percentile(totalWithdrawalsGrossReal, 50) : 0;
  const medianTotalWithdrawalsNet = totalWithdrawalsNet.length > 0 ? percentile(totalWithdrawalsNet, 50) : 0;
  const medianTotalWithdrawalsNetReal = totalWithdrawalsNetReal.length > 0 ? percentile(totalWithdrawalsNetReal, 50) : 0;
  
  // Kaufkraftverlust berechnen (basierend auf Inflationsrate und Gesamtlaufzeit)
  const totalMonths = numMonths;
  const inflationRatePa = params.inflation_rate_pa || 2;
  const cumulativeInflation = Math.pow(1 + inflationRatePa / 100, totalMonths / MONTHS_PER_YEAR);
  const purchasingPowerLoss = (1 - 1 / cumulativeInflation) * 100;
  
  // KORRIGIERT: Reale Rendite p.a. mit Modified Dietz Methode
  // Berücksichtigt laufende Einzahlungen zeitgewichtet, nicht nur Startvermögen
  // KORRIGIERT: Nutze cost_basis für Start-ETF wenn angegeben (konsistent mit renderStats)
  const effectiveStartEtfCost = (params.start_etf_cost_basis > 0) 
    ? params.start_etf_cost_basis 
    : (params.start_etf || 0);
  const startTotal = params.start_savings + effectiveStartEtfCost;
  const savingsYearsNum = params.savings_years || 1;
  const monthlySavings = params.monthly_savings || 0;
  const monthlyEtf = params.monthly_etf || 0;
  const monthlyContrib = monthlySavings + monthlyEtf;
  
  // Modified Dietz: R = (V_end - V_start - CF_total) / (V_start + CF_weighted)
  // CF_weighted = Sum(CF_i * (T - t_i) / T), wobei T = Gesamtmonate, t_i = Monat der Einzahlung
  let realReturnPa = 0;
  if (savingsMonths > 0) {
    // Gesamte Cashflows (vereinfacht: gleiche monatliche Einzahlung)
    const totalContributions = monthlyContrib * savingsMonths;
    
    // Zeitgewichtete Cashflows: Jede Einzahlung am Anfang von Monat m hat Gewicht (savingsMonths - m) / savingsMonths
    // Für gleichmäßige Einzahlungen: Summe = monthlyContrib * Sum((T-m)/T) für m=0..T-1
    // = monthlyContrib * (T + T-1 + ... + 1) / T = monthlyContrib * (T+1)/2
    // Aber bei Einzahlung am Monatsende: Gewicht = (T - m - 1) / T
    // Approximation: Durchschnittliches Gewicht ≈ 0.5 (Mitte der Periode)
    const weightedContributions = totalContributions * 0.5;
    
    // Modified Dietz Return (nicht annualisiert)
    const denominator = startTotal + weightedContributions;
    if (denominator > 0 && retirementMedian > 0) {
      const modifiedDietzReturn = (retirementMedian - startTotal - totalContributions) / denominator;
      
      // Annualisieren: (1 + R_total)^(1/years) - 1
      // Aber Modified Dietz gibt bereits eine "return on invested capital" Kennzahl
      // Für konsistente Annualisierung: Geometrische Approximation
      const totalReturn = 1 + modifiedDietzReturn;
      const nominalCagrMD = totalReturn > 0 
        ? Math.pow(totalReturn, 1 / savingsYearsNum) - 1 
        : 0;
      
      // Reale Rendite = (1 + nominal) / (1 + inflation) - 1
      realReturnPa = ((1 + nominalCagrMD) / (1 + inflationRatePa / 100) - 1) * 100;
    }
  }
  
  // Input-basierte theoretische Rendite zum Vergleich
  const theoreticalNominalPa = (params.etf_rate_pa || 6) - (params.etf_ter_pa || 0);
  const theoreticalRealPa = ((1 + theoreticalNominalPa / 100) / (1 + inflationRatePa / 100) - 1) * 100;
  
  // Perzentile pro Monat berechnen (nominal und real)
  const percentiles = {
    p5: [], p10: [], p25: [], p50: [], p75: [], p90: [], p95: []
  };
  const percentilesReal = {
    p5: [], p10: [], p25: [], p50: [], p75: [], p90: [], p95: []
  };
  
  for (let month = 0; month < numMonths; month++) {
    const monthTotals = allHistories.map(h => h[month]?.total || 0).sort((a, b) => a - b);
    const monthTotalsReal = allHistories.map(h => h[month]?.total_real || 0).sort((a, b) => a - b);
    
    percentiles.p5.push(percentile(monthTotals, 5));
    percentiles.p10.push(percentile(monthTotals, 10));
    percentiles.p25.push(percentile(monthTotals, 25));
    percentiles.p50.push(percentile(monthTotals, 50));
    percentiles.p75.push(percentile(monthTotals, 75));
    percentiles.p90.push(percentile(monthTotals, 90));
    percentiles.p95.push(percentile(monthTotals, 95));
    
    percentilesReal.p5.push(percentile(monthTotalsReal, 5));
    percentilesReal.p10.push(percentile(monthTotalsReal, 10));
    percentilesReal.p25.push(percentile(monthTotalsReal, 25));
    percentilesReal.p50.push(percentile(monthTotalsReal, 50));
    percentilesReal.p75.push(percentile(monthTotalsReal, 75));
    percentilesReal.p90.push(percentile(monthTotalsReal, 90));
    percentilesReal.p95.push(percentile(monthTotalsReal, 95));
  }
  
  // Jahre-Array für X-Achse
  const months = allHistories[0]?.map(h => h.month) || [];
  
  return {
    iterations: numSims,
    successRate, // Strenge Rate: Keine Entnahme-Shortfalls UND positives Endvermögen
    successRateNominal, // Nur positives Endvermögen (alte Definition)
    shortfallRate, // Anteil mit mindestens einem Shortfall (gesamt)
    ansparShortfallRate: (ansparShortfallCount / numSims) * 100,
    entnahmeShortfallRate: (entnahmeShortfallCount / numSims) * 100,
    finalTotals,
    finalTotalsReal,
    percentiles,
    percentilesReal,
    months,
    medianEnd: percentile(finalTotals, 50),
    p10End: percentile(finalTotals, 10),
    p90End: percentile(finalTotals, 90),
    p5End: percentile(finalTotals, 5),
    p25End: percentile(finalTotals, 25),
    p75End: percentile(finalTotals, 75),
    p95End: percentile(finalTotals, 95),
    savingsYears: params.savings_years,
    // Zusätzliche Metriken
    retirementMedian,
    capitalPreservationRate,
    capitalPreservationRateReal, // Inflationsbereinigte Kapitalerhalt-Rate
    ruinProbability,
    meanEnd,
    // Inflationsbereinigte Werte (real)
    medianEndReal: percentile(finalTotalsReal, 50),
    p10EndReal: percentile(finalTotalsReal, 10),
    p90EndReal: percentile(finalTotalsReal, 90),
    p5EndReal: percentile(finalTotalsReal, 5),
    p25EndReal: percentile(finalTotalsReal, 25),
    p75EndReal: percentile(finalTotalsReal, 75),
    p95EndReal: percentile(finalTotalsReal, 95),
    meanEndReal: finalTotalsReal.reduce((a, b) => a + b, 0) / numSims,
    retirementMedianReal: percentile(
      allHistories.map(h => h[retirementIdx]?.total_real || 0).sort((a, b) => a - b), 
      50
    ),
    // Entnahme-Statistiken
    // Rückwärtskompatible Felder (Netto-Werte)
    medianAvgMonthlyWithdrawal: medianAvgMonthlyWithdrawalNet,
    medianAvgMonthlyWithdrawalReal: medianAvgMonthlyWithdrawalNetReal,
    medianTotalWithdrawals: medianTotalWithdrawalsNet,
    medianTotalWithdrawalsReal: medianTotalWithdrawalsNetReal,
    // Explizite Trennung Netto / Brutto
    medianAvgMonthlyWithdrawalNet,
    medianAvgMonthlyWithdrawalNetReal,
    medianTotalWithdrawalsNet,
    medianTotalWithdrawalsNetReal,
    medianAvgMonthlyWithdrawalGross,
    medianAvgMonthlyWithdrawalGrossReal,
    medianTotalWithdrawalsGross,
    medianTotalWithdrawalsGrossReal,
    purchasingPowerLoss,
    realReturnPa,
    // Verlusttopf & Freibetrag (Endstände, Median über alle Simulationen)
    medianFinalLossPot: percentile(finalLossPot, 50),
    medianFinalYearlyFreibetrag: percentile(finalYearlyFreibetrag, 50),
    // Sequence-of-Returns Risk
    sorr,
  };
}

function renderMonteCarloStats(results) {
  const successEl = document.getElementById("mc-success-rate");
  // Zeige strenge Erfolgsrate (keine Shortfalls)
  successEl.textContent = `${results.successRate.toFixed(1)}%`;
  
  // Soft-Erfolgsrate anzeigen (nur Endvermögen, ohne Shortfall-Prüfung)
  const softSuccessEl = document.getElementById("mc-success-rate-soft");
  if (softSuccessEl) {
    softSuccessEl.textContent = `${results.successRateNominal.toFixed(1)}%`;
  }
  
  // Dynamischer Erfolgsrate-Hinweis
  const successHintEl = document.getElementById("mc-success-hint");
  if (successHintEl && results.mcOptions) {
    const threshold = results.mcOptions.successThreshold ?? 100;
    successHintEl.textContent = `Keine Entnahme-Shortfalls & Endvermögen > ${threshold}€ real`;
  }
  
  // Shortfall-Rate anzeigen (Entnahmephase ist kritischer, daher Fokus darauf)
  const shortfallEl = document.getElementById("mc-shortfall-rate");
  if (shortfallEl) {
    // Zeige primär Entnahme-Shortfalls, da diese kritischer sind
    const entnahmeRate = results.entnahmeShortfallRate || 0;
    const ansparRate = results.ansparShortfallRate || 0;
    shortfallEl.textContent = `${entnahmeRate.toFixed(1)}%`;
    // Tooltip mit Details (gleiche Info auch auf der Hint-Zeile anzeigen)
    const shortfallDetails = [
      `Entnahme: ${entnahmeRate.toFixed(1)}%`,
      `Anspar: ${ansparRate.toFixed(1)}%`,
      "Shortfall = Auszahlung mind. 1% oder 50€ unter Ziel (Anspar: >50€ Unterdeckung)"
    ].join("\n");
    shortfallEl.removeAttribute("title"); // Verhindert doppelten Browser-Tooltip
    shortfallEl.setAttribute("aria-label", shortfallDetails);
    shortfallEl.setAttribute("data-tooltip", shortfallDetails);
    const shortfallHintEl = shortfallEl.closest(".stat-card")?.querySelector(".stat-hint");
    if (shortfallHintEl) {
      shortfallHintEl.removeAttribute("title"); // Verhindert doppelten Browser-Tooltip
      shortfallHintEl.setAttribute("aria-label", shortfallDetails);
      shortfallHintEl.setAttribute("data-tooltip", shortfallDetails);
    }
    shortfallEl.classList.remove("stat-value--success", "stat-value--warning", "stat-value--danger");
    if (entnahmeRate <= 5) {
      shortfallEl.classList.add("stat-value--success");
    } else if (entnahmeRate <= 20) {
      shortfallEl.classList.add("stat-value--warning");
    } else {
      shortfallEl.classList.add("stat-value--danger");
    }
  }
  
  // Nominale Werte
  document.getElementById("mc-median-end").textContent = formatCurrency(results.medianEnd);
  document.getElementById("mc-range-end").textContent = 
    `${formatCurrency(results.p10End)} - ${formatCurrency(results.p90End)}`;
  document.getElementById("mc-worst-case").textContent = formatCurrency(results.p25End);
  document.getElementById("mc-best-case").textContent = formatCurrency(results.p75End);
  document.getElementById("mc-iterations-done").textContent = nf0.format(results.iterations);
  
  // Inflationsbereinigte Werte (real)
  document.getElementById("mc-median-end-real").textContent = formatCurrency(results.medianEndReal);
  document.getElementById("mc-range-end-real").textContent = 
    `${formatCurrency(results.p10EndReal)} - ${formatCurrency(results.p90EndReal)}`;
  document.getElementById("mc-worst-case-real").textContent = formatCurrency(results.p25EndReal);
  document.getElementById("mc-best-case-real").textContent = formatCurrency(results.p75EndReal);
  
  // Zusätzliche Metriken - Nominale Werte
  document.getElementById("mc-retirement-wealth").textContent = formatCurrency(results.retirementMedian);
  document.getElementById("mc-capital-preservation").textContent = `${results.capitalPreservationRate.toFixed(1)}%`;
  document.getElementById("mc-mean-end").textContent = formatCurrency(results.meanEnd);
  
  // Entnahme-Statistiken (nominal)
  const avgMonthlyEl = document.getElementById("mc-avg-monthly-withdrawal");
  if (avgMonthlyEl) {
    const net = (results.medianAvgMonthlyWithdrawalNet ?? results.medianAvgMonthlyWithdrawal) || 0;
    const gross = (results.medianAvgMonthlyWithdrawalGross ?? results.medianAvgMonthlyWithdrawal) || 0;
    if (gross > 0 && Math.abs(gross - net) > 0.01) {
      avgMonthlyEl.textContent = `Netto: ${formatCurrency(net)} · Brutto: ${formatCurrency(gross)}`;
    } else {
      // Fallback: nur ein Wert oder beide (nahezu) identisch
      avgMonthlyEl.textContent = formatCurrency(net || gross || 0);
    }
  }
  const totalWithdrawalsEl = document.getElementById("mc-total-withdrawals");
  if (totalWithdrawalsEl) {
    const netTotal = (results.medianTotalWithdrawalsNet ?? results.medianTotalWithdrawals) || 0;
    const grossTotal = (results.medianTotalWithdrawalsGross ?? results.medianTotalWithdrawals) || 0;
    if (grossTotal > 0 && Math.abs(grossTotal - netTotal) > 0.01) {
      totalWithdrawalsEl.textContent = `Netto: ${formatCurrency(netTotal)} · Brutto: ${formatCurrency(grossTotal)}`;
    } else {
      totalWithdrawalsEl.textContent = formatCurrency(netTotal || grossTotal || 0);
    }
  }
  
  // Inflationsbereinigte Werte (real)
  const retirementRealEl = document.getElementById("mc-retirement-wealth-real");
  if (retirementRealEl) {
    retirementRealEl.textContent = formatCurrency(results.retirementMedianReal);
  }
  const avgMonthlyRealEl = document.getElementById("mc-avg-monthly-withdrawal-real");
  if (avgMonthlyRealEl) {
    const netReal = (results.medianAvgMonthlyWithdrawalNetReal ?? results.medianAvgMonthlyWithdrawalReal) || 0;
    const grossReal = (results.medianAvgMonthlyWithdrawalGrossReal ?? results.medianAvgMonthlyWithdrawalReal) || 0;
    if (grossReal > 0 && Math.abs(grossReal - netReal) > 0.01) {
      avgMonthlyRealEl.textContent = `Netto: ${formatCurrency(netReal)} · Brutto: ${formatCurrency(grossReal)}`;
    } else {
      avgMonthlyRealEl.textContent = formatCurrency(netReal || grossReal || 0);
    }
  }
  const totalWithdrawalsRealEl = document.getElementById("mc-total-withdrawals-real");
  if (totalWithdrawalsRealEl) {
    const netTotalReal = (results.medianTotalWithdrawalsNetReal ?? results.medianTotalWithdrawalsReal) || 0;
    const grossTotalReal = (results.medianTotalWithdrawalsGrossReal ?? results.medianTotalWithdrawalsReal) || 0;
    if (grossTotalReal > 0 && Math.abs(grossTotalReal - netTotalReal) > 0.01) {
      totalWithdrawalsRealEl.textContent = `Netto: ${formatCurrency(netTotalReal)} · Brutto: ${formatCurrency(grossTotalReal)}`;
    } else {
      totalWithdrawalsRealEl.textContent = formatCurrency(netTotalReal || grossTotalReal || 0);
    }
  }
  const purchasingPowerLossEl = document.getElementById("mc-purchasing-power-loss");
  if (purchasingPowerLossEl) {
    purchasingPowerLossEl.textContent = `${nf2.format(results.purchasingPowerLoss)} %`;
  }
  const realReturnPaEl = document.getElementById("mc-real-return-pa");
  if (realReturnPaEl) {
    realReturnPaEl.textContent = `${nf2.format(results.realReturnPa)} %`;
  }
  
  // Risikokennzahlen für Real-Ansicht (inflationsbereinigt)
  const capitalPreservationRealEl = document.getElementById("mc-capital-preservation-real");
  if (capitalPreservationRealEl) {
    // Zeigt echte inflationsbereinigte Kapitalerhalt-Rate
    capitalPreservationRealEl.textContent = `${results.capitalPreservationRateReal.toFixed(1)}%`;
    capitalPreservationRealEl.classList.remove("stat-value--success", "stat-value--warning", "stat-value--danger");
    if (results.capitalPreservationRateReal >= 50) {
      capitalPreservationRealEl.classList.add("stat-value--success");
    } else if (results.capitalPreservationRateReal >= 25) {
      capitalPreservationRealEl.classList.add("stat-value--warning");
    }
  }
  const ruinProbabilityRealEl = document.getElementById("mc-ruin-probability-real");
  if (ruinProbabilityRealEl) {
    ruinProbabilityRealEl.textContent = `${results.ruinProbability.toFixed(1)}%`;
  }
  
  // Pleite-Risiko mit Farbcodierung
  const ruinEl = document.getElementById("mc-ruin-probability");
  ruinEl.textContent = `${results.ruinProbability.toFixed(1)}%`;
  ruinEl.classList.remove("stat-value--success", "stat-value--warning", "stat-value--danger");
  if (results.ruinProbability <= 5) {
    ruinEl.classList.add("stat-value--success");
  } else if (results.ruinProbability <= 15) {
    ruinEl.classList.add("stat-value--warning");
  } else {
    ruinEl.classList.add("stat-value--danger");
  }
  
  // Kapitalerhalt mit Farbcodierung
  const preserveEl = document.getElementById("mc-capital-preservation");
  preserveEl.classList.remove("stat-value--success", "stat-value--warning", "stat-value--danger");
  if (results.capitalPreservationRate >= 50) {
    preserveEl.classList.add("stat-value--success");
  } else if (results.capitalPreservationRate >= 25) {
    preserveEl.classList.add("stat-value--warning");
  }
  
  // Farbige Erfolgsrate (für neue Highlight-Karte)
  successEl.classList.remove("success-high", "success-medium", "success-low");
  if (results.successRate >= 95) {
    successEl.classList.add("success-high");
  } else if (results.successRate >= 80) {
    successEl.classList.add("success-medium");
  } else {
    successEl.classList.add("success-low");
  }
  
  // Sequence-of-Returns Risk Statistiken
  if (results.sorr) {
    const sorr = results.sorr;
    
    // SoRR Score
    const sorrScoreEl = document.getElementById("mc-sorr-score");
    if (sorrScoreEl) {
      sorrScoreEl.textContent = `${sorr.sorRiskScore.toFixed(0)}%`;
      sorrScoreEl.classList.remove("stat-value--success", "stat-value--warning", "stat-value--danger");
      if (sorr.sorRiskScore <= 50) {
        sorrScoreEl.classList.add("stat-value--success");
      } else if (sorr.sorRiskScore <= 150) {
        sorrScoreEl.classList.add("stat-value--warning");
      } else {
        sorrScoreEl.classList.add("stat-value--danger");
      }
    }
    
    // Früher Crash Impact
    const earlyBadEl = document.getElementById("mc-sorr-early-bad");
    if (earlyBadEl) {
      earlyBadEl.textContent = `${sorr.earlyBadImpact.toFixed(0)}%`;
    }
    
    // Früher Boom Impact
    const earlyGoodEl = document.getElementById("mc-sorr-early-good");
    if (earlyGoodEl) {
      earlyGoodEl.textContent = `+${sorr.earlyGoodImpact.toFixed(0)}%`;
    }
    
    // Korrelation
    const corrEl = document.getElementById("mc-sorr-correlation");
    if (corrEl) {
      corrEl.textContent = `${(sorr.correlationEarlyReturns * 100).toFixed(0)}%`;
    }
    
    // Worst/Best Sequence Endvermögen
    const worstSeqEl = document.getElementById("mc-sorr-worst-seq");
    if (worstSeqEl) {
      worstSeqEl.textContent = formatCurrency(sorr.worstSequenceEnd);
    }
    
    const bestSeqEl = document.getElementById("mc-sorr-best-seq");
    if (bestSeqEl) {
      bestSeqEl.textContent = formatCurrency(sorr.bestSequenceEnd);
    }
    
    // Vulnerabilitätsfenster
    const vulnEl = document.getElementById("mc-sorr-vulnerability");
    if (vulnEl) {
      vulnEl.textContent = `Jahr 1-${sorr.vulnerabilityWindow}`;
    }
    
    // Dynamische SoRR-Erklärung mit einfachen Texten
    const sorrExplEl = document.getElementById("mc-sorr-explanation-text");
    if (sorrExplEl) {
      const crashImpact = Math.abs(sorr.earlyBadImpact).toFixed(0);
      const boomImpact = sorr.earlyGoodImpact.toFixed(0);
      const corrPct = (sorr.correlationEarlyReturns * 100).toFixed(0);
      const vulnYears = sorr.vulnerabilityWindow;
      
      let riskLevel = "moderat";
      if (sorr.sorRiskScore > 150) riskLevel = "hoch";
      else if (sorr.sorRiskScore > 75) riskLevel = "erhöht";
      else if (sorr.sorRiskScore <= 50) riskLevel = "gering";
      
      sorrExplEl.innerHTML = `
        <strong>Interpretation:</strong> Das Sequence-of-Returns-Risiko ist <strong>${riskLevel}</strong>. 
        Ein früher Crash in den ersten ${vulnYears} Jahren reduziert dein Endvermögen im Schnitt um <strong>${crashImpact}%</strong> 
        gegenüber einem durchschnittlichen Verlauf. Umgekehrt führt ein früher Boom zu <strong>+${boomImpact}%</strong> mehr Endvermögen. 
        Die Korrelation zwischen frühen Renditen und Endergebnis beträgt ${corrPct}% – 
        ${corrPct > 60 ? "die ersten Jahre sind entscheidend für deinen Erfolg." : 
          corrPct > 30 ? "die ersten Jahre haben spürbaren Einfluss." : 
          "die ersten Jahre haben nur begrenzten Einfluss."}
      `;
    }
  }
  
  // Badge im Tab anzeigen
  if (mcBadgeEl) {
    mcBadgeEl.style.display = "inline";
  }
  
  // Verbrauchsjahre-Info anzeigen (wann ist Vermögen aufgebraucht)
  const depletionInfoEl = document.getElementById("mc-depletion-info");
  const depletionTextEl = document.getElementById("mc-depletion-text");
  if (depletionInfoEl && depletionTextEl && lastParams) {
    const depletion = calculateDepletionYears(results, lastParams);
    
    // Reset CSS-Klasse
    depletionInfoEl.classList.remove("mc-depletion-info--warning");
    
    const { p5DepletionYear, p10DepletionYear } = depletion;

    if (p5DepletionYear || p10DepletionYear) {
      const parts = [];

      if (p10DepletionYear) {
        parts.push(`In den <strong>schlechtesten 10%</strong> der Szenarien ist das Vermögen nach <strong>~${p10DepletionYear} Jahren</strong> in der Entnahmephase aufgebraucht.`);
      }

      if (p5DepletionYear) {
        parts.push(`In den <strong>extremsten 5%</strong> der Szenarien ist das Vermögen bereits nach <strong>~${p5DepletionYear} Jahren</strong> aufgebraucht.`);
      }

      // Nur 10%-Info (kein 5%-Wert): eher "Warnung" statt Extremfall → gelbe Variante
      if (p10DepletionYear && !p5DepletionYear) {
        depletionInfoEl.classList.add("mc-depletion-info--warning");
      }

      depletionTextEl.innerHTML = parts.join("<br>");
      depletionInfoEl.style.display = "flex";
    } else {
      depletionInfoEl.style.display = "none";
    }
  }
}

function renderMonteCarloGraph(results) {
  if (!mcGraphCanvas) return;
  
  const ctx = mcGraphCanvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = mcGraphCanvas.clientWidth || mcGraphCanvas.parentElement?.clientWidth || 800;
  const height = mcGraphCanvas.clientHeight || 320;
  
  mcGraphCanvas.width = width * dpr;
  mcGraphCanvas.height = height * dpr;
  mcGraphCanvas.style.width = `${width}px`;
  mcGraphCanvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  
  const { percentiles, percentilesReal, months, savingsYears } = results;
  if (!months.length) return;
  
  // Wähle zwischen nominalen und realen Perzentilen basierend auf Toggle
  const activePercentiles = mcUseRealValues && percentilesReal ? percentilesReal : percentiles;
  
  const padX = 60;
  const padY = 50;
  const xDenom = Math.max(months.length - 1, 1);
  
  // Prüfe ob P5 oder P10 Nullen enthalten (echte Pleite-Szenarien)
  const hasZeroScenarios = activePercentiles.p5.some(v => v <= 0) || activePercentiles.p10.some(v => v <= 0);
  
  // Log-Skala ist immer erlaubt - Nullen werden auf Minimalwert geklemmt
  const effectiveLogScale = mcUseLogScale;
  
  // Bei Log-Skala: Minimalwert für Darstellung (Nullen werden hierauf geklemmt)
  const LOG_FLOOR = 1; // 1€ als Boden für Log-Skala
  
  // Min/Max für beide Skalierungen
  const positiveP5 = activePercentiles.p5.filter(v => v > 0);
  const minVal = effectiveLogScale 
    ? Math.max(LOG_FLOOR, positiveP5.length > 0 ? Math.min(...positiveP5) : LOG_FLOOR)
    : 0; // Lineare Skala beginnt bei 0
  const maxVal = Math.max(minVal * 10, ...activePercentiles.p95);
  
  let toXY;
  
  if (effectiveLogScale) {
    // Logarithmische Skala
    const logMin = Math.log10(minVal);
    const logMax = Math.log10(maxVal);
    
    toXY = (idx, val) => {
      const x = padX + (idx / xDenom) * (width - 2 * padX);
      const clampedVal = Math.max(minVal, val);
      const logVal = Math.log10(clampedVal);
      const yNorm = (logVal - logMin) / (logMax - logMin);
      const y = height - padY - yNorm * (height - 2 * padY);
      return [x, y];
    };
  } else {
    // Lineare Skala (zeigt 0 korrekt an)
    toXY = (idx, val) => {
      const x = padX + (idx / xDenom) * (width - 2 * padX);
      const y = height - padY - (val / maxVal) * (height - 2 * padY);
      return [x, y];
    };
  }
  
  // Achsen
  ctx.strokeStyle = "#8b96a9";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, height - padY);
  ctx.lineTo(width - padX, height - padY);
  ctx.moveTo(padX, height - padY);
  ctx.lineTo(padX, padY);
  ctx.stroke();
  
  // Y Hilfslinien
  ctx.font = "12px 'Segoe UI', sans-serif";
  ctx.fillStyle = "#94a3b8";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  
  if (effectiveLogScale) {
    // Logarithmische Schritte
    const logMin = Math.log10(minVal);
    const logSteps = [];
    let step = Math.pow(10, Math.floor(logMin));
    while (step <= maxVal) {
      if (step >= minVal) logSteps.push(step);
      if (step * 2 >= minVal && step * 2 <= maxVal) logSteps.push(step * 2);
      if (step * 5 >= minVal && step * 5 <= maxVal) logSteps.push(step * 5);
      step *= 10;
    }
    
    for (const val of logSteps) {
      const [, y] = toXY(0, val);
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(width - padX, y);
      ctx.stroke();
      ctx.fillStyle = "#94a3b8";
      const label = val >= 1000000 ? `${(val / 1000000).toFixed(val % 1000000 === 0 ? 0 : 1)}M` : `${Math.round(val / 1000)}k`;
      ctx.fillText(label, padX - 8, y);
    }
  } else {
    // Lineare Schritte
    for (let i = 0; i <= Y_AXIS_STEPS; i++) {
      const val = maxVal * (i / Y_AXIS_STEPS);
      const [, y] = toXY(0, val);
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(width - padX, y);
      ctx.stroke();
      ctx.fillStyle = "#94a3b8";
      const label = val >= 1000000 ? `${(val / 1000000).toFixed(1)}M` : `${Math.round(val / 1000)}k`;
      ctx.fillText(label, padX - 8, y);
    }
  }
  
  // X Labels (Jahre)
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const lastYear = Math.ceil(months.length / MONTHS_PER_YEAR);
  for (let year = 1; year <= lastYear; year += 1) {
    const idx = Math.min(year * MONTHS_PER_YEAR - 1, months.length - 1);
    const [x] = toXY(idx, 0);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.moveTo(x, height - padY);
    ctx.lineTo(x, height - padY + 6);
    ctx.stroke();
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(String(year), x, height - padY + 8);
  }
  
  // Füllfunktion für Bänder
  const fillBand = (lower, upper, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    
    // Obere Linie
    for (let i = 0; i < months.length; i++) {
      const [x, y] = toXY(i, upper[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    
    // Untere Linie (rückwärts)
    for (let i = months.length - 1; i >= 0; i--) {
      const [x, y] = toXY(i, lower[i]);
      ctx.lineTo(x, y);
    }
    
    ctx.closePath();
    ctx.fill();
  };
  
  // Zeichne Bänder (von außen nach innen) - verwende activePercentiles
  fillBand(activePercentiles.p10, activePercentiles.p90, "rgba(99, 102, 241, 0.15)"); // 80% Band
  fillBand(activePercentiles.p25, activePercentiles.p75, "rgba(99, 102, 241, 0.25)"); // 50% Band
  
  // Individuelle Pfade (falls aktiviert)
  if (results.showIndividual && results.allHistories?.length) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 0.5;
    
    for (const history of results.allHistories) {
      ctx.beginPath();
      history.forEach((row, i) => {
        // Verwende real oder nominal basierend auf Toggle
        const value = mcUseRealValues ? (row.total_real || row.total) : row.total;
        const [x, y] = toXY(i, value);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }
  
  // Median-Linie
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  activePercentiles.p50.forEach((val, i) => {
    const [x, y] = toXY(i, val);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  
  // 5%/95% Linien (gestrichelt)
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(239, 68, 68, 0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  activePercentiles.p5.forEach((val, i) => {
    const [x, y] = toXY(i, val);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  
  ctx.strokeStyle = "rgba(34, 197, 94, 0.6)";
  ctx.beginPath();
  activePercentiles.p95.forEach((val, i) => {
    const [x, y] = toXY(i, val);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  
  // Ruin-Marker: Markiere Zeitpunkte, an denen P5 oder P10 auf 0/nahe 0 fallen
  // Damit Ruin trotz Log-Skala sichtbar bleibt
  if (effectiveLogScale && hasZeroScenarios) {
    ctx.fillStyle = "rgba(239, 68, 68, 0.7)"; // Rot für Ruin
    ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
    ctx.lineWidth = 2;
    
    activePercentiles.p5.forEach((val, i) => {
      if (val <= LOG_FLOOR) {
        const [x, y] = toXY(i, LOG_FLOOR);
        // Dreieck-Marker nach unten zeigend (Warnsymbol)
        ctx.beginPath();
        ctx.moveTo(x, y + 6);
        ctx.lineTo(x - 5, y - 4);
        ctx.lineTo(x + 5, y - 4);
        ctx.closePath();
        ctx.fill();
      }
    });
    
    // Hinweis-Text bei erstem Ruin-Punkt
    const firstRuinIdx = activePercentiles.p5.findIndex(v => v <= LOG_FLOOR);
    if (firstRuinIdx >= 0) {
      const [x, y] = toXY(firstRuinIdx, LOG_FLOOR);
      ctx.font = "11px 'Segoe UI', sans-serif";
      ctx.fillStyle = "rgba(239, 68, 68, 0.9)";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText("⚠ Pleite-Szenarien", x + 8, y - 2);
    }
  }
  
  // Phasen-Trennung
  const switchIdx = savingsYears * MONTHS_PER_YEAR;
  if (switchIdx > 0 && switchIdx < months.length) {
    const [sx] = toXY(switchIdx, 0);
    ctx.strokeStyle = "#6b7280";
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, padY);
    ctx.lineTo(sx, height - padY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("Entnahme →", sx - 6, padY + 20);
  }
  
  mcGraphState = { results, padX, padY, width, height, maxVal, xDenom };
}

// ============ MONTE-CARLO WEB WORKER ============

let mcWorker = null;
let mcWorkerRunning = false;

/**
 * Initialisiert den MC-Worker
 */
function initMcWorker() {
  if (mcWorker) {
    mcWorker.terminate();
  }
  
  try {
    mcWorker = new Worker('mc-worker.js');
    return true;
  } catch (err) {
    console.warn('MC-Worker konnte nicht initialisiert werden, nutze Fallback:', err);
    return false;
  }
}

/**
 * Führt MC-Simulation im Worker aus
 */
function runMonteCarloWithWorker(params, iterations, volatility, showIndividual, mcOptions) {
  return new Promise((resolve, reject) => {
    if (!initMcWorker()) {
      // Fallback auf synchrone Simulation
      console.warn('Fallback auf Main-Thread Monte-Carlo');
      runMonteCarloSimulation(params, iterations, volatility, showIndividual, mcOptions)
        .then(resolve)
        .catch(reject);
      return;
    }
    
    mcWorkerRunning = true;
    
    mcWorker.onmessage = function(e) {
      const { type, current, total, percent, results, message } = e.data;
      
      switch (type) {
        case 'progress':
          mcProgressEl.value = percent;
          mcProgressTextEl.textContent = `${current} / ${total} (${percent}%)`;
          break;
          
        case 'complete':
          mcWorkerRunning = false;
          
          // Ergebnisse verarbeiten
          results.showIndividual = showIndividual;
          lastMcResults = results;
          
          // UI aktualisieren
          renderMonteCarloStats(results);
          renderMonteCarloGraph(results);
          
          mcProgressTextEl.textContent = "Fertig!";
          resolve(results);
          break;
          
        case 'error':
          mcWorkerRunning = false;
          reject(new Error(message));
          break;
      }
    };
    
    mcWorker.onerror = function(err) {
      mcWorkerRunning = false;
      reject(new Error(err.message || 'Worker-Fehler'));
    };
    
    // Worker starten
    mcWorker.postMessage({
      type: 'start',
      params,
      iterations,
      volatility,
      mcOptions
    });
  });
}

// Monte-Carlo Button Event Handler (mit Web Worker)
document.getElementById("btn-monte-carlo")?.addEventListener("click", async () => {
  try {
    messageEl.textContent = "";
    
    // Parameter aus Formular lesen (nutze gemeinsame Funktion falls verfügbar)
    const params = typeof readParamsFromForm === 'function' 
      ? readParamsFromForm() 
      : (() => {
          const mode = form.querySelector('input[name="rent_mode"]:checked')?.value || "eur";
          const inflationAdjust = document.getElementById("inflation_adjust_withdrawal")?.checked ?? true;
          const inflationAdjustSpecialSavings = document.getElementById("inflation_adjust_special_savings")?.checked ?? true;
          const inflationAdjustSpecialWithdrawal = document.getElementById("inflation_adjust_special_withdrawal")?.checked ?? true;
          
          return {
            start_savings: readNumber("start_savings", { min: 0 }),
            start_etf: readNumber("start_etf", { min: 0 }),
            start_etf_cost_basis: readNumber("start_etf_cost_basis", { min: 0 }),
            monthly_savings: readNumber("monthly_savings", { min: 0 }),
            monthly_etf: readNumber("monthly_etf", { min: 0 }),
            savings_rate_pa: readNumber("savings_rate", { min: -10, max: 50 }),
            etf_rate_pa: readNumber("etf_rate", { min: -50, max: 50 }),
            etf_ter_pa: readNumber("etf_ter", { min: 0, max: 5 }),
            savings_target: readNumber("savings_target", { min: 0 }),
            annual_raise_percent: readNumber("annual_raise", { min: -10, max: 50 }),
            savings_years: readNumber("years_save", { min: 1, max: 100 }),
            withdrawal_years: readNumber("years_withdraw", { min: 1, max: 100 }),
            monthly_payout_net: mode === "eur" ? readNumber("rent_eur", { min: 0 }) : null,
            monthly_payout_percent: mode === "percent" ? readNumber("rent_percent", { min: 0, max: 100 }) : null,
            withdrawal_min: readNumber("withdrawal_min", { min: 0 }),
            withdrawal_max: readNumber("withdrawal_max", { min: 0 }),
            inflation_adjust_withdrawal: inflationAdjust,
            special_payout_net_savings: readNumber("special_savings", { min: 0 }),
            special_interval_years_savings: readNumber("special_savings_interval", { min: 0 }),
            inflation_adjust_special_savings: inflationAdjustSpecialSavings,
            special_payout_net_withdrawal: readNumber("special_withdraw", { min: 0 }),
            special_interval_years_withdrawal: readNumber("special_withdraw_interval", { min: 0 }),
            inflation_adjust_special_withdrawal: inflationAdjustSpecialWithdrawal,
            inflation_rate_pa: readNumber("inflation_rate", { min: -10, max: 30 }),
            sparerpauschbetrag: readNumber("sparerpauschbetrag", { min: 0, max: 10000 }),
            kirchensteuer: document.getElementById("kirchensteuer")?.value || "keine",
            fondstyp: document.getElementById("fondstyp")?.value || "aktien",
            basiszins: readNumber("basiszins", { min: 0, max: 10 }),
            use_lifo: document.getElementById("use_lifo")?.checked ?? false,
            rent_mode: mode,
            rent_is_gross: document.getElementById("rent_is_gross")?.checked ?? false,
            capital_preservation_enabled: document.getElementById("capital_preservation_enabled")?.checked ?? false,
            capital_preservation_threshold: readNumber("capital_preservation_threshold", { min: 10, max: 100 }),
            capital_preservation_reduction: readNumber("capital_preservation_reduction", { min: 5, max: 75 }),
            capital_preservation_recovery: readNumber("capital_preservation_recovery", { min: 0, max: 50 }),
            loss_pot: readNumber("loss_pot", { min: 0 }),
          };
        })();
    
    // Params für Export speichern
    lastParams = params;
    
    const iterations = readNumber("mc_iterations", { min: 100, max: 100000 });
    const volatility = readNumber("mc_volatility", { min: 1, max: 50 });
    const showIndividual = document.getElementById("mc_show_individual")?.checked || false;
    const successThreshold = readNumber("mc_success_threshold", { min: 0, max: 1000000 });
    const ruinThresholdPercent = readNumber("mc_ruin_threshold", { min: 1, max: 50 });
    const seed = readNumber("mc_seed", { min: 0, max: 999999 });
    
    const mcOptions = {
      successThreshold,
      ruinThresholdPercent,
      seed: seed > 0 ? seed : null,
    };
    
    // Zum MC-Tab wechseln und UI vorbereiten
    switchToTab("monte-carlo");
    if (mcEmptyStateEl) mcEmptyStateEl.style.display = "none";
    if (mcResultsEl) mcResultsEl.style.display = "block";
    
    // Prüfe auf optimistische Parameter
    const paramWarnings = checkOptimisticParameters(params, volatility);
    const warningsEl = document.getElementById("mc-warnings");
    const warningContainerEl = document.getElementById("mc-warning-optimistic");
    const warningTextEl = document.getElementById("mc-warning-text");
    if (warningsEl && warningTextEl && warningContainerEl) {
      if (paramWarnings.length > 0) {
        const hasCritical = paramWarnings.some(w => w.severity === "critical");
        warningContainerEl.classList.toggle("mc-warning--critical", hasCritical);
        const iconEl = warningContainerEl.querySelector(".mc-warning-icon");
        if (iconEl) iconEl.textContent = hasCritical ? "🚨" : "⚠️";
        warningTextEl.innerHTML = paramWarnings.map(w => w.text).join("<br>");
        warningsEl.style.display = "block";
      } else {
        warningsEl.style.display = "none";
      }
    }
    
    mcProgressEl.value = 0;
    mcProgressTextEl.textContent = "Starte Worker...";
    
    // Button deaktivieren während Simulation läuft
    const btn = document.getElementById("btn-monte-carlo");
    const btnOpt = document.getElementById("btn-optimize");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Simuliere...";
    }
    if (btnOpt) btnOpt.disabled = true;
    
    // Worker nutzen
    await runMonteCarloWithWorker(params, iterations, volatility, showIndividual, mcOptions);
    
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Monte-Carlo starten";
    }
    
    // Optimize-Button aktivieren nach erfolgreicher MC-Simulation
    if (btnOpt) {
      btnOpt.disabled = false;
      btnOpt.title = "Parameter automatisch optimieren";
    }
    
    // Badge im Tab anzeigen
    if (mcBadgeEl) mcBadgeEl.style.display = "inline";
    
    messageEl.textContent = `Monte-Carlo-Simulation abgeschlossen (${iterations} Durchläufe, Worker).`;
  } catch (err) {
    const btn = document.getElementById("btn-monte-carlo");
    const btnOpt = document.getElementById("btn-optimize");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Monte-Carlo starten";
    }
    if (btnOpt) btnOpt.disabled = true;
    messageEl.textContent = err.message || String(err);
    console.error('MC-Simulation Fehler:', err);
  }
});

// Resize Handler für MC Graph
window.addEventListener("resize", () => {
  if (lastMcResults) renderMonteCarloGraph(lastMcResults);
});

// Log/Linear Toggle für MC Graph
const btnMcLog = document.getElementById("btn-mc-log");
const btnMcLinear = document.getElementById("btn-mc-linear");

btnMcLog?.addEventListener("click", () => {
  if (mcUseLogScale) return;
  mcUseLogScale = true;
  btnMcLog.classList.add("btn-scale--active");
  btnMcLinear.classList.remove("btn-scale--active");
  if (lastMcResults) renderMonteCarloGraph(lastMcResults);
});

btnMcLinear?.addEventListener("click", () => {
  if (!mcUseLogScale) return;
  mcUseLogScale = false;
  btnMcLinear.classList.add("btn-scale--active");
  btnMcLog.classList.remove("btn-scale--active");
  if (lastMcResults) renderMonteCarloGraph(lastMcResults);
});

// Monte-Carlo Graph Hover Handler
function handleMcHover(evt) {
  if (!mcGraphState || !mcGraphState.results) {
    tooltip.setAttribute("data-visible", "false");
    tooltip.setAttribute("aria-hidden", "true");
    return;
  }
  
  const rect = mcGraphCanvas.getBoundingClientRect();
  const x = evt.clientX - rect.left;
  const { padX, width, results } = mcGraphState;
  
  if (x < padX || x > width - padX) {
    tooltip.setAttribute("data-visible", "false");
    tooltip.setAttribute("aria-hidden", "true");
    return;
  }
  
  const { percentiles, percentilesReal, months, savingsYears } = results;
  // Wähle Perzentile basierend auf Real/Nominal Toggle
  const activePercentiles = mcUseRealValues && percentilesReal ? percentilesReal : percentiles;
  const valueLabel = mcUseRealValues ? " (real)" : "";
  
  const xDenom = Math.max(months.length - 1, 1);
  const idxFloat = (x - padX) / (width - 2 * padX) * xDenom;
  const idx = Math.max(0, Math.min(months.length - 1, Math.round(idxFloat)));
  
  const month = months[idx];
  const year = Math.ceil(month / MONTHS_PER_YEAR);
  const monthInYear = ((month - 1) % MONTHS_PER_YEAR) + 1;
  const phase = month <= savingsYears * MONTHS_PER_YEAR ? "Anspar" : "Entnahme";
  
  const lines = [
    `Jahr ${year}, Monat ${monthInYear} (${phase})${valueLabel}`,
    `──────────────────`,
    `95% (Best):  ${formatCurrency(activePercentiles.p95[idx])}`,
    `75%:         ${formatCurrency(activePercentiles.p75[idx])}`,
    `50% Median:  ${formatCurrency(activePercentiles.p50[idx])}`,
    `25%:         ${formatCurrency(activePercentiles.p25[idx])}`,
    `5% (Worst):  ${formatCurrency(activePercentiles.p5[idx])}`,
  ];
  
  tooltip.textContent = lines.join("\n");
  tooltip.style.left = `${evt.clientX + 14}px`;
  tooltip.style.top = `${evt.clientY + 12}px`;
  tooltip.setAttribute("data-visible", "true");
  tooltip.setAttribute("aria-hidden", "false");
}

mcGraphCanvas?.addEventListener("mousemove", handleMcHover);
mcGraphCanvas?.addEventListener("mouseleave", hideTooltip);

// ============ OPTIMIZATION SYSTEM ============

let optimizerWorker = null;
let lastOptimization = null;
let isOptimizing = false;

// UI-Elemente für Optimierung
const btnOptimize = document.getElementById("btn-optimize");
const optimizationResultsEl = document.getElementById("optimization-results");
const optimizationProgressEl = document.getElementById("optimization-progress");
const optimizationResultPanelEl = document.getElementById("optimization-result-panel");
const optimizationErrorEl = document.getElementById("optimization-error");
const optimizeProgressBar = document.getElementById("optimize-progress-bar");
const optimizeProgressText = document.getElementById("optimize-progress-text");

/**
 * Liest alle Parameter aus dem Formular.
 * Gemeinsame Funktion für Standard-, MC- und Optimierungs-Simulation.
 */
function readParamsFromForm() {
  const mode = form.querySelector('input[name="rent_mode"]:checked')?.value || "eur";
  const inflationAdjust = document.getElementById("inflation_adjust_withdrawal")?.checked ?? true;
  const inflationAdjustSpecialSavings = document.getElementById("inflation_adjust_special_savings")?.checked ?? true;
  const inflationAdjustSpecialWithdrawal = document.getElementById("inflation_adjust_special_withdrawal")?.checked ?? true;
  
  return {
    start_savings: readNumber("start_savings", { min: 0 }),
    start_etf: readNumber("start_etf", { min: 0 }),
    start_etf_cost_basis: readNumber("start_etf_cost_basis", { min: 0 }),
    monthly_savings: readNumber("monthly_savings", { min: 0 }),
    monthly_etf: readNumber("monthly_etf", { min: 0 }),
    savings_rate_pa: readNumber("savings_rate", { min: -10, max: 50 }),
    etf_rate_pa: readNumber("etf_rate", { min: -50, max: 50 }),
    etf_ter_pa: readNumber("etf_ter", { min: 0, max: 5 }),
    savings_target: readNumber("savings_target", { min: 0 }),
    annual_raise_percent: readNumber("annual_raise", { min: -10, max: 50 }),
    savings_years: readNumber("years_save", { min: 1, max: 100 }),
    withdrawal_years: readNumber("years_withdraw", { min: 1, max: 100 }),
    monthly_payout_net: mode === "eur" ? readNumber("rent_eur", { min: 0 }) : null,
    monthly_payout_percent: mode === "percent" ? readNumber("rent_percent", { min: 0, max: 100 }) : null,
    withdrawal_min: readNumber("withdrawal_min", { min: 0 }),
    withdrawal_max: readNumber("withdrawal_max", { min: 0 }),
    inflation_adjust_withdrawal: inflationAdjust,
    special_payout_net_savings: readNumber("special_savings", { min: 0 }),
    special_interval_years_savings: readNumber("special_savings_interval", { min: 0 }),
    inflation_adjust_special_savings: inflationAdjustSpecialSavings,
    special_payout_net_withdrawal: readNumber("special_withdraw", { min: 0 }),
    special_interval_years_withdrawal: readNumber("special_withdraw_interval", { min: 0 }),
    inflation_adjust_special_withdrawal: inflationAdjustSpecialWithdrawal,
    inflation_rate_pa: readNumber("inflation_rate", { min: -10, max: 30 }),
    sparerpauschbetrag: readNumber("sparerpauschbetrag", { min: 0, max: 10000 }),
    kirchensteuer: document.getElementById("kirchensteuer")?.value || "keine",
    fondstyp: document.getElementById("fondstyp")?.value || "aktien",
    basiszins: readNumber("basiszins", { min: 0, max: 10 }),
    use_lifo: document.getElementById("use_lifo")?.checked ?? false,
    rent_mode: mode,
    rent_is_gross: document.getElementById("rent_is_gross")?.checked ?? false,
    capital_preservation_enabled: document.getElementById("capital_preservation_enabled")?.checked ?? false,
    capital_preservation_threshold: readNumber("capital_preservation_threshold", { min: 10, max: 100 }),
    capital_preservation_reduction: readNumber("capital_preservation_reduction", { min: 5, max: 75 }),
    capital_preservation_recovery: readNumber("capital_preservation_recovery", { min: 0, max: 50 }),
    loss_pot: readNumber("loss_pot", { min: 0 }),
  };
}

/**
 * Liest MC-Optionen aus dem Formular
 */
function readMcOptionsFromForm() {
  const iterations = readNumber("mc_iterations", { min: 100, max: 100000 });
  const volatility = readNumber("mc_volatility", { min: 1, max: 50 });
  const successThreshold = readNumber("mc_success_threshold", { min: 0, max: 1000000 });
  const ruinThresholdPercent = readNumber("mc_ruin_threshold", { min: 1, max: 50 });
  const seed = readNumber("mc_seed", { min: 0, max: 999999 });
  
  return {
    iterations: Math.min(iterations, 2000), // Für Optimierung reduziert
    volatility,
    successThreshold,
    ruinThresholdPercent,
    seed: seed > 0 ? seed : null,
  };
}

/**
 * Initialisiert den Optimizer Worker
 */
function initOptimizerWorker() {
  if (optimizerWorker) {
    optimizerWorker.terminate();
  }
  
  try {
    optimizerWorker = new Worker('optimizer-worker.js');
    
    optimizerWorker.onmessage = function(e) {
      const { type, current, total, percent, currentCandidate, best, message } = e.data;
      
      switch (type) {
        case 'progress':
          if (optimizeProgressBar) optimizeProgressBar.value = percent;
          if (optimizeProgressText) {
            const candInfo = currentCandidate 
              ? `TG: ${currentCandidate.monthly_savings}€, ETF: ${currentCandidate.monthly_etf}€, Rente: ${currentCandidate.monthly_payout_net}€`
              : '';
            optimizeProgressText.textContent = `${current}/${total} (${percent}%) ${candInfo}`;
          }
          break;
          
        case 'complete':
          handleOptimizationComplete(best, message);
          break;
          
        case 'error':
          handleOptimizationError(message);
          break;
      }
    };
    
    optimizerWorker.onerror = function(err) {
      handleOptimizationError(err.message || 'Worker-Fehler');
    };
    
    return true;
  } catch (err) {
    console.error('Worker konnte nicht initialisiert werden:', err);
    return false;
  }
}

/**
 * Startet die Optimierung
 */
function startOptimization() {
  if (isOptimizing) return;
  
  try {
    const params = readParamsFromForm();
    const mcOptions = readMcOptionsFromForm();
    
    // Target Success aus mc_success_threshold übernehmen
    // Erfolgswahrscheinlichkeit = 100 - ruinThresholdPercent (vereinfacht)
    const targetSuccess = 90; // Standard-Ziel
    
    // Max Budget = monthly_savings + monthly_etf
    const maxBudget = (params.monthly_savings || 0) + (params.monthly_etf || 0);
    
    const gridConfig = {
      maxBudget,
      tgStep: 50,
      rentStep: 50,
      rentRange: 0.5, // ±50%
      targetSuccess,
      maxCombinations: 60
    };
    
    // Worker initialisieren
    if (!initOptimizerWorker()) {
      // Fallback: Synchrone Warnung
      handleOptimizationError('Web Worker nicht verfügbar. Optimierung kann nicht durchgeführt werden.');
      return;
    }
    
    // UI aktualisieren
    isOptimizing = true;
    setOptimizingState(true);
    
    if (optimizationResultsEl) optimizationResultsEl.style.display = 'block';
    if (optimizationProgressEl) optimizationProgressEl.style.display = 'flex';
    if (optimizationResultPanelEl) optimizationResultPanelEl.style.display = 'none';
    if (optimizationErrorEl) optimizationErrorEl.style.display = 'none';
    
    // Zum MC-Tab wechseln
    switchToTab('monte-carlo');
    
    // Seed für Common Random Numbers
    const seedBase = mcOptions.seed || Date.now();
    
    // Worker starten
    optimizerWorker.postMessage({
      type: 'start',
      params,
      mcOptions,
      mode: 'A', // Modus A: Budget fix, Rente maximieren
      gridConfig,
      seedBase
    });
    
    messageEl.textContent = 'Optimierung gestartet...';
    
  } catch (err) {
    handleOptimizationError(err.message);
  }
}

/**
 * Bricht die Optimierung ab
 */
function cancelOptimization() {
  if (optimizerWorker) {
    optimizerWorker.terminate();
    optimizerWorker = null;
  }
  
  isOptimizing = false;
  setOptimizingState(false);
  
  if (optimizationProgressEl) optimizationProgressEl.style.display = 'none';
  messageEl.textContent = 'Optimierung abgebrochen.';
}

/**
 * Verarbeitet das Optimierungsergebnis
 */
function handleOptimizationComplete(best, message) {
  isOptimizing = false;
  setOptimizingState(false);
  
  if (optimizationProgressEl) optimizationProgressEl.style.display = 'none';
  
  if (!best) {
    if (optimizationErrorEl) {
      optimizationErrorEl.style.display = 'flex';
      const errorText = document.getElementById('optimization-error-text');
      if (errorText) {
        errorText.textContent = message || 'Keine gültige Konfiguration gefunden. Alle Kombinationen unter Ziel-Erfolgswahrscheinlichkeit.';
      }
    }
    messageEl.textContent = 'Optimierung abgeschlossen: Keine optimale Konfiguration gefunden.';
    return;
  }
  
  lastOptimization = best;
  renderOptimizationResult(best);
  
  if (optimizationResultPanelEl) optimizationResultPanelEl.style.display = 'block';
  messageEl.textContent = 'Optimierung abgeschlossen!';
}

/**
 * Verarbeitet Optimierungsfehler
 */
function handleOptimizationError(errorMessage) {
  isOptimizing = false;
  setOptimizingState(false);
  
  if (optimizationProgressEl) optimizationProgressEl.style.display = 'none';
  
  if (optimizationErrorEl) {
    optimizationErrorEl.style.display = 'flex';
    const errorText = document.getElementById('optimization-error-text');
    if (errorText) {
      errorText.textContent = errorMessage || 'Unbekannter Fehler bei der Optimierung.';
    }
  }
  
  messageEl.textContent = 'Fehler bei der Optimierung: ' + errorMessage;
}

/**
 * Aktualisiert UI-Zustand während Optimierung
 */
function setOptimizingState(optimizing) {
  const btnMc = document.getElementById('btn-monte-carlo');
  const submitBtn = form.querySelector('button[type="submit"]');
  
  if (btnOptimize) {
    btnOptimize.disabled = optimizing;
    // Nur Text ändern, SVG-Icon beibehalten
    const textNode = Array.from(btnOptimize.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
    if (textNode) {
      textNode.textContent = optimizing ? ' Optimiere...' : ' Parameter optimieren';
    } else if (!optimizing) {
      // Falls kein Textknoten gefunden, Button-Inhalt wiederherstellen
      btnOptimize.innerHTML = `
        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
        Parameter optimieren
      `;
    }
  }
  if (btnMc) btnMc.disabled = optimizing;
  if (submitBtn) submitBtn.disabled = optimizing;
}

/**
 * Rendert das Optimierungsergebnis
 */
function renderOptimizationResult(best) {
  const { params, results, score } = best;
  
  // Parameter anzeigen
  const setStat = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  
  const totalBudget = (params.monthly_savings || 0) + (params.monthly_etf || 0);
  
  setStat('opt-monthly-savings', `${nf0.format(params.monthly_savings || 0)} €`);
  setStat('opt-monthly-etf', `${nf0.format(params.monthly_etf || 0)} €`);
  setStat('opt-rent-eur', `${nf0.format(params.monthly_payout_net || 0)} €`);
  setStat('opt-total-budget', `${nf0.format(totalBudget)} €`);
  
  // Kennzahlen anzeigen
  setStat('opt-success-rate', `${results.successRate.toFixed(1)}%`);
  setStat('opt-ruin-probability', `${results.ruinProbability.toFixed(1)}%`);
  setStat('opt-median-end-real', formatCurrency(results.medianEndReal || 0));
  setStat('opt-retirement-median', formatCurrency(results.retirementMedian || 0));
  setStat('opt-capital-preservation', `${(results.capitalPreservationRateReal || 0).toFixed(1)}%`);
  setStat('opt-range-end', `${formatCurrency(results.p10EndReal || 0)} - ${formatCurrency(results.p90EndReal || 0)}`);
  
  // Erfolgsrate Farbe
  const successEl = document.getElementById('opt-success-rate');
  if (successEl) {
    successEl.classList.remove('success-high', 'success-medium', 'success-low');
    if (results.successRate >= 95) {
      successEl.classList.add('success-high');
    } else if (results.successRate >= 80) {
      successEl.classList.add('success-medium');
    } else {
      successEl.classList.add('success-low');
    }
  }
}

/**
 * Übernimmt die optimierten Werte in die Formularfelder
 */
function applyOptimizedParams(params) {
  const setField = (id, value) => {
    const el = document.getElementById(id);
    if (el && value != null) {
      el.value = value;
    }
  };
  
  setField('monthly_savings', params.monthly_savings);
  setField('monthly_etf', params.monthly_etf);
  setField('rent_eur', params.monthly_payout_net);
  
  // EUR-Modus aktivieren falls Rente gesetzt
  if (params.monthly_payout_net != null) {
    const eurRadio = form.querySelector('input[name="rent_mode"][value="eur"]');
    if (eurRadio) {
      eurRadio.checked = true;
      updateRentModeFields?.();
    }
  }
  
  // In Storage speichern
  const storedParams = readParamsFromForm();
  saveToStorage(storedParams);
  
  messageEl.textContent = 'Optimierte Werte übernommen.';
}

// ============ EVENT HANDLERS ============

// Optimierung aktivieren nach erfolgreicher MC-Simulation
// (wird in runMonteCarloSimulation aufgerufen)
const originalRunMonteCarlo = runMonteCarloSimulation;
async function runMonteCarloSimulationWithOptimizeButton(params, iterations, volatility, showIndividual, mcOptions) {
  const result = await originalRunMonteCarlo(params, iterations, volatility, showIndividual, mcOptions);
  
  // Optimize-Button aktivieren nach MC-Run
  if (btnOptimize) {
    btnOptimize.disabled = false;
    btnOptimize.title = 'Parameter automatisch optimieren';
  }
  
  return result;
}

// Optimize Button
btnOptimize?.addEventListener('click', startOptimization);

// Cancel Button
document.getElementById('btn-cancel-optimize')?.addEventListener('click', cancelOptimization);

// Werte übernehmen
document.getElementById('btn-apply-optimization')?.addEventListener('click', () => {
  if (lastOptimization?.params) {
    applyOptimizedParams(lastOptimization.params);
  }
});

// Übernehmen & MC starten
document.getElementById('btn-apply-and-run')?.addEventListener('click', async () => {
  if (lastOptimization?.params) {
    applyOptimizedParams(lastOptimization.params);
    
    // Kurz warten, dann MC starten
    await new Promise(r => setTimeout(r, 100));
    document.getElementById('btn-monte-carlo')?.click();
  }
});
