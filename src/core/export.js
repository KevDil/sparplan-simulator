/**
 * ETF Simulator - Export Module
 * Version 3.0
 * 
 * CSV und PDF Export-Funktionen
 * Angepasst für Vue/Pinia Store-Architektur
 */

import { SCENARIO_VERSION } from './constants.js';

// ============ FORMATIERUNG ============

const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ============ CSV EXPORT ============

/**
 * Generiert CSV-Header mit Metadaten
 * @param {Object} scenario - Szenario-Objekt aus dem Store (camelCase)
 * @param {boolean} isMonteCarloExport - Ob MC-spezifische Felder hinzugefügt werden sollen
 */
function generateMetadataHeader(scenario, isMonteCarloExport = false) {
  const now = new Date().toISOString();
  
  let header = `# ETF Sparplan Simulator v${SCENARIO_VERSION}\n`;
  header += `# Exportiert: ${now}\n`;
  header += `# Szenario: ${scenario.name || 'Unbenannt'}\n`;
  header += `#\n`;
  header += `# Parameter:\n`;
  header += `# - Ansparphase: ${scenario.yearsSave} Jahre\n`;
  header += `# - Entnahmephase: ${scenario.yearsWithdraw} Jahre\n`;
  header += `# - Startkapital TG: ${nf0.format(scenario.startSavings)} €\n`;
  header += `# - Startkapital ETF: ${nf0.format(scenario.startEtf)} €\n`;
  header += `# - Monatl. Sparen TG: ${nf0.format(scenario.monthlySavings)} €\n`;
  header += `# - Monatl. Sparen ETF: ${nf0.format(scenario.monthlyEtf)} €\n`;
  header += `# - TG-Zins p.a.: ${nf2.format(scenario.savingsRate)}%\n`;
  header += `# - ETF-Rendite p.a.: ${nf2.format(scenario.etfRate)}%\n`;
  header += `# - Inflation p.a.: ${nf2.format(scenario.inflationRate)}%\n`;
  
  if (isMonteCarloExport) {
    header += `# - MC-Iterationen: ${scenario.mcIterations}\n`;
    header += `# - Volatilität: ${nf2.format(scenario.mcVolatility)}%\n`;
  }
  
  header += `#\n`;
  return header;
}

/**
 * Exportiert Standard-Simulation als CSV
 * @param {Array} history - Simulations-History (snake_case Feldnamen)
 * @param {Object} scenario - Szenario aus dem Store (camelCase)
 */
export function exportStandardToCsv(history, scenario) {
  if (!history?.length) {
    throw new Error('Keine Simulationsdaten vorhanden');
  }
  if (!scenario) {
    throw new Error('Kein Szenario übergeben');
  }
  
  const metadata = generateMetadataHeader(scenario);
  
  // CSV-Spalten
  const columns = [
    'Monat', 'Jahr', 'Phase',
    'Tagesgeld', 'ETF', 'Gesamt', 'Gesamt (real)',
    'Einzahlung TG', 'Einzahlung ETF',
    'TG-Zinsen', 'Entnahme (brutto)', 'Entnahme (netto)',
    'Steuern', 'Vorabpauschale', 'Fehlbetrag',
    'Inflation (kumuliert)'
  ];
  
  let csv = metadata;
  csv += columns.join(';') + '\n';
  
  for (const row of history) {
    const values = [
      row.month,
      row.year,
      row.phase,
      nf2.format(row.savings),
      nf2.format(row.etf),
      nf2.format(row.total),
      nf2.format(row.total_real),
      nf2.format(row.savings_contrib || 0),
      nf2.format(row.etf_contrib || 0),
      nf2.format(row.savings_interest || 0),
      nf2.format(row.withdrawal || 0),
      nf2.format(row.withdrawal_net || 0),
      nf2.format(row.tax_paid || 0),
      nf2.format(row.vorabpauschale_tax || 0),
      nf2.format(row.shortfall || 0),
      nf2.format(row.cumulative_inflation || 1),
    ];
    csv += values.join(';') + '\n';
  }
  
  downloadCsv(csv, `etf_simulation_${formatDateForFilename()}.csv`);
}

/**
 * Exportiert Jahresübersicht als CSV
 * @param {Array} history - Simulations-History (snake_case Feldnamen)
 * @param {Object} scenario - Szenario aus dem Store (camelCase)
 */
export function exportYearlyToCsv(history, scenario) {
  if (!history?.length) {
    throw new Error('Keine Simulationsdaten vorhanden');
  }
  if (!scenario) {
    throw new Error('Kein Szenario übergeben');
  }
  
  const metadata = generateMetadataHeader(scenario);
  
  // Nach Jahren gruppieren
  const yearlyData = aggregateByYear(history);
  
  const columns = [
    'Jahr', 'Phase',
    'Tagesgeld (Jahresende)', 'ETF (Jahresende)', 'Gesamt', 'Gesamt (real)',
    'Einzahlungen', 'Rendite', 'Entnahmen (gesamt)', 'Steuern (gesamt)'
  ];
  
  let csv = metadata;
  csv += columns.join(';') + '\n';
  
  for (const row of yearlyData) {
    const values = [
      row.year,
      row.phase,
      nf2.format(row.savings),
      nf2.format(row.etf),
      nf2.format(row.total),
      nf2.format(row.total_real),
      nf2.format(row.deposits),
      nf2.format(row.returns),
      nf2.format(row.withdrawals),
      nf2.format(row.taxes),
    ];
    csv += values.join(';') + '\n';
  }
  
  downloadCsv(csv, `etf_simulation_jahresuebersicht_${formatDateForFilename()}.csv`);
}

