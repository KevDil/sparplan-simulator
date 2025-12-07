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

// HINWEIS: Steuerkonstanten (TAX_RATE_BASE, SOLI_RATE, TEILFREISTELLUNG_MAP, etc.)
// und Simulationskonstanten (MONTHS_PER_YEAR, INITIAL_ETF_PRICE) sind in simulation-core.js definiert

// UI-spezifische Konstanten
const SPARERPAUSCHBETRAG_VERHEIRATET = 2000; // Nicht in simulation-core.js
const Y_AXIS_STEPS = 5;
const STORAGE_KEY = "etf_simulator_params";
const THEME_STORAGE_KEY = "etf_simulator_theme";

const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const form = document.getElementById("sim-form");
const graphCanvas = document.getElementById("graph");
const tooltip = document.getElementById("tooltip");
const messageEl = document.getElementById("message");
const tableBody = document.querySelector("#year-table tbody");
const themeToggleBtn = document.getElementById("btn-theme-toggle");

let graphState = null;
let lastHistory = [];
let lastParams = null;
let includeSpecialWithdrawals = false; // Toggle: Sonderausgaben in Statistik einbeziehen
let stdUseLogScale = false; // Standard: lineare Skala für Standard-Chart
let showRealStats = false; // Toggle: Nominale vs. inflationsbereinigte Statistiken

// ============ UTILITY FUNCTIONS ============
// HINWEIS: Kernfunktionen (simulate, randomNormal, percentile, etc.) sind in simulation-core.js definiert

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

function applyTheme(theme) {
  const body = document.body;
  if (!body) return;
  if (theme === "light") {
    body.classList.add("theme-light");
  } else {
    body.classList.remove("theme-light");
  }
}

function initThemeFromStorage() {
  let storedTheme = null;
  try {
    storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  } catch (e) {
    storedTheme = null;
  }

  applyTheme(storedTheme === "light" ? "light" : "dark");

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const isLight = document.body.classList.contains("theme-light");
      const nextTheme = isLight ? "dark" : "light";
      applyTheme(nextTheme);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      } catch (e) { /* ignore */ }
    });
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
    ["Notgroschen wird gefüllt (Monte-Carlo)", `${(results.emergencyFillProbability ?? 0).toFixed(1)}%`],
    ["Zeit bis Notgroschen voll (Median, Jahre)", results.emergencyMedianFillYears != null ? results.emergencyMedianFillYears.toFixed(2) : "nie/kein Ziel"],
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
      ["Notgroschen gefüllt", `${(results.emergencyFillProbability ?? 0).toFixed(1)}%`],
      ["Zeit bis TG-Ziel", results.emergencyMedianFillYears != null ? `${nf1.format(results.emergencyMedianFillYears)} Jahre` : "nie/kein Ziel"],
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

// ============ SIMULATION CORE ============
// HINWEIS: consolidateLots, sellEtfOptimized, sellEtfGross, coverTaxWithSavingsAndEtf, simulate
// sind jetzt in simulation-core.js definiert (für Worker-Kompatibilität)

// ENTFERNT: sellEtfOptimized - jetzt in simulation-core.js

/* ENTFERNT: ~950 Zeilen duplizierter Code (sellEtfOptimized, sellEtfGross, coverTaxWithSavingsAndEtf, simulate)
   Diese Funktionen sind jetzt in simulation-core.js definiert und werden von dort geladen.
   Siehe: importScripts('simulation-core.js') in den Workern
*/


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

