const TAX_RATE_BASE = 0.25; // Kapitalertragsteuer
const SOLI_RATE = 0.055; // Solidaritätszuschlag auf KESt
const TEILFREISTELLUNG = 0.7; // 30% steuerfrei bei Aktienfonds
const SPARERPAUSCHBETRAG_SINGLE = 1000;
const SPARERPAUSCHBETRAG_VERHEIRATET = 2000;
const KIRCHENSTEUER_SATZ_8 = 0.08; // Bayern, Baden-Württemberg
const KIRCHENSTEUER_SATZ_9 = 0.09; // Restliche Bundesländer

// Berechnet effektiven Steuersatz inkl. Kirchensteuer
function calculateTaxRate(kirchensteuerSatz = 0) {
  // Mit Kirchensteuer: KESt wird leicht reduziert (Sonderausgabenabzug)
  // Formel: KESt_eff = KESt / (1 + KiSt_Satz)
  if (kirchensteuerSatz > 0) {
    const kestEffektiv = TAX_RATE_BASE / (1 + kirchensteuerSatz);
    const soli = kestEffektiv * SOLI_RATE;
    const kist = kestEffektiv * kirchensteuerSatz;
    return kestEffektiv + soli + kist;
  }
  // Ohne Kirchensteuer: 25% + 5.5% Soli = 26.375%
  return TAX_RATE_BASE * (1 + SOLI_RATE);
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

// ============ UTILITY FUNCTIONS ============

function toMonthlyRate(annualPercent) {
  return Math.pow(1 + annualPercent / 100, 1 / MONTHS_PER_YEAR) - 1;
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
  };
  
  // Select-Elemente (Dropdowns)
  const selectFields = [
    { key: "kirchensteuer", id: "kirchensteuer" },
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
    basiszins: 2.53,
    capital_preservation_enabled: false,
    capital_preservation_threshold: 80,
    capital_preservation_reduction: 25,
    capital_preservation_recovery: 10,
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

  const dataHeader = ["Jahr", "Monat", "Phase", "Tagesgeld", "ETF", "Gesamt", "Gesamt (real)", "Rendite", "Entnahme", "Steuern", "Vorabpauschale"];
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
    (r.vorabpauschale_tax || 0).toFixed(2),
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
  
  const settingsHeader = ["Einstellung", "Wert"];
  const settingsRows = [
    settingsHeader,
    ["Exportzeitpunkt", new Date().toISOString()],
    ["Simulationstyp", "Monte-Carlo"],
    ["Anzahl Simulationen", results.iterations],
    ["Volatilität p.a.", `${results.volatility || ""}%`],
    [],
    ["=== EINGABEPARAMETER ===", ""],
    ...Object.entries(params || {}).map(([key, val]) => [key, val ?? ""]),
    [],
  ];
  
  // Zusammenfassung
  const summaryRows = [
    ["=== ZUSAMMENFASSUNG ===", ""],
    ["Erfolgswahrscheinlichkeit", `${results.successRate.toFixed(1)}%`],
    ["Kapitalerhalt-Rate", `${results.capitalPreservationRate.toFixed(1)}%`],
    ["Pleite-Risiko", `${results.ruinProbability.toFixed(1)}%`],
    [],
    ["Endvermögen (Median)", results.medianEnd.toFixed(2)],
    ["Endvermögen (10%-Perzentil)", results.p10End.toFixed(2)],
    ["Endvermögen (90%-Perzentil)", results.p90End.toFixed(2)],
    ["Endvermögen (5%-Perzentil, Worst)", results.p5End.toFixed(2)],
    ["Endvermögen (95%-Perzentil, Best)", results.p95End.toFixed(2)],
    ["Endvermögen (Durchschnitt)", results.meanEnd.toFixed(2)],
    [],
    ["Endvermögen real (Median)", results.medianEndReal.toFixed(2)],
    ["Endvermögen real (10%-90%)", `${results.p10EndReal.toFixed(2)} - ${results.p90EndReal.toFixed(2)}`],
    ["Vermögen bei Rentenbeginn (Median)", results.retirementMedian.toFixed(2)],
    [],
    ["=== SEQUENCE-OF-RETURNS RISK ===", ""],
    ["SoRR-Spreizung", `${results.sorr?.sorRiskScore?.toFixed(1) || 0}%`],
    ["Früher Crash-Effekt", `${results.sorr?.earlyBadImpact?.toFixed(1) || 0}%`],
    ["Früher Boom-Effekt", `+${results.sorr?.earlyGoodImpact?.toFixed(1) || 0}%`],
    ["Korrelation frühe Rendite <-> Endvermögen", `${((results.sorr?.correlationEarlyReturns || 0) * 100).toFixed(1)}%`],
    ["Endvermögen (schlechte Sequenz)", (results.sorr?.worstSequenceEnd || 0).toFixed(2)],
    ["Endvermögen (gute Sequenz)", (results.sorr?.bestSequenceEnd || 0).toFixed(2)],
    ["Kritisches Fenster", `Jahr 1-${results.sorr?.vulnerabilityWindow || 5}`],
    [],
  ];
  
  // Perzentile pro Monat
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
  
  const csvContent = [
    ...settingsRows,
    ...summaryRows,
    ["=== PERZENTILE PRO MONAT ===", "", "", "", "", "", "", "", ""],
    percentileHeader,
    ...percentileRows
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
      const withdrawals = entnahmeRows.filter(r => r.monthly_payout > 0).map(r => r.monthly_payout);
      if (withdrawals.length > 0) {
        const avgWithdrawal = withdrawals.reduce((a, b) => a + b, 0) / withdrawals.length;
        stats.push(["Ø Entnahme/Monat", formatCurrency(avgWithdrawal)]);
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
      ["Pleite-Risiko", `${results.ruinProbability.toFixed(1)}%`],
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

// ============ ETF SELLING (EXTRACTED) ============

function sellEtfOptimized(remaining, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate) {
  let taxPaid = 0;
  let freibetragUsed = yearlyUsedFreibetrag;
  let grossProceeds = 0; // Brutto-Verkaufserlös für Vorabpauschale-Tracking
  
  while (remaining > 0.01 && etfLots.length) {
    const lot = etfLots[etfLots.length - 1];
    const gainPerShare = currentEtfPrice - lot.price;
    const remainingFreibetrag = Math.max(0, sparerpauschbetrag - freibetragUsed);
    let sharesNeeded;

    if (gainPerShare > 0) {
      const taxableGainPerShare = gainPerShare * TEILFREISTELLUNG;
      const freibetragCoversShares = Math.min(
        taxableGainPerShare > 0 ? remainingFreibetrag / taxableGainPerShare : Number.POSITIVE_INFINITY,
        lot.amount
      );
      const sharesIfTaxFree = remaining / currentEtfPrice;

      if (sharesIfTaxFree <= freibetragCoversShares) {
        sharesNeeded = sharesIfTaxFree;
      } else {
        const netFromFreibetrag = freibetragCoversShares * currentEtfPrice;
        const stillNeeded = remaining - netFromFreibetrag;
        const taxPerShareFull = taxableGainPerShare * taxRate;
        const netPerShareTaxed = currentEtfPrice - taxPerShareFull;
        if (netPerShareTaxed <= 0) break;
        const additionalShares = stillNeeded / netPerShareTaxed;
        sharesNeeded = freibetragCoversShares + additionalShares;
      }
    } else {
      sharesNeeded = remaining / currentEtfPrice;
    }

    const sharesToSell = Math.min(sharesNeeded, lot.amount);
    grossProceeds += sharesToSell * currentEtfPrice;
    const totalGain = sharesToSell * gainPerShare * TEILFREISTELLUNG;
    const taxableAfterFreibetrag = Math.max(0, totalGain - Math.max(0, sparerpauschbetrag - freibetragUsed));
    freibetragUsed += Math.min(totalGain, sparerpauschbetrag - freibetragUsed);
    const partTax = taxableAfterFreibetrag * taxRate;
    const partNet = sharesToSell * currentEtfPrice - partTax;
    remaining -= partNet;
    taxPaid += partTax;

    if (sharesNeeded >= lot.amount) {
      etfLots.pop();
    } else {
      lot.amount -= sharesToSell;
    }
  }
  
  return { remaining, taxPaid, yearlyUsedFreibetrag: freibetragUsed, grossProceeds };
}

function simulate(params) {
  const {
    start_savings,
    start_etf,
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
    capital_preservation_enabled = false,
    capital_preservation_threshold = 80,
    capital_preservation_reduction = 25,
    capital_preservation_recovery = 10,
  } = params;

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
    etfLots.push({ amount: start_etf / currentEtfPrice, price: currentEtfPrice, monthIdx: 0 });
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
  
  // Vorabpauschale-Tracking: ETF-Wert am Jahresanfang
  let etfValueYearStart = start_etf;
  let vorabpauschaleTaxYearly = 0;
  // Netto-Zuflüsse ins ETF-Depot dieses Jahres (Käufe - Verkaufserlöse)
  // Für korrekte Vorabpauschale: actualGain = Endwert - Startwert - NetInflows
  let etfNetInflowsThisYear = 0;

  for (let monthIdx = 1; monthIdx <= totalMonths; monthIdx += 1) {
    const isSavingsPhase = monthIdx <= savings_years * MONTHS_PER_YEAR;
    const yearIdx = Math.floor((monthIdx - 1) / MONTHS_PER_YEAR);
    const monthInYear = ((monthIdx - 1) % MONTHS_PER_YEAR) + 1; // 1-12
    
    // Inflation kumulieren
    cumulativeInflation *= (1 + monthlyInflationRate);
    const totalEtfSharesStart = etfLots.reduce((acc, l) => acc + l.amount, 0);
    const totalEtfValueStart = totalEtfSharesStart * currentEtfPrice;

    // Neues Steuerjahr -> Freibetrag zurücksetzen und ETF-Wert am Jahresanfang speichern
    if (yearIdx !== currentTaxYear) {
      currentTaxYear = yearIdx;
      yearlyUsedFreibetrag = 0;
      etfValueYearStart = totalEtfValueStart;
      vorabpauschaleTaxYearly = 0;
      etfNetInflowsThisYear = 0;
    }

    // Wertentwicklung vor Cashflows
    currentEtfPrice *= 1 + monthlyEtfRate;
    const etfGrowth = totalEtfValueStart * monthlyEtfRate;

    const savingsInterest = savings * monthlySavingsRate;
    
    // Tagesgeldzinsen besteuern (Freibetrag berücksichtigen)
    let savingsInterestNet = savingsInterest;
    let savingsInterestTax = 0;
    if (savingsInterest > 0) {
      const remainingFreibetrag = Math.max(0, sparerpauschbetrag - yearlyUsedFreibetrag);
      const taxableInterest = Math.max(0, savingsInterest - remainingFreibetrag);
      savingsInterestTax = taxableInterest * taxRate;
      savingsInterestNet = savingsInterest - savingsInterestTax;
      yearlyUsedFreibetrag += Math.min(savingsInterest, remainingFreibetrag);
    }
    savings += savingsInterestNet;

    let savings_contrib = 0;
    let etf_contrib = 0;
    let overflow = 0;
    let withdrawal = 0;
    let tax_paid = savingsInterestTax; // Startet mit TG-Zinsen-Steuer
    let withdrawal_paid = 0;
    let monthlyPayout = 0; // Reguläre monatliche Entnahme (ohne Sonderausgaben)
    let capitalPreservationActiveThisMonth = false;

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
        etfNetInflowsThisYear += etf_contrib; // Für Vorabpauschale-Berechnung
      }

      // Sonderausgaben Ansparphase
      const inSpecial = special_interval_years_savings > 0
        && monthIdx % (special_interval_years_savings * MONTHS_PER_YEAR) === 0
        && monthIdx > 0;

      if (inSpecial) {
        // Inflationsanpassung der Sonderausgabe
        let specialAmount = special_payout_net_savings;
        if (inflation_adjust_special_savings) {
          specialAmount = special_payout_net_savings * Math.pow(1 + inflation_rate_pa / 100, yearIdx);
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
        const sellResult = sellEtfOptimized(remaining, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate);
        remaining = sellResult.remaining;
        tax_paid += sellResult.taxPaid;
        yearlyUsedFreibetrag = sellResult.yearlyUsedFreibetrag;
        etfNetInflowsThisYear -= sellResult.grossProceeds; // Verkaufserlös abziehen

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

      monthlyPayout = currentPayout; // Nur reguläre monatliche Entnahme (für Statistik)
      let needed_net = currentPayout;
      if (special_interval_years_withdrawal > 0
        && monthIdx % (special_interval_years_withdrawal * MONTHS_PER_YEAR) === 0) {
        // Inflationsanpassung der Sonderausgabe
        let specialAmount = special_payout_net_withdrawal;
        if (inflation_adjust_special_withdrawal) {
          specialAmount = special_payout_net_withdrawal * Math.pow(1 + inflation_rate_pa / 100, yearIdx);
        }
        needed_net += specialAmount;
      }

      if (needed_net > 0) {
        let remaining = needed_net;
        withdrawal = needed_net;

        const extraCash = Math.max(0, savings - savings_target);
        if (extraCash > 0) {
          const use = Math.min(extraCash, remaining);
          savings -= use;
          remaining -= use;
        }

        // ETF verkaufen (steueroptimiert) - extrahierte Funktion
        const sellResult = sellEtfOptimized(remaining, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate);
        remaining = sellResult.remaining;
        tax_paid += sellResult.taxPaid;
        yearlyUsedFreibetrag = sellResult.yearlyUsedFreibetrag;
        etfNetInflowsThisYear -= sellResult.grossProceeds; // Verkaufserlös abziehen

        if (remaining > 0.01) {
          const draw = Math.min(savings, remaining);
          savings -= draw;
          remaining -= draw;
        }

        if (remaining < 0) {
          savings += Math.abs(remaining);
          remaining = 0;
        }

        withdrawal_paid = withdrawal - Math.max(0, remaining);
      }
    }

    // ============ VORABPAUSCHALE (Dezember = Jahresende) ============
    // Für thesaurierende ETFs wird die Vorabpauschale am Jahresende berechnet
    let vorabpauschaleTax = 0;
    if (monthInYear === 12 && basiszins > 0 && etfValueYearStart > 0) {
      const totalEtfSharesNow = etfLots.reduce((acc, l) => acc + l.amount, 0);
      const etfValueYearEnd = totalEtfSharesNow * currentEtfPrice;
      
      // Basisertrag = ETF-Wert am Jahresanfang × Basiszins × 0,7
      const basisertrag = etfValueYearStart * (basiszins / 100) * 0.7;
      
      // Tatsächlicher Wertzuwachs = Endwert - Startwert - Netto-Zuflüsse
      // (ohne Einzahlungen zu besteuern, Verkäufe wurden bereits versteuert)
      const actualGain = Math.max(0, etfValueYearEnd - etfValueYearStart - etfNetInflowsThisYear);
      
      // Vorabpauschale = min(Basisertrag, tatsächlicher Wertzuwachs)
      // Bei negativer Wertentwicklung: keine Vorabpauschale
      const vorabpauschale = Math.min(basisertrag, actualGain);
      
      if (vorabpauschale > 0) {
        // Teilfreistellung: nur 70% sind steuerpflichtig
        const taxableVorabpauschale = vorabpauschale * TEILFREISTELLUNG;
        
        // Sparerpauschbetrag nutzen
        const remainingFreibetrag = Math.max(0, sparerpauschbetrag - yearlyUsedFreibetrag);
        const taxableAfterFreibetrag = Math.max(0, taxableVorabpauschale - remainingFreibetrag);
        yearlyUsedFreibetrag += Math.min(taxableVorabpauschale, remainingFreibetrag);
        
        // Steuer berechnen
        vorabpauschaleTax = taxableAfterFreibetrag * taxRate;
        vorabpauschaleTaxYearly = vorabpauschaleTax;
        
        // Steuer vom Tagesgeld abziehen (Broker zieht es vom Verrechnungskonto)
        savings -= vorabpauschaleTax;
        if (savings < 0) savings = 0;
      }
    }
    tax_paid += vorabpauschaleTax;

    // Gesamtwerte
    const totalEtfShares = etfLots.reduce((acc, l) => acc + l.amount, 0);
    const etf_value = totalEtfShares * currentEtfPrice;
    const total = savings + etf_value;

    // Aktuelle Entnahme für diesen Monat (nach Limits)
    const effectivePayout = isSavingsPhase ? null : (withdrawal > 0 ? withdrawal : null);
    
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
      monthly_payout: monthlyPayout, // Nur reguläre monatliche Entnahme (ohne Sonderausgaben)
      monthly_payout_real: monthlyPayout / cumulativeInflation,
      tax_paid,
      vorabpauschale_tax: vorabpauschaleTax,
      payout_value: effectivePayout,
      payout_percent_pa: isSavingsPhase ? null : payoutPercentPa,
      return_gain: etfGrowth + savingsInterest,
      cumulative_inflation: cumulativeInflation,
      capital_preservation_active: capitalPreservationActiveThisMonth || false,
    });
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

  // Endvermögen
  document.getElementById("stat-end-nominal").textContent = formatCurrency(lastRow.total);
  document.getElementById("stat-end-real").textContent = formatCurrency(lastRow.total_real || lastRow.total);

  // Eingezahlt gesamt (Start + alle Beiträge)
  const totalInvested = (params.start_savings || 0) + (params.start_etf || 0) +
    ansparRows.reduce((sum, r) => sum + (r.savings_contrib || 0) + (r.etf_contrib || 0), 0);
  document.getElementById("stat-total-invested").textContent = formatCurrency(totalInvested);

  // Rendite gesamt
  const totalReturn = history.reduce((sum, r) => sum + (r.return_gain || 0), 0);
  document.getElementById("stat-total-return").textContent = formatCurrency(totalReturn);

  // Entnahme-Statistiken (Toggle: mit/ohne Sonderausgaben)
  // Mit Sonderausgaben: withdrawal (Gesamtentnahme inkl. Sonder)
  // Ohne Sonderausgaben: monthly_payout (nur regul\u00e4re monatliche Entnahme)
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
  
  if (displayValues.length > 0) {
    const avgWithdrawal = displayValues.reduce((a, b) => a + b, 0) / displayValues.length;
    document.getElementById("stat-avg-withdrawal").textContent = formatCurrency(avgWithdrawal);
    
    // Reale Kaufkraft der Entnahmen (Durchschnitt)
    const avgWithdrawalReal = displayValuesReal.reduce((a, b) => a + b, 0) / displayValuesReal.length;
    document.getElementById("stat-avg-withdrawal-real").textContent = formatCurrency(avgWithdrawalReal);
    
    // Min/Max
    const minVal = Math.min(...displayValues);
    const maxVal = Math.max(...displayValues);
    document.getElementById("stat-minmax-withdrawal").textContent = 
      `${formatCurrency(minVal)} / ${formatCurrency(maxVal)}`;
    
    const minValReal = Math.min(...displayValuesReal);
    const maxValReal = Math.max(...displayValuesReal);
    document.getElementById("stat-minmax-withdrawal-real").textContent = 
      `${formatCurrency(minValReal)} / ${formatCurrency(maxValReal)}`;
  } else {
    document.getElementById("stat-avg-withdrawal").textContent = "-";
    document.getElementById("stat-minmax-withdrawal").textContent = "-";
    document.getElementById("stat-avg-withdrawal-real").textContent = "-";
    document.getElementById("stat-minmax-withdrawal-real").textContent = "-";
  }

  // Steuern gesamt
  const totalTax = history.reduce((sum, r) => sum + (r.tax_paid || 0), 0);
  document.getElementById("stat-total-tax").textContent = formatCurrency(totalTax);
  
  // Vorabpauschale gesamt
  const totalVorabpauschale = history.reduce((sum, r) => sum + (r.vorabpauschale_tax || 0), 0);
  document.getElementById("stat-vorabpauschale").textContent = formatCurrency(totalVorabpauschale);

  // Effektive Entnahmerate (bezogen auf Startvermögen Entnahmephase)
  if (entnahmeRows.length > 0 && displayValues.length > 0) {
    const entnahmeStartIdx = ansparRows.length;
    const entnahmeStartRow = entnahmeStartIdx > 0 ? history[entnahmeStartIdx - 1] : history[0];
    const startCapital = entnahmeStartRow.total;
    const avgAnnualWithdrawal = (displayValues.reduce((a, b) => a + b, 0) / displayValues.length) * 12;
    const effectiveRate = startCapital > 0 ? (avgAnnualWithdrawal / startCapital * 100) : 0;
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

  // Warnung bei Vermögensaufbrauch
  const warningEl = document.getElementById("stat-warning");
  if (warningEl) {
    // Pr\u00fcfe ob Verm\u00f6gen in der Entnahmephase stark gesunken oder aufgebraucht wurde
    if (entnahmeRows.length > 0) {
      const entnahmeStartIdx = ansparRows.length;
      const entnahmeStartRow = entnahmeStartIdx > 0 ? history[entnahmeStartIdx - 1] : history[0];
      const startCapital = entnahmeStartRow.total;
      const endCapital = lastRow.total;
      const capitalRatio = startCapital > 0 ? endCapital / startCapital : 1;
      
      // Pr\u00fcfe ob Entnahmen nicht vollst\u00e4ndig bedient werden konnten
      const shortfallMonths = entnahmeRows.filter(r => {
        const requested = r.monthly_payout || 0;
        const paid = r.withdrawal || 0;
        return requested > 0 && paid < requested * 0.99; // 1% Toleranz
      }).length;
      
      if (endCapital < 100) {
        warningEl.textContent = "\u26a0\ufe0f Verm\u00f6gen vollst\u00e4ndig aufgebraucht! Entnahmen k\u00f6nnen nicht gedeckt werden.";
        warningEl.className = "stat-warning stat-warning--critical";
      } else if (capitalRatio < 0.1) {
        warningEl.textContent = "\u26a0\ufe0f Verm\u00f6gen fast aufgebraucht (< 10% des Startverm\u00f6gens). Entnahmerate pr\u00fcfen!";
        warningEl.className = "stat-warning stat-warning--critical";
      } else if (capitalRatio < 0.3) {
        warningEl.textContent = "\u26a0 Verm\u00f6gen stark reduziert (< 30% des Startverm\u00f6gens). Evtl. Entnahme anpassen.";
        warningEl.className = "stat-warning stat-warning--warning";
      } else if (shortfallMonths > 0) {
        warningEl.textContent = `\u26a0 In ${shortfallMonths} Monaten konnte die gew\u00fcnschte Entnahme nicht vollst\u00e4ndig bedient werden.`;
        warningEl.className = "stat-warning stat-warning--warning";
      } else {
        warningEl.textContent = "\u2705 Verm\u00f6gen reicht f\u00fcr den gew\u00e4hlten Entnahmezeitraum.";
        warningEl.className = "stat-warning stat-warning--ok";
      }
    } else {
      warningEl.textContent = "";
      warningEl.className = "stat-warning";
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
  const minVal = Math.max(1000, Math.min(...totals.filter(v => v > 0), ...totalsReal.filter(v => v > 0)));
  const maxVal = Math.max(minVal * 10, ...totals, ...totalsReal);
  
  let toXY;
  
  if (stdUseLogScale) {
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
    // Lineare Skala
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
      basiszins: readNumber("basiszins", { min: 0, max: 10 }),
      rent_mode: mode,
      capital_preservation_enabled: document.getElementById("capital_preservation_enabled")?.checked ?? false,
      capital_preservation_threshold: readNumber("capital_preservation_threshold", { min: 10, max: 100 }),
      capital_preservation_reduction: readNumber("capital_preservation_reduction", { min: 5, max: 75 }),
      capital_preservation_recovery: readNumber("capital_preservation_recovery", { min: 0, max: 50 }),
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

// Event-Listener f\u00fcr klickbare Stat-Karten
["stat-card-avg-nominal", "stat-card-avg-real", "stat-card-minmax-nominal", "stat-card-minmax-real"].forEach(id => {
  document.getElementById(id)?.addEventListener("click", toggleWithdrawalStats);
});

// Gespeicherte Werte laden
applyStoredValues();
updateRentModeFields();

// ============ INFO MODAL ============

const infoModal = document.getElementById("info-modal");
const btnInfo = document.getElementById("btn-info");
const modalClose = document.getElementById("modal-close");

function openInfoModal() {
  infoModal?.classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeInfoModal() {
  infoModal?.classList.remove("active");
  document.body.style.overflow = "";
}

btnInfo?.addEventListener("click", openInfoModal);
modalClose?.addEventListener("click", closeInfoModal);

// Schließen bei Klick außerhalb des Modals
infoModal?.addEventListener("click", (e) => {
  if (e.target === infoModal) closeInfoModal();
});

// Schließen mit Escape-Taste
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && infoModal?.classList.contains("active")) {
    closeInfoModal();
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

// Box-Muller Transform für Normalverteilung
function randomNormal(mean = 0, stdDev = 1) {
  let u1, u2;
  do {
    u1 = Math.random();
    u2 = Math.random();
  } while (u1 === 0);
  
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev + mean;
}

// Konvertiert jährliche Volatilität zu monatlicher
function toMonthlyVolatility(annualVolatility) {
  return annualVolatility / Math.sqrt(12);
}

// Modifizierte Simulation mit stochastischer ETF-Rendite
function simulateStochastic(params, annualVolatility) {
  const {
    start_savings,
    start_etf,
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
    capital_preservation_enabled = false,
    capital_preservation_threshold = 80,
    capital_preservation_reduction = 25,
    capital_preservation_recovery = 10,
  } = params;

  let kirchensteuerSatz = 0;
  if (kirchensteuer === "8") kirchensteuerSatz = KIRCHENSTEUER_SATZ_8;
  else if (kirchensteuer === "9") kirchensteuerSatz = KIRCHENSTEUER_SATZ_9;
  const taxRate = calculateTaxRate(kirchensteuerSatz);

  const history = [];
  let savings = start_savings;
  let currentEtfPrice = INITIAL_ETF_PRICE;
  const etfLots = [];
  if (start_etf > 0) {
    etfLots.push({ amount: start_etf / currentEtfPrice, price: currentEtfPrice, monthIdx: 0 });
  }

  const effectiveEtfRate = etf_rate_pa - etf_ter_pa;
  const monthlySavingsRate = toMonthlyRate(savings_rate_pa);
  const monthlyEtfMean = toMonthlyRate(effectiveEtfRate);
  const monthlyVolatility = toMonthlyVolatility(annualVolatility / 100);
  const monthlyInflationRate = toMonthlyRate(inflation_rate_pa);
  const annualRaise = annual_raise_percent / 100;
  const totalMonths = (savings_years + withdrawal_years) * MONTHS_PER_YEAR;

  let savingsFull = savings >= savings_target;
  let yearlyUsedFreibetrag = 0;
  let currentTaxYear = 0;
  let payoutFromPercentDone = false;
  let payoutValue = monthly_payout_net;
  let entnahmeStartTotal = null;
  let basePayoutValue = null;
  let cumulativeInflation = 1;
  
  // Vorabpauschale-Tracking
  let etfValueYearStart = start_etf;
  // Netto-Zuflüsse ins ETF-Depot dieses Jahres (Käufe - Verkaufserlöse)
  let etfNetInflowsThisYear = 0;
  
  // Kapitalerhalt-Modus Tracking
  let capitalPreservationActive = false;

  for (let monthIdx = 1; monthIdx <= totalMonths; monthIdx += 1) {
    const isSavingsPhase = monthIdx <= savings_years * MONTHS_PER_YEAR;
    const monthInYear = ((monthIdx - 1) % MONTHS_PER_YEAR) + 1; // 1-12
    const yearIdx = Math.floor((monthIdx - 1) / MONTHS_PER_YEAR);
    
    cumulativeInflation *= (1 + monthlyInflationRate);
    const totalEtfSharesStart = etfLots.reduce((acc, l) => acc + l.amount, 0);
    const totalEtfValueStart = totalEtfSharesStart * currentEtfPrice;

    if (yearIdx !== currentTaxYear) {
      currentTaxYear = yearIdx;
      yearlyUsedFreibetrag = 0;
      etfValueYearStart = totalEtfValueStart;
      etfNetInflowsThisYear = 0;
    }

    // Stochastische ETF-Rendite (Geometrische Brownsche Bewegung)
    // GBM: S_t = S_0 * exp((μ - σ²/2)*t + σ*W_t)
    // Für diskreten Zeitschritt dt=1 Monat: S_t+1 = S_t * exp((μ - σ²/2) + σ*Z)
    // wobei Z ~ N(0,1). Dies garantiert E[S_t] = S_0 * e^(μt) und verhindert negative Preise.
    const drift = monthlyEtfMean - 0.5 * monthlyVolatility * monthlyVolatility;
    const z = randomNormal(0, 1);
    const monthlyEtfReturn = Math.exp(drift + monthlyVolatility * z); // Multiplikativer Faktor
    currentEtfPrice *= monthlyEtfReturn;

    const savingsInterest = savings * monthlySavingsRate;
    let savingsInterestNet = savingsInterest;
    let savingsInterestTax = 0;
    if (savingsInterest > 0) {
      const remainingFreibetrag = Math.max(0, sparerpauschbetrag - yearlyUsedFreibetrag);
      const taxableInterest = Math.max(0, savingsInterest - remainingFreibetrag);
      savingsInterestTax = taxableInterest * taxRate;
      savingsInterestNet = savingsInterest - savingsInterestTax;
      yearlyUsedFreibetrag += Math.min(savingsInterest, remainingFreibetrag);
    }
    savings += savingsInterestNet;

    let etf_contrib = 0;
    let withdrawal = 0;
    let tax_paid = savingsInterestTax;
    let withdrawal_paid = 0;
    let monthlyPayout = 0;

    if (isSavingsPhase) {
      const raiseFactor = Math.pow(1 + annualRaise, yearIdx);
      const currMonthlySav = monthly_savings * raiseFactor;
      const currMonthlyEtf = monthly_etf * raiseFactor;

      if (savingsFull) {
        etf_contrib = currMonthlyEtf + currMonthlySav;
      } else {
        savings += currMonthlySav;
        etf_contrib = currMonthlyEtf;
      }

      if (savings > savings_target) {
        const overflow = savings - savings_target;
        savings = savings_target;
        etf_contrib += overflow;
        savingsFull = true;
      }

      if (etf_contrib > 0) {
        const newShares = etf_contrib / currentEtfPrice;
        etfLots.push({ amount: newShares, price: currentEtfPrice, monthIdx });
        etfNetInflowsThisYear += etf_contrib; // Für Vorabpauschale-Berechnung
      }

      // Sonderausgaben Ansparphase
      const inSpecial = special_interval_years_savings > 0
        && monthIdx % (special_interval_years_savings * MONTHS_PER_YEAR) === 0
        && monthIdx > 0;

      if (inSpecial) {
        let specialAmount = special_payout_net_savings;
        if (inflation_adjust_special_savings) {
          specialAmount = special_payout_net_savings * Math.pow(1 + inflation_rate_pa / 100, yearIdx);
        }
        let remaining = specialAmount;
        withdrawal = remaining;

        const extraCash = Math.max(0, savings - savings_target);
        if (extraCash > 0) {
          const use = Math.min(extraCash, remaining);
          savings -= use;
          remaining -= use;
        }

        const sellResult = sellEtfOptimized(remaining, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate);
        remaining = sellResult.remaining;
        tax_paid += sellResult.taxPaid;
        yearlyUsedFreibetrag = sellResult.yearlyUsedFreibetrag;
        etfNetInflowsThisYear -= sellResult.grossProceeds; // Verkaufserlös abziehen

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
    } else {
      // Entnahmephase
      if (entnahmeStartTotal === null) {
        const totalEtfShares = etfLots.reduce((acc, l) => acc + l.amount, 0);
        entnahmeStartTotal = savings + totalEtfShares * currentEtfPrice;
        if (monthly_payout_percent != null && !payoutFromPercentDone) {
          payoutValue = entnahmeStartTotal * (monthly_payout_percent / 100) / 12;
          basePayoutValue = payoutValue;
          payoutFromPercentDone = true;
        } else if (payoutValue != null) {
          basePayoutValue = payoutValue;
        }
      }

      let currentPayout = payoutValue || 0;
      if (inflation_adjust_withdrawal && basePayoutValue != null) {
        const withdrawalYearIdx = yearIdx - savings_years;
        currentPayout = basePayoutValue * Math.pow(1 + inflation_rate_pa / 100, withdrawalYearIdx);
      }

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
        
        if (currentTotal < thresholdValue) {
          capitalPreservationActive = true;
        } else if (currentTotal >= recoveryValue) {
          capitalPreservationActive = false;
        }
        
        if (capitalPreservationActive) {
          currentPayout = currentPayout * (1 - capital_preservation_reduction / 100);
        }
      }

      monthlyPayout = currentPayout;
      let needed_net = currentPayout;
      if (special_interval_years_withdrawal > 0
        && monthIdx % (special_interval_years_withdrawal * MONTHS_PER_YEAR) === 0) {
        let specialAmount = special_payout_net_withdrawal;
        if (inflation_adjust_special_withdrawal) {
          specialAmount = special_payout_net_withdrawal * Math.pow(1 + inflation_rate_pa / 100, yearIdx);
        }
        needed_net += specialAmount;
      }

      if (needed_net > 0) {
        let remaining = needed_net;
        withdrawal = needed_net;

        const extraCash = Math.max(0, savings - savings_target);
        if (extraCash > 0) {
          const use = Math.min(extraCash, remaining);
          savings -= use;
          remaining -= use;
        }

        const sellResult = sellEtfOptimized(remaining, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag, taxRate);
        remaining = sellResult.remaining;
        tax_paid += sellResult.taxPaid;
        yearlyUsedFreibetrag = sellResult.yearlyUsedFreibetrag;
        etfNetInflowsThisYear -= sellResult.grossProceeds; // Verkaufserlös abziehen

        if (remaining > 0.01) {
          const draw = Math.min(savings, remaining);
          savings -= draw;
          remaining -= draw;
        }

        if (remaining < 0) {
          savings += Math.abs(remaining);
          remaining = 0;
        }

        withdrawal_paid = withdrawal - Math.max(0, remaining);
      }
    }

    // ============ VORABPAUSCHALE (Dezember = Jahresende) ============
    let vorabpauschaleTax = 0;
    if (monthInYear === 12 && basiszins > 0 && etfValueYearStart > 0) {
      const totalEtfSharesNow = etfLots.reduce((acc, l) => acc + l.amount, 0);
      const etfValueYearEnd = totalEtfSharesNow * currentEtfPrice;
      
      const basisertrag = etfValueYearStart * (basiszins / 100) * 0.7;
      // Tatsächlicher Wertzuwachs = Endwert - Startwert - Netto-Zuflüsse
      const actualGain = Math.max(0, etfValueYearEnd - etfValueYearStart - etfNetInflowsThisYear);
      const vorabpauschale = Math.min(basisertrag, actualGain);
      
      if (vorabpauschale > 0) {
        const taxableVorabpauschale = vorabpauschale * TEILFREISTELLUNG;
        const remainingFreibetrag = Math.max(0, sparerpauschbetrag - yearlyUsedFreibetrag);
        const taxableAfterFreibetrag = Math.max(0, taxableVorabpauschale - remainingFreibetrag);
        yearlyUsedFreibetrag += Math.min(taxableVorabpauschale, remainingFreibetrag);
        
        vorabpauschaleTax = taxableAfterFreibetrag * taxRate;
        savings -= vorabpauschaleTax;
        if (savings < 0) savings = 0;
      }
    }
    tax_paid += vorabpauschaleTax;

    const totalEtfShares = etfLots.reduce((acc, l) => acc + l.amount, 0);
    const etf_value = totalEtfShares * currentEtfPrice;
    const total = savings + etf_value;

    // Shortfall = angeforderte Entnahme konnte nicht vollständig bedient werden
    const shortfall = withdrawal > 0 ? Math.max(0, withdrawal - withdrawal_paid) : 0;
    
    history.push({
      month: monthIdx,
      year: yearIdx + 1,
      phase: isSavingsPhase ? "Anspar" : "Entnahme",
      savings,
      etf: etf_value,
      total,
      total_real: total / cumulativeInflation,
      withdrawal: withdrawal_paid,
      withdrawal_requested: withdrawal, // Für Shortfall-Analyse
      shortfall, // Differenz zwischen angefordert und tatsächlich ausgezahlt
      monthly_payout: monthlyPayout,
      tax_paid,
      etfReturn: monthlyEtfReturn, // Für zeitgewichtete Rendite (TWR) in SoRR-Analyse
    });
  }

  return history;
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

// Hauptfunktion für Monte-Carlo-Simulation
async function runMonteCarloSimulation(params, iterations, volatility, showIndividual) {
  // Switch to Monte-Carlo tab and show results
  switchToTab("monte-carlo");
  
  if (mcEmptyStateEl) mcEmptyStateEl.style.display = "none";
  if (mcResultsEl) mcResultsEl.style.display = "block";
  
  mcProgressEl.value = 0;
  mcProgressTextEl.textContent = "Starte...";
  
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
  
  // Analysiere Ergebnisse
  const results = analyzeMonteCarloResults(allHistories, params);
  results.volatility = volatility;
  results.showIndividual = showIndividual;
  results.allHistories = showIndividual ? allHistories.slice(0, 50) : [];
  
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
  // Verwendet Time-Weighted Return (TWR) statt Vermögensveränderung, um Cashflows auszuschließen
  const earlyYears = Math.min(5, params.withdrawal_years);
  const earlyMonths = earlyYears * MONTHS_PER_YEAR;
  
  const simData = allHistories.map(history => {
    // Vermögen am Start der Entnahme
    const startWealth = history[savingsMonths - 1]?.total || history[savingsMonths]?.total || 0;
    
    // Zeitgewichtete Rendite (TWR) für die ersten Jahre der Entnahmephase
    // TWR = Produkt der monatlichen Renditen (1 + r_i) - 1
    // Da wir den multiplikativen Faktor speichern: TWR = Produkt(etfReturn_i) - 1
    let twrProduct = 1;
    const earlyEndIdx = Math.min(savingsMonths + earlyMonths - 1, numMonths - 1);
    
    for (let m = savingsMonths; m <= earlyEndIdx && m < history.length; m++) {
      const monthlyReturn = history[m]?.etfReturn || 1;
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
      // TWR für dieses Jahr berechnen (Produkt der monatlichen Renditen)
      let twrProduct = 1;
      for (let m = savingsMonths; m <= yearEndIdx && m < h.length; m++) {
        const monthlyReturn = h[m]?.etfReturn || 1;
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

function analyzeMonteCarloResults(allHistories, params) {
  const numMonths = allHistories[0]?.length || 0;
  const numSims = allHistories.length;
  const savingsMonths = params.savings_years * MONTHS_PER_YEAR;
  
  // Sammle Endvermögen
  const finalTotals = allHistories.map(h => h[h.length - 1]?.total || 0).sort((a, b) => a - b);
  const finalTotalsReal = allHistories.map(h => h[h.length - 1]?.total_real || 0).sort((a, b) => a - b);
  
  // Sequence-of-Returns Risk Analyse
  const sorr = analyzeSequenceOfReturnsRisk(allHistories, params);
  
  // Vermögen bei Rentenbeginn (Index = savingsMonths - 1, da 0-basiert)
  const retirementIdx = Math.min(savingsMonths - 1, numMonths - 1);
  const retirementTotals = allHistories.map(h => h[retirementIdx]?.total || 0).sort((a, b) => a - b);
  const retirementMedian = percentile(retirementTotals, 50);
  
  // Erfolgsrate: Vermögen > 100 € am Ende UND keine Shortfalls während Entnahmephase
  // Shortfall = angeforderte Entnahme konnte nicht vollständig bedient werden
  let successCountStrict = 0;
  let successCountNominal = 0;
  let totalShortfallCount = 0; // Simulationen mit mindestens einem Shortfall
  
  for (const history of allHistories) {
    const endWealth = history[history.length - 1]?.total || 0;
    const hasPositiveEnd = endWealth > 100;
    
    // Prüfe auf Shortfalls in der Entnahmephase
    let hasShortfall = false;
    for (let m = savingsMonths; m < numMonths; m++) {
      if ((history[m]?.shortfall || 0) > 0.01) {
        hasShortfall = true;
        break;
      }
    }
    
    if (hasPositiveEnd) successCountNominal++;
    if (hasPositiveEnd && !hasShortfall) successCountStrict++;
    if (hasShortfall) totalShortfallCount++;
  }
  
  // Strenge Erfolgsrate: Keine Shortfalls UND positives Endvermögen
  const successRate = (successCountStrict / numSims) * 100;
  // Nominale Erfolgsrate (nur Endvermögen > 100€, wie bisher)
  const successRateNominal = (successCountNominal / numSims) * 100;
  // Shortfall-Quote: Anteil der Simulationen mit mindestens einem Shortfall
  const shortfallRate = (totalShortfallCount / numSims) * 100;
  
  // Kapitalerhalt: Endvermögen >= Vermögen bei Rentenbeginn
  let capitalPreservationCount = 0;
  for (let i = 0; i < numSims; i++) {
    const retirementWealth = allHistories[i][retirementIdx]?.total || 0;
    const endWealth = allHistories[i][numMonths - 1]?.total || 0;
    if (endWealth >= retirementWealth) capitalPreservationCount++;
  }
  const capitalPreservationRate = (capitalPreservationCount / numSims) * 100;
  
  // Pleite-Risiko: Vermögen fällt unter 10.000 € ODER Shortfall tritt auf
  let ruinCount = 0;
  for (const history of allHistories) {
    let isRuin = false;
    for (let m = savingsMonths; m < numMonths; m++) {
      if ((history[m]?.total || 0) < 10000 || (history[m]?.shortfall || 0) > 0.01) {
        isRuin = true;
        break;
      }
    }
    if (isRuin) ruinCount++;
  }
  const ruinProbability = (ruinCount / numSims) * 100;
  
  // Durchschnittliches Endvermögen
  const meanEnd = finalTotals.reduce((a, b) => a + b, 0) / numSims;
  
  // Perzentile pro Monat berechnen
  const percentiles = {
    p5: [], p10: [], p25: [], p50: [], p75: [], p90: [], p95: []
  };
  
  for (let month = 0; month < numMonths; month++) {
    const monthTotals = allHistories.map(h => h[month]?.total || 0).sort((a, b) => a - b);
    
    percentiles.p5.push(percentile(monthTotals, 5));
    percentiles.p10.push(percentile(monthTotals, 10));
    percentiles.p25.push(percentile(monthTotals, 25));
    percentiles.p50.push(percentile(monthTotals, 50));
    percentiles.p75.push(percentile(monthTotals, 75));
    percentiles.p90.push(percentile(monthTotals, 90));
    percentiles.p95.push(percentile(monthTotals, 95));
  }
  
  // Jahre-Array für X-Achse
  const months = allHistories[0]?.map(h => h.month) || [];
  
  return {
    iterations: numSims,
    successRate, // Strenge Rate: Keine Shortfalls UND positives Endvermögen
    successRateNominal, // Nur positives Endvermögen (alte Definition)
    shortfallRate, // Anteil mit mindestens einem Shortfall
    finalTotals,
    finalTotalsReal,
    percentiles,
    months,
    medianEnd: percentile(finalTotals, 50),
    p10End: percentile(finalTotals, 10),
    p90End: percentile(finalTotals, 90),
    p5End: percentile(finalTotals, 5),
    p95End: percentile(finalTotals, 95),
    savingsYears: params.savings_years,
    // Zusätzliche Metriken
    retirementMedian,
    capitalPreservationRate,
    ruinProbability,
    meanEnd,
    // Inflationsbereinigte Werte (real)
    medianEndReal: percentile(finalTotalsReal, 50),
    p10EndReal: percentile(finalTotalsReal, 10),
    p90EndReal: percentile(finalTotalsReal, 90),
    p5EndReal: percentile(finalTotalsReal, 5),
    p95EndReal: percentile(finalTotalsReal, 95),
    meanEndReal: finalTotalsReal.reduce((a, b) => a + b, 0) / numSims,
    retirementMedianReal: percentile(
      allHistories.map(h => h[retirementIdx]?.total_real || 0).sort((a, b) => a - b), 
      50
    ),
    // Sequence-of-Returns Risk
    sorr,
  };
}

function renderMonteCarloStats(results) {
  const successEl = document.getElementById("mc-success-rate");
  // Zeige strenge Erfolgsrate (keine Shortfalls)
  successEl.textContent = `${results.successRate.toFixed(1)}%`;
  
  // Shortfall-Rate anzeigen (falls Element existiert)
  const shortfallEl = document.getElementById("mc-shortfall-rate");
  if (shortfallEl) {
    shortfallEl.textContent = `${results.shortfallRate.toFixed(1)}%`;
    shortfallEl.classList.remove("stat-value--success", "stat-value--warning", "stat-value--danger");
    if (results.shortfallRate <= 5) {
      shortfallEl.classList.add("stat-value--success");
    } else if (results.shortfallRate <= 20) {
      shortfallEl.classList.add("stat-value--warning");
    } else {
      shortfallEl.classList.add("stat-value--danger");
    }
  }
  
  // Nominale Werte
  document.getElementById("mc-median-end").textContent = formatCurrency(results.medianEnd);
  document.getElementById("mc-range-end").textContent = 
    `${formatCurrency(results.p10End)} - ${formatCurrency(results.p90End)}`;
  document.getElementById("mc-worst-case").textContent = formatCurrency(results.p5End);
  document.getElementById("mc-best-case").textContent = formatCurrency(results.p95End);
  document.getElementById("mc-iterations-done").textContent = nf0.format(results.iterations);
  
  // Inflationsbereinigte Werte (real)
  document.getElementById("mc-median-end-real").textContent = formatCurrency(results.medianEndReal);
  document.getElementById("mc-range-end-real").textContent = 
    `${formatCurrency(results.p10EndReal)} - ${formatCurrency(results.p90EndReal)}`;
  document.getElementById("mc-worst-case-real").textContent = formatCurrency(results.p5EndReal);
  document.getElementById("mc-best-case-real").textContent = formatCurrency(results.p95EndReal);
  
  // Zusätzliche Metriken
  document.getElementById("mc-retirement-wealth").textContent = 
    `${formatCurrency(results.retirementMedian)} / ${formatCurrency(results.retirementMedianReal)}`;
  document.getElementById("mc-capital-preservation").textContent = `${results.capitalPreservationRate.toFixed(1)}%`;
  document.getElementById("mc-mean-end").textContent = 
    `${formatCurrency(results.meanEnd)} / ${formatCurrency(results.meanEndReal)}`;
  
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
  }
  
  // Badge im Tab anzeigen
  if (mcBadgeEl) {
    mcBadgeEl.style.display = "inline";
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
  
  const { percentiles, months, savingsYears } = results;
  if (!months.length) return;
  
  const padX = 60;
  const padY = 50;
  const xDenom = Math.max(months.length - 1, 1);
  
  // Min/Max für beide Skalierungen
  const minVal = Math.max(1000, Math.min(...percentiles.p5.filter(v => v > 0)));
  const maxVal = Math.max(minVal * 10, ...percentiles.p95);
  
  let toXY;
  
  if (mcUseLogScale) {
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
    // Lineare Skala
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
  
  if (mcUseLogScale) {
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
  
  // Zeichne Bänder (von außen nach innen)
  fillBand(percentiles.p10, percentiles.p90, "rgba(99, 102, 241, 0.15)"); // 80% Band
  fillBand(percentiles.p25, percentiles.p75, "rgba(99, 102, 241, 0.25)"); // 50% Band
  
  // Individuelle Pfade (falls aktiviert)
  if (results.showIndividual && results.allHistories?.length) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 0.5;
    
    for (const history of results.allHistories) {
      ctx.beginPath();
      history.forEach((row, i) => {
        const [x, y] = toXY(i, row.total);
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
  percentiles.p50.forEach((val, i) => {
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
  percentiles.p5.forEach((val, i) => {
    const [x, y] = toXY(i, val);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  
  ctx.strokeStyle = "rgba(34, 197, 94, 0.6)";
  ctx.beginPath();
  percentiles.p95.forEach((val, i) => {
    const [x, y] = toXY(i, val);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  
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

// Monte-Carlo Button Event Handler
document.getElementById("btn-monte-carlo")?.addEventListener("click", async () => {
  try {
    messageEl.textContent = "";
    const mode = form.querySelector('input[name="rent_mode"]:checked')?.value || "eur";
    const inflationAdjust = document.getElementById("inflation_adjust_withdrawal")?.checked ?? true;
    const inflationAdjustSpecialSavings = document.getElementById("inflation_adjust_special_savings")?.checked ?? true;
    const inflationAdjustSpecialWithdrawal = document.getElementById("inflation_adjust_special_withdrawal")?.checked ?? true;
    
    const params = {
      start_savings: readNumber("start_savings", { min: 0 }),
      start_etf: readNumber("start_etf", { min: 0 }),
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
      basiszins: readNumber("basiszins", { min: 0, max: 10 }),
      rent_mode: mode,
      capital_preservation_enabled: document.getElementById("capital_preservation_enabled")?.checked ?? false,
      capital_preservation_threshold: readNumber("capital_preservation_threshold", { min: 10, max: 100 }),
      capital_preservation_reduction: readNumber("capital_preservation_reduction", { min: 5, max: 75 }),
      capital_preservation_recovery: readNumber("capital_preservation_recovery", { min: 0, max: 50 }),
    };
    
    // Params für Export speichern
    lastParams = params;
    
    const iterations = readNumber("mc_iterations", { min: 100, max: 10000 });
    const volatility = readNumber("mc_volatility", { min: 1, max: 50 });
    const showIndividual = document.getElementById("mc_show_individual")?.checked || false;
    
    // Button deaktivieren während Simulation läuft
    const btn = document.getElementById("btn-monte-carlo");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Simuliere...";
    }
    
    await runMonteCarloSimulation(params, iterations, volatility, showIndividual);
    
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Monte-Carlo starten";
    }
    
    messageEl.textContent = `Monte-Carlo-Simulation abgeschlossen (${iterations} Durchläufe).`;
  } catch (err) {
    const btn = document.getElementById("btn-monte-carlo");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Monte-Carlo starten";
    }
    messageEl.textContent = err.message || String(err);
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
  
  const { percentiles, months, savingsYears } = results;
  const xDenom = Math.max(months.length - 1, 1);
  const idxFloat = (x - padX) / (width - 2 * padX) * xDenom;
  const idx = Math.max(0, Math.min(months.length - 1, Math.round(idxFloat)));
  
  const month = months[idx];
  const year = Math.ceil(month / MONTHS_PER_YEAR);
  const monthInYear = ((month - 1) % MONTHS_PER_YEAR) + 1;
  const phase = month <= savingsYears * MONTHS_PER_YEAR ? "Anspar" : "Entnahme";
  
  const lines = [
    `Jahr ${year}, Monat ${monthInYear} (${phase})`,
    `──────────────────`,
    `95% (Best):  ${formatCurrency(percentiles.p95[idx])}`,
    `75%:         ${formatCurrency(percentiles.p75[idx])}`,
    `50% Median:  ${formatCurrency(percentiles.p50[idx])}`,
    `25%:         ${formatCurrency(percentiles.p25[idx])}`,
    `5% (Worst):  ${formatCurrency(percentiles.p5[idx])}`,
  ];
  
  tooltip.textContent = lines.join("\n");
  tooltip.style.left = `${evt.clientX + 14}px`;
  tooltip.style.top = `${evt.clientY + 12}px`;
  tooltip.setAttribute("data-visible", "true");
  tooltip.setAttribute("aria-hidden", "false");
}

mcGraphCanvas?.addEventListener("mousemove", handleMcHover);
mcGraphCanvas?.addEventListener("mouseleave", hideTooltip);