/**
 * Exportiert Monte-Carlo-Ergebnisse als CSV
 * @param {Object} results - MC-Ergebnisse
 * @param {Object} scenario - Szenario aus dem Store (camelCase)
 */
export function exportMonteCarloToCsv(results, scenario) {
  if (!results) {
    throw new Error('Keine Monte-Carlo-Ergebnisse vorhanden');
  }
  if (!scenario) {
    throw new Error('Kein Szenario übergeben');
  }
  
  const metadata = generateMetadataHeader(scenario, true);
  
  // Zusammenfassung
  let csv = metadata;
  csv += '# ZUSAMMENFASSUNG\n';
  csv += `Iterationen;${results.iterations}\n`;
  csv += `Volatilität;${nf2.format(results.volatility)}%\n`;
  csv += `Erfolgsrate;${nf2.format(results.successRate)}%\n`;
  csv += `Ruinwahrscheinlichkeit;${nf2.format(results.ruinProbability)}%\n`;
  csv += `Kapitalerhalt-Rate;${nf2.format(results.capitalPreservationRate)}%\n`;
  csv += `\n`;
  csv += `Median Endvermögen;${nf0.format(results.medianEnd)} €\n`;
  csv += `Median Endvermögen (real);${nf0.format(results.medianEndReal)} €\n`;
  csv += `5. Perzentil;${nf0.format(results.p5End)} €\n`;
  csv += `95. Perzentil;${nf0.format(results.p95End)} €\n`;
  csv += `\n`;
  
  // SoRR-Daten
  if (results.sorr) {
    csv += '# SEQUENCE-OF-RETURNS-RISIKO\n';
    csv += `SoRR-Score;${nf2.format(results.sorr.sorRiskScore)}\n`;
    csv += `Korrelation frühe Renditen;${nf2.format(results.sorr.correlationEarlyReturns)}\n`;
    csv += `Worst Sequence Endvermögen;${nf0.format(results.sorr.worstSequenceEnd)} €\n`;
    csv += `Best Sequence Endvermögen;${nf0.format(results.sorr.bestSequenceEnd)} €\n`;
    csv += `\n`;
  }
  
  // Perzentil-Zeitreihe
  csv += '# PERZENTILE PRO MONAT\n';
  csv += 'Monat;P5;P10;P25;Median;P75;P90;P95\n';
  
  for (let i = 0; i < results.months.length; i++) {
    const p = results.percentiles;
    csv += [
      results.months[i],
      nf0.format(p.p5[i]),
      nf0.format(p.p10[i]),
      nf0.format(p.p25[i]),
      nf0.format(p.p50[i]),
      nf0.format(p.p75[i]),
      nf0.format(p.p90[i]),
      nf0.format(p.p95[i]),
    ].join(';') + '\n';
  }
  
  downloadCsv(csv, `etf_monte_carlo_${formatDateForFilename()}.csv`);
}

// ============ HTML REPORT ============

/**
 * Generiert HTML-Report (für PDF-Druck)
 * @param {Array} history - Simulations-History
 * @param {Object} mcResults - MC-Ergebnisse (optional)
 * @param {Object} scenario - Szenario aus dem Store (camelCase)
 */