function createEtaTracker(options) {
  const minSamples = options && typeof options.minSamples === "number" ? options.minSamples : 3;
  const minElapsedMs = options && typeof options.minElapsedMs === "number" ? options.minElapsedMs : 1500;
  const alpha = options && typeof options.alpha === "number" ? options.alpha : 0.3;
  let totalWork = 0;
  let startTime = 0;
  let lastUpdateTime = 0;
  let lastCompleted = 0;
  let smoothedThroughput = 0;
  let sampleCount = 0;
  let stopped = false;

  function now() {
    return Date.now();
  }

  function formatEta(etaSeconds) {
    if (!isFinite(etaSeconds) || etaSeconds < 0) return "";
    if (etaSeconds < 1) return "< 1 s";
    if (etaSeconds < 60) {
      return String(Math.round(etaSeconds)) + " s";
    }
    const minutes = Math.floor(etaSeconds / 60);
    const seconds = Math.round(etaSeconds % 60);
    if (minutes < 60) {
      const mm = String(minutes);
      const ss = String(seconds).padStart(2, "0");
      return mm + ":" + ss + " min";
    }
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    const mm = String(remMinutes).padStart(2, "0");
    return String(hours) + ":" + mm + " h";
  }

  return {
    start(total) {
      totalWork = typeof total === "number" ? total : 0;
      startTime = now();
      lastUpdateTime = startTime;
      lastCompleted = 0;
      smoothedThroughput = 0;
      sampleCount = 0;
      stopped = false;
    },
    update(completed) {
      if (stopped) return;
      const t = now();
      if (!startTime) {
        startTime = t;
        lastUpdateTime = t;
      }
      const deltaCompleted = completed - lastCompleted;
      const deltaTime = t - lastUpdateTime;
      if (deltaCompleted <= 0 || deltaTime < 200) {
        lastCompleted = completed;
        lastUpdateTime = t;
        return;
      }
      const instantThroughput = deltaCompleted / (deltaTime / 1000);
      if (smoothedThroughput === 0) {
        smoothedThroughput = instantThroughput;
      } else {
        smoothedThroughput = alpha * instantThroughput + (1 - alpha) * smoothedThroughput;
      }
      lastCompleted = completed;
      lastUpdateTime = t;
      sampleCount += 1;
    },
    getEta() {
      if (stopped || !startTime || totalWork <= 0 || smoothedThroughput <= 0) {
        return { seconds: null, formatted: "" };
      }
      const elapsed = now() - startTime;
      if (sampleCount < minSamples || elapsed < minElapsedMs) {
        return { seconds: null, formatted: "" };
      }
      const remaining = Math.max(0, totalWork - lastCompleted);
      if (remaining <= 0) {
        return { seconds: 0, formatted: "< 1 s" };
      }
      const etaSeconds = remaining / smoothedThroughput;
      return { seconds: etaSeconds, formatted: formatEta(etaSeconds) };
    },
    stop() {
      stopped = true;
    }
  };
}

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

// HINWEIS: percentile und createSeededRandom sind in simulation-core.js definiert

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

// HINWEIS: analyzeMonteCarloResults ist in simulation-core.js definiert

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

  // Notgroschen-Kennzahlen
  const emergencyProbEl = document.getElementById("mc-emergency-fill-prob");
  const emergencyYearsEl = document.getElementById("mc-emergency-fill-years");
  const emergencyFillProb = results.emergencyFillProbability ?? 0;
  const emergencyMedianYears = results.emergencyMedianFillYears;

  if (emergencyProbEl) {
    emergencyProbEl.textContent = `${emergencyFillProb.toFixed(1)}%`;
    emergencyProbEl.classList.remove("stat-value--success", "stat-value--warning", "stat-value--danger");
    if (emergencyFillProb >= 90) {
      emergencyProbEl.classList.add("stat-value--success");
    } else if (emergencyFillProb >= 60) {
      emergencyProbEl.classList.add("stat-value--warning");
    } else {
      emergencyProbEl.classList.add("stat-value--danger");
    }
  }

  if (emergencyYearsEl) {
    if (emergencyMedianYears == null || !Number.isFinite(emergencyMedianYears)) {
      emergencyYearsEl.textContent = emergencyFillProb === 0 ? "nie" : "–";
    } else {
      emergencyYearsEl.textContent = `${nf1.format(emergencyMedianYears)} Jahre`;
    }
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

// ============ MONTE-CARLO WEB WORKER (POOL) ============

let mcWorkerRunning = false;
let mcWorkerPool = [];

// Pool-Konfiguration
const MC_POOL_CONFIG = {
  maxWorkers: Math.min(navigator.hardwareConcurrency || 4, 8),
  minIterationsPerWorker: 100,
};

/**
 * Berechnet die optimale Worker-Anzahl.
 * HINWEIS: Immer Pool-Modus für konsistentes deterministisches Seeding.
 */
function getOptimalWorkerCount(iterations) {
  const maxByIterations = Math.floor(iterations / MC_POOL_CONFIG.minIterationsPerWorker);
  return Math.max(1, Math.min(MC_POOL_CONFIG.maxWorkers, maxByIterations));
}

function initMcWorkerPool(count) {
  terminateMcWorkerPool();
  mcWorkerPool = [];
  try {
    for (let i = 0; i < count; i++) {
      mcWorkerPool.push(new Worker('mc-worker.js'));
    }
    return true;
  } catch (err) {
    console.warn('MC-Worker-Pool konnte nicht initialisiert werden:', err);
    terminateMcWorkerPool();
    return false;
  }
}

function terminateMcWorkerPool() {
  for (const worker of mcWorkerPool) worker.terminate();
  mcWorkerPool = [];
}

function aggregateMcResults(allRawData, allSamplePaths, params, mcOptions, volatility) {
  const numSims = allRawData.reduce((sum, d) => sum + d.finalTotals.length, 0);
  const numMonths = (params.savings_years + params.withdrawal_years) * 12;
  
  const finalTotals = allRawData.flatMap(d => d.finalTotals).sort((a, b) => a - b);
  const finalTotalsReal = allRawData.flatMap(d => d.finalTotalsReal).sort((a, b) => a - b);
  const finalLossPot = allRawData.flatMap(d => d.finalLossPot).sort((a, b) => a - b);
  const finalYearlyFreibetrag = allRawData.flatMap(d => d.finalYearlyFreibetrag).sort((a, b) => a - b);
  const retirementTotals = allRawData.flatMap(d => d.retirementTotals).sort((a, b) => a - b);
  const retirementTotalsReal = allRawData.flatMap(d => d.retirementTotalsReal).sort((a, b) => a - b);
  
  const allSimResults = allRawData.flatMap(d => d.simResults);
  let successCountStrict = 0, successCountNominal = 0;
  let totalShortfallCount = 0, ansparShortfallCount = 0, entnahmeShortfallCount = 0;
  let ruinCount = 0, capitalPreservationCount = 0, capitalPreservationRealCount = 0;
  const fillMonths = [];
  const avgMonthlyWithdrawalsNet = [], avgMonthlyWithdrawalsNetReal = [];
  const avgMonthlyWithdrawalsGross = [], avgMonthlyWithdrawalsGrossReal = [];
  const totalWithdrawalsNet = [], totalWithdrawalsNetReal = [];
  const totalWithdrawalsGross = [], totalWithdrawalsGrossReal = [];
  
  for (const sim of allSimResults) {
    if (sim.hasPositiveEnd) successCountNominal++;
    if (sim.hasPositiveEnd && !sim.hasEntnahmeShortfall) successCountStrict++;
    if (sim.hasAnsparShortfall || sim.hasEntnahmeShortfall) totalShortfallCount++;
    if (sim.hasAnsparShortfall) ansparShortfallCount++;
    if (sim.hasEntnahmeShortfall) entnahmeShortfallCount++;
    if (sim.isRuin) ruinCount++;
    if (sim.capitalPreserved) capitalPreservationCount++;
    if (sim.capitalPreservedReal) capitalPreservationRealCount++;
    if (sim.firstFillMonth !== null) fillMonths.push(sim.firstFillMonth);
    if (sim.avgWithdrawalNet > 0) {
      avgMonthlyWithdrawalsNet.push(sim.avgWithdrawalNet);
      avgMonthlyWithdrawalsNetReal.push(sim.avgWithdrawalNetReal);
      avgMonthlyWithdrawalsGross.push(sim.avgWithdrawalGross);
      avgMonthlyWithdrawalsGrossReal.push(sim.avgWithdrawalGrossReal);
      totalWithdrawalsNet.push(sim.totalWithdrawalNet);
      totalWithdrawalsNetReal.push(sim.totalWithdrawalNetReal);
      totalWithdrawalsGross.push(sim.totalWithdrawalGross);
      totalWithdrawalsGrossReal.push(sim.totalWithdrawalGrossReal);
    }
  }
  
  avgMonthlyWithdrawalsNet.sort((a, b) => a - b);
  avgMonthlyWithdrawalsNetReal.sort((a, b) => a - b);
  totalWithdrawalsNet.sort((a, b) => a - b);
  totalWithdrawalsNetReal.sort((a, b) => a - b);
  avgMonthlyWithdrawalsGross.sort((a, b) => a - b);
  avgMonthlyWithdrawalsGrossReal.sort((a, b) => a - b);
  totalWithdrawalsGross.sort((a, b) => a - b);
  totalWithdrawalsGrossReal.sort((a, b) => a - b);
  fillMonths.sort((a, b) => a - b);
  
  const allSorrData = allRawData.flatMap(d => d.sorrData);
  const sorr = aggregateSorrData(allSorrData, params);
  
  const percentiles = { p5: [], p10: [], p25: [], p50: [], p75: [], p90: [], p95: [] };
  const percentilesReal = { p5: [], p10: [], p25: [], p50: [], p75: [], p90: [], p95: [] };
  const sampleHistories = allSamplePaths.flat().slice(0, 50);
  
  // KORRIGIERT: Perzentile aus ALLEN Pfaden berechnen (monthlyTotals), nicht nur Samples
  // monthlyTotals ist Array of Arrays: [workerData][month][iteration]
  // Wir müssen alle Worker-Daten pro Monat zusammenführen
  const hasMonthlyData = allRawData.length > 0 && allRawData[0].monthlyTotals && allRawData[0].monthlyTotals.length > 0;
  
  if (hasMonthlyData) {
    for (let month = 0; month < numMonths; month++) {
      // Sammle alle Werte für diesen Monat von allen Workern
      const monthTotals = [];
      const monthTotalsReal = [];
      for (const workerData of allRawData) {
        if (workerData.monthlyTotals[month]) {
          monthTotals.push(...workerData.monthlyTotals[month]);
        }
        if (workerData.monthlyTotalsReal[month]) {
          monthTotalsReal.push(...workerData.monthlyTotalsReal[month]);
        }
      }
      monthTotals.sort((a, b) => a - b);
      monthTotalsReal.sort((a, b) => a - b);
      
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
  } else if (sampleHistories.length > 0) {
    // Fallback auf Samples wenn keine Per-Monat-Daten vorhanden (Legacy-Kompatibilität)
    console.warn('Perzentile basieren nur auf Samples - Legacy-Modus');
    for (let month = 0; month < numMonths; month++) {
      const monthTotals = sampleHistories.map(h => h[month]?.total || 0).sort((a, b) => a - b);
      const monthTotalsReal = sampleHistories.map(h => h[month]?.total_real || 0).sort((a, b) => a - b);
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
  }
  
  const months = sampleHistories[0]?.map(h => h.month) || Array.from({ length: numMonths }, (_, i) => i + 1);
  const inflationRatePa = params.inflation_rate_pa || 2;
  const cumulativeInflation = Math.pow(1 + inflationRatePa / 100, numMonths / 12);
  const purchasingPowerLoss = (1 - 1 / cumulativeInflation) * 100;
  const emergencyFillProbability = numSims > 0 ? (fillMonths.length / numSims) * 100 : 0;
  const emergencyNeverFillProbability = Math.max(0, 100 - emergencyFillProbability);
  const emergencyMedianFillMonths = fillMonths.length ? percentile(fillMonths, 50) : null;
  const emergencyMedianFillYears = emergencyMedianFillMonths != null ? emergencyMedianFillMonths / 12 : null;
  
  return {
    iterations: numSims,
    successRate: (successCountStrict / numSims) * 100,
    successRateNominal: (successCountNominal / numSims) * 100,
    shortfallRate: (totalShortfallCount / numSims) * 100,
    ansparShortfallRate: (ansparShortfallCount / numSims) * 100,
    entnahmeShortfallRate: (entnahmeShortfallCount / numSims) * 100,
    percentiles, percentilesReal, months,
    medianEnd: percentile(finalTotals, 50),
    p10End: percentile(finalTotals, 10),
    p90End: percentile(finalTotals, 90),
    p5End: percentile(finalTotals, 5),
    p25End: percentile(finalTotals, 25),
    p75End: percentile(finalTotals, 75),
    p95End: percentile(finalTotals, 95),
    savingsYears: params.savings_years,
    retirementMedian: percentile(retirementTotals, 50),
    capitalPreservationRate: (capitalPreservationCount / numSims) * 100,
    capitalPreservationRateReal: (capitalPreservationRealCount / numSims) * 100,
    ruinProbability: (ruinCount / numSims) * 100,
    meanEnd: finalTotals.reduce((a, b) => a + b, 0) / numSims,
    medianEndReal: percentile(finalTotalsReal, 50),
    p10EndReal: percentile(finalTotalsReal, 10),
    p90EndReal: percentile(finalTotalsReal, 90),
    p5EndReal: percentile(finalTotalsReal, 5),
    p25EndReal: percentile(finalTotalsReal, 25),
    p75EndReal: percentile(finalTotalsReal, 75),
    p95EndReal: percentile(finalTotalsReal, 95),
    meanEndReal: finalTotalsReal.reduce((a, b) => a + b, 0) / numSims,
    retirementMedianReal: percentile(retirementTotalsReal, 50),
    medianFinalLossPot: percentile(finalLossPot, 50),
    medianFinalYearlyFreibetrag: percentile(finalYearlyFreibetrag, 50),
    medianAvgMonthlyWithdrawal: percentile(avgMonthlyWithdrawalsNet, 50),
    medianAvgMonthlyWithdrawalReal: percentile(avgMonthlyWithdrawalsNetReal, 50),
    medianTotalWithdrawals: percentile(totalWithdrawalsNet, 50),
    medianTotalWithdrawalsReal: percentile(totalWithdrawalsNetReal, 50),
    medianAvgMonthlyWithdrawalNet: percentile(avgMonthlyWithdrawalsNet, 50),
    medianAvgMonthlyWithdrawalNetReal: percentile(avgMonthlyWithdrawalsNetReal, 50),
    medianTotalWithdrawalsNet: percentile(totalWithdrawalsNet, 50),
    medianTotalWithdrawalsNetReal: percentile(totalWithdrawalsNetReal, 50),
    medianAvgMonthlyWithdrawalGross: percentile(avgMonthlyWithdrawalsGross, 50),
    medianAvgMonthlyWithdrawalGrossReal: percentile(avgMonthlyWithdrawalsGrossReal, 50),
    medianTotalWithdrawalsGross: percentile(totalWithdrawalsGross, 50),
    medianTotalWithdrawalsGrossReal: percentile(totalWithdrawalsGrossReal, 50),
    purchasingPowerLoss, realReturnPa: 0, sorr, mcOptions, volatility,
    emergencyFillProbability, emergencyNeverFillProbability, emergencyMedianFillYears,
    allHistories: sampleHistories,
    workerCount: mcWorkerPool.length || 1,
    poolMode: mcWorkerPool.length > 1,
  };
}

function aggregateSorrData(allSorrData, params) {
  const numSims = allSorrData.length;
  if (params.withdrawal_years === 0 || numSims < 10) {
    return { sorRiskScore: 0, earlyBadImpact: 0, earlyGoodImpact: 0, correlationEarlyReturns: 0,
      worstSequenceEnd: 0, bestSequenceEnd: 0, medianSequenceEnd: 0, vulnerabilityWindow: 0 };
  }
  allSorrData.sort((a, b) => a.earlyReturn - b.earlyReturn);
  const quintileSize = Math.floor(numSims / 5);
  const worstEarlyQuintile = allSorrData.slice(0, quintileSize);
  const bestEarlyQuintile = allSorrData.slice(-quintileSize);
  const middleQuintiles = allSorrData.slice(quintileSize * 2, quintileSize * 3);
  const avgWorst = worstEarlyQuintile.reduce((s, d) => s + d.endWealth, 0) / worstEarlyQuintile.length;
  const avgBest = bestEarlyQuintile.reduce((s, d) => s + d.endWealth, 0) / bestEarlyQuintile.length;
  const avgMiddle = middleQuintiles.reduce((s, d) => s + d.endWealth, 0) / middleQuintiles.length;
  const meanEarlyReturn = allSorrData.reduce((s, d) => s + d.earlyReturn, 0) / numSims;
  const meanEndWealth = allSorrData.reduce((s, d) => s + d.endWealth, 0) / numSims;
  let numerator = 0, denomEarly = 0, denomEnd = 0;
  for (const d of allSorrData) {
    const diffEarly = d.earlyReturn - meanEarlyReturn;
    const diffEnd = d.endWealth - meanEndWealth;
    numerator += diffEarly * diffEnd;
    denomEarly += diffEarly * diffEarly;
    denomEnd += diffEnd * diffEnd;
  }
  const correlation = (denomEarly > 0 && denomEnd > 0) ? numerator / Math.sqrt(denomEarly * denomEnd) : 0;
  const avgStartWealth = allSorrData.reduce((s, d) => s + d.startWealth, 0) / numSims;
  const sorRiskScore = avgStartWealth > 0 ? ((avgBest - avgWorst) / avgStartWealth) * 100 : 0;
  const earlyBadImpact = avgMiddle > 0 ? ((avgWorst - avgMiddle) / avgMiddle) * 100 : 0;
  const earlyGoodImpact = avgMiddle > 0 ? ((avgBest - avgMiddle) / avgMiddle) * 100 : 0;
  return { sorRiskScore: Math.abs(sorRiskScore), earlyBadImpact, earlyGoodImpact,
    correlationEarlyReturns: correlation, worstSequenceEnd: avgWorst,
    bestSequenceEnd: avgBest, medianSequenceEnd: avgMiddle,
    vulnerabilityWindow: Math.min(5, params.withdrawal_years) };
}

function runMonteCarloWithPool(params, iterations, volatility, showIndividual, mcOptions) {
  return new Promise((resolve, reject) => {
    const workerCount = getOptimalWorkerCount(iterations);
    const etaMc = createEtaTracker({ minSamples: 3, minElapsedMs: 1500, alpha: 0.3 });
    // KORRIGIERT: Auch bei workerCount === 1 den Pool-Modus (run-chunk) nutzen,
    // damit identische Ergebnisse wie bei mehreren Workern (deterministisches Seeding).
    // Der Legacy-'start'-Modus hat ein anderes Seeding-Schema und liefert abweichende Ergebnisse.
    
    if (!initMcWorkerPool(workerCount)) {
      console.error('Worker-Pool konnte nicht initialisiert werden');
      reject(new Error('Web Worker werden nicht unterstützt oder konnten nicht gestartet werden.'));
      return;
    }
    
    mcWorkerRunning = true;
    etaMc.start(iterations);
    mcProgressTextEl.textContent = `Starte ${workerCount} Worker...`;
    
    const iterationsPerWorker = Math.floor(iterations / workerCount);
    const remainder = iterations % workerCount;
    const baseSeed = mcOptions.seed || Date.now();
    const allRawData = [];
    const allSamplePaths = [];
    const workerProgress = new Array(workerCount).fill(0);
    let completedWorkers = 0;
    let hasError = false;
    
    let currentStartIdx = 0;
    for (let i = 0; i < workerCount; i++) {
      const worker = mcWorkerPool[i];
      const count = iterationsPerWorker + (i < remainder ? 1 : 0);
      
      worker.onmessage = function(e) {
        if (hasError) return;
        const { type, workerId, completedInChunk, rawData, samplePaths, message } = e.data;
        switch (type) {
          case 'chunk-progress':
            // KORRIGIERT: Tracke fertige Pfade pro Worker, nicht globalen Index
            workerProgress[workerId] = completedInChunk;
            const totalProgress = workerProgress.reduce((a, b) => a + b, 0);
            const pct = Math.round((totalProgress / iterations) * 100);
            mcProgressEl.value = pct;
            etaMc.update(totalProgress);
            const eta = etaMc.getEta();
            const etaText = eta.formatted ? `, ETA ${eta.formatted}` : "";
            mcProgressTextEl.textContent = `${totalProgress} / ${iterations} (${pct}%) - ${workerCount} Worker${etaText}`;
            break;
          case 'chunk-complete':
            allRawData.push(rawData);
            allSamplePaths.push(samplePaths);
            completedWorkers++;
            if (completedWorkers === workerCount) {
              mcWorkerRunning = false;
              terminateMcWorkerPool();
              etaMc.update(iterations);
              etaMc.stop();
              mcProgressTextEl.textContent = "Aggregiere Ergebnisse...";
              const results = aggregateMcResults(allRawData, allSamplePaths, params, mcOptions, volatility);
              results.showIndividual = showIndividual;
              lastMcResults = results;
              renderMonteCarloStats(results);
              renderMonteCarloGraph(results);
              mcProgressTextEl.textContent = `Fertig! (${workerCount} Worker)`;
              resolve(results);
            }
            break;
          case 'error':
            if (!hasError) {
              hasError = true;
              mcWorkerRunning = false;
              terminateMcWorkerPool();
              etaMc.stop();
              reject(new Error(message));
            }
            break;
        }
      };
      worker.onerror = function(err) {
        if (!hasError) {
          hasError = true;
          mcWorkerRunning = false;
          terminateMcWorkerPool();
          etaMc.stop();
          reject(new Error(err.message || 'Worker-Fehler'));
        }
      };
      worker.postMessage({
        type: 'run-chunk', params, volatility, mcOptions,
        startIdx: currentStartIdx, count, totalIterations: iterations,
        workerId: i, baseSeed
      });
      currentStartIdx += count;
    }
  });
}

function runMonteCarloWithWorker(params, iterations, volatility, showIndividual, mcOptions) {
  return runMonteCarloWithPool(params, iterations, volatility, showIndividual, mcOptions);
}

// Monte-Carlo Button Event Handler (mit Web Worker)
document.getElementById("btn-monte-carlo")?.addEventListener("click", async () => {
  try {
    messageEl.textContent = "";
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
    if (mcResultsEl && typeof mcResultsEl.scrollIntoView === "function") {
      mcResultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    
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
let optimizerEtaTracker = null;

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
            let candInfo = '';
            if (currentCandidate) {
              const isPercentMode = currentCandidate.rent_mode === 'percent' || 
                (currentCandidate.monthly_payout_percent != null && currentCandidate.monthly_payout_percent > 0);
              if (isPercentMode) {
                candInfo = `TG: ${currentCandidate.monthly_savings}€, ETF: ${currentCandidate.monthly_etf}€, Rente: ${currentCandidate.monthly_payout_percent}%`;
              } else {
                candInfo = `TG: ${currentCandidate.monthly_savings}€, ETF: ${currentCandidate.monthly_etf}€, Rente: ${currentCandidate.monthly_payout_net}€`;
              }
            }
            let baseText = `${current}/${total} (${percent}%)`;
            if (optimizerEtaTracker && typeof total === "number" && total > 0) {
              if (current === 1) {
                optimizerEtaTracker.start(total);
              }
              optimizerEtaTracker.update(current);
              const eta = optimizerEtaTracker.getEta();
              if (eta.formatted) {
                baseText += `, ETA ${eta.formatted}`;
              }
            }
            if (candInfo) {
              baseText += ` ${candInfo}`;
            }
            optimizeProgressText.textContent = baseText;
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
    optimizerEtaTracker = createEtaTracker({ minSamples: 3, minElapsedMs: 2000, alpha: 0.3 });
    
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
  if (optimizerEtaTracker) {
    optimizerEtaTracker.stop();
    optimizerEtaTracker = null;
  }
  
  if (optimizationProgressEl) optimizationProgressEl.style.display = 'none';
  messageEl.textContent = 'Optimierung abgebrochen.';
}

/**
 * Verarbeitet das Optimierungsergebnis
 */
function handleOptimizationComplete(best, message) {
  isOptimizing = false;
  setOptimizingState(false);
  if (optimizerEtaTracker) {
    optimizerEtaTracker.stop();
    optimizerEtaTracker = null;
  }
  
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
  if (optimizerEtaTracker) {
    optimizerEtaTracker.stop();
    optimizerEtaTracker = null;
  }
  
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
    const textNode = Array.from(btnOptimize.childNodes).find(
      n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
    );
    if (textNode) {
      textNode.textContent = optimizing ? ' Optimiere...' : ' Parameter optimieren';
    } else if (!optimizing) {
      // Falls kein Textknoten gefunden, Button-Text wiederherstellen
      btnOptimize.textContent = 'Parameter optimieren';
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
  
  // Prüfe ob Percent-Modus aktiv ist
  const isPercentMode = params.rent_mode === 'percent' || 
    (params.monthly_payout_percent != null && params.monthly_payout_percent > 0);
  
  setStat('opt-monthly-savings', `${nf0.format(params.monthly_savings || 0)} €`);
  setStat('opt-monthly-etf', `${nf0.format(params.monthly_etf || 0)} €`);
  
  // Rente je nach Modus anzeigen
  if (isPercentMode) {
    setStat('opt-rent-eur', `${params.monthly_payout_percent || 0} %`);
  } else {
    setStat('opt-rent-eur', `${nf0.format(params.monthly_payout_net || 0)} €`);
  }
  
  setStat('opt-total-budget', `${nf0.format(totalBudget)} €`);
  
  // Kennzahlen anzeigen
  setStat('opt-success-rate', `${results.successRate.toFixed(1)}%`);
  setStat('opt-ruin-probability', `${results.ruinProbability.toFixed(1)}%`);
  setStat('opt-median-end-real', formatCurrency(results.medianEndReal || 0));
  setStat('opt-retirement-median', formatCurrency(results.retirementMedian || 0));
  setStat('opt-capital-preservation', `${(results.capitalPreservationRateReal || 0).toFixed(1)}%`);
  setStat('opt-range-end', `${formatCurrency(results.p10EndReal || 0)} - ${formatCurrency(results.p90EndReal || 0)}`);
  const emergencyProb = results.emergencyFillProbability;
  const emergencyYears = results.emergencyMedianFillYears;
  const emergencyProbText = emergencyProb != null ? `${emergencyProb.toFixed(1)}%` : '-';
  const emergencyYearsText = emergencyYears != null && Number.isFinite(emergencyYears)
    ? `${nf1.format(emergencyYears)} Jahre`
    : (emergencyProb === 0 ? 'nie' : '-');
  setStat('opt-emergency-fill-prob', emergencyProbText);
  setStat('opt-emergency-fill-years', emergencyYearsText);
  
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

  const emergencyProbEl = document.getElementById('opt-emergency-fill-prob');
  if (emergencyProbEl && emergencyProb != null) {
    emergencyProbEl.classList.remove('stat-value--success', 'stat-value--warning', 'stat-value--danger');
    if (emergencyProb >= 90) {
      emergencyProbEl.classList.add('stat-value--success');
    } else if (emergencyProb >= 60) {
      emergencyProbEl.classList.add('stat-value--warning');
    } else {
      emergencyProbEl.classList.add('stat-value--danger');
    }
  }
}

/**
 * Übernimmt die optimierten Werte in die Formularfelder
 * Unterstützt sowohl EUR-Modus als auch Percent-Modus
 */
function applyOptimizedParams(params) {
  const setField = (id, value) => {
    const el = document.getElementById(id);
    if (el && value != null) {
      el.value = value;
    }
  };
  
  // Sparraten immer setzen
  setField('monthly_savings', params.monthly_savings);
  setField('monthly_etf', params.monthly_etf);
  
  // Prüfe ob Percent-Modus aktiv ist
  const isPercentMode = params.rent_mode === 'percent' || 
    (params.monthly_payout_percent != null && params.monthly_payout_percent > 0);
  
  if (isPercentMode) {
    // Percent-Modus: Prozentuale Entnahme setzen
    setField('rent_percent', params.monthly_payout_percent);
    const percentRadio = form.querySelector('input[name="rent_mode"][value="percent"]');
    if (percentRadio) {
      percentRadio.checked = true;
      updateRentModeFields?.();
    }
  } else {
    // EUR-Modus: Festen Betrag setzen
    setField('rent_eur', params.monthly_payout_net);
    const eurRadio = form.querySelector('input[name="rent_mode"][value="eur"]');
    if (eurRadio) {
      eurRadio.checked = true;
      updateRentModeFields?.();
    }
  }
  
  // In Storage speichern
  const storedParams = readParamsFromForm();
  saveToStorage(storedParams);
  
  const modeText = isPercentMode ? `${params.monthly_payout_percent}% p.a.` : `${params.monthly_payout_net}€/Monat`;
  messageEl.textContent = `Optimierte Werte übernommen (${modeText}).`;
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

// Theme initialisieren (nachdem DOM-Elemente vorhanden sind)
initThemeFromStorage();