export function generateHtmlReport(history, mcResults, scenario) {
  if (!scenario) {
    throw new Error('Kein Szenario übergeben');
  }
  const sc = scenario;
  const now = new Date().toLocaleString('de-DE');
  
  // Jahresübersicht
  const yearlyData = history ? aggregateByYear(history) : [];
  
  let yearlyTableRows = '';
  for (const row of yearlyData) {
    yearlyTableRows += `
      <tr>
        <td>${row.year}</td>
        <td>${row.phase}</td>
        <td>${nf0.format(row.total)} €</td>
        <td>${nf0.format(row.total_real)} €</td>
        <td>${nf0.format(row.deposits)} €</td>
        <td>${nf0.format(row.withdrawals)} €</td>
      </tr>
    `;
  }
  
  // MC-Zusammenfassung
  let mcSummary = '';
  if (mcResults) {
    mcSummary = `
      <div class="report-section">
        <h2>Monte-Carlo-Analyse</h2>
        <table class="report-table">
          <tr><td>Iterationen</td><td>${mcResults.iterations}</td></tr>
          <tr><td>Volatilität</td><td>${nf2.format(mcResults.volatility)}%</td></tr>
          <tr><td>Erfolgsrate</td><td>${nf2.format(mcResults.successRate)}%</td></tr>
          <tr><td>Ruinwahrscheinlichkeit</td><td>${nf2.format(mcResults.ruinProbability)}%</td></tr>
          <tr><td>Median Endvermögen</td><td>${nf0.format(mcResults.medianEnd)} €</td></tr>
          <tr><td>5. Perzentil</td><td>${nf0.format(mcResults.p5End)} €</td></tr>
          <tr><td>95. Perzentil</td><td>${nf0.format(mcResults.p95End)} €</td></tr>
        </table>
      </div>
    `;
  }
  
  const html = `
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>ETF Simulator Report - ${sc.name}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 1000px;
      margin: 0 auto;
      padding: 20px;
      color: #1a1a2e;
    }
    h1 { color: #f59e0b; border-bottom: 2px solid #f59e0b; padding-bottom: 10px; }
    h2 { color: #3b82f6; margin-top: 30px; }
    .report-header { display: flex; justify-content: space-between; align-items: center; }
    .report-date { color: #666; font-size: 14px; }
    .report-section { margin: 20px 0; }
    .report-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
    .report-card {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      border-left: 4px solid #3b82f6;
    }
    .report-card h3 { margin: 0 0 10px 0; color: #333; font-size: 14px; }
    .report-card .value { font-size: 24px; font-weight: bold; color: #1a1a2e; }
    .report-table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
    }
    .report-table th, .report-table td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    .report-table th { background: #f0f0f0; }
    .report-table tr:hover { background: #f8f9fa; }
    @media print {
      body { padding: 0; }
      .report-section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="report-header">
    <h1>ETF Sparplan Simulator Report</h1>
    <span class="report-date">Erstellt: ${now}</span>
  </div>
  
  <div class="report-section">
    <h2>Szenario: ${sc.name}</h2>
    <div class="report-grid">
      <div class="report-card">
        <h3>Ansparphase</h3>
        <div class="value">${sc.yearsSave} Jahre</div>
      </div>
      <div class="report-card">
        <h3>Entnahmephase</h3>
        <div class="value">${sc.yearsWithdraw} Jahre</div>
      </div>
      <div class="report-card">
        <h3>Monatliche Sparrate</h3>
        <div class="value">${nf0.format(sc.monthlySavings + sc.monthlyEtf)} €</div>
      </div>
      <div class="report-card">
        <h3>ETF-Rendite p.a.</h3>
        <div class="value">${nf2.format(sc.etfRate)}%</div>
      </div>
    </div>
  </div>
  
  <div class="report-section">
    <h2>Parameter</h2>
    <table class="report-table">
      <tr><td>Startkapital Tagesgeld</td><td>${nf0.format(sc.startSavings)} €</td></tr>
      <tr><td>Startkapital ETF</td><td>${nf0.format(sc.startEtf)} €</td></tr>
      <tr><td>Tagesgeld-Zins p.a.</td><td>${nf2.format(sc.savingsRate)}%</td></tr>
      <tr><td>ETF TER</td><td>${nf2.format(sc.etfTer)}%</td></tr>
      <tr><td>Inflation p.a.</td><td>${nf2.format(sc.inflationRate)}%</td></tr>
      <tr><td>Sparerpauschbetrag</td><td>${nf0.format(sc.sparerpauschbetrag)} €</td></tr>
    </table>
  </div>
  
  ${mcSummary}
  
  <div class="report-section">
    <h2>Jahresübersicht</h2>
    <table class="report-table">
      <thead>
        <tr>
          <th>Jahr</th>
          <th>Phase</th>
          <th>Gesamt</th>
          <th>Gesamt (real)</th>
          <th>Einzahlungen</th>
          <th>Entnahmen</th>
        </tr>
      </thead>
      <tbody>
        ${yearlyTableRows}
      </tbody>
    </table>
  </div>
</body>
</html>
  `;
  
  return html;
}

/**
 * Öffnet HTML-Report in neuem Fenster (für Drucken als PDF)
 */
export function openHtmlReportForPrint(history, mcResults, scenario) {
  const html = generateHtmlReport(history, mcResults, scenario);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  
  if (win) {
    win.onload = () => {
      setTimeout(() => win.print(), 500);
    };
  }
}

// ============ HELPERS ============

/**
 * Aggregiert History nach Jahren
 */
function aggregateByYear(history) {
  const years = {};
  
  for (const row of history) {
    if (!years[row.year]) {
      years[row.year] = {
        year: row.year,
        phase: row.phase,
        savings: 0,
        etf: 0,
        total: 0,
        total_real: 0,
        deposits: 0,
        returns: 0,
        withdrawals: 0,
        taxes: 0,
      };
    }
    
    const y = years[row.year];
    y.savings = row.savings;
    y.etf = row.etf;
    y.total = row.total;
    y.total_real = row.total_real;
    y.deposits += (row.savings_contrib || 0) + (row.etf_contrib || 0);
    y.returns += row.return_gain || 0;
    y.withdrawals += row.withdrawal || 0;
    y.taxes += row.tax_paid || 0;
    y.phase = row.phase;
  }
  
  return Object.values(years).sort((a, b) => a.year - b.year);
}

/**
 * Generiert Dateiname mit Datum
 */
function formatDateForFilename() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Lädt CSV-Datei herunter
 */
function downloadCsv(content, filename) {
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
