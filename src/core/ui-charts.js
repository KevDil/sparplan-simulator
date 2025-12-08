/**
 * ETF Simulator - UI Charts Module
 * Version 2.0
 * 
 * Chart-Rendering für Standard- und Monte-Carlo-Simulationen
 */

import { Y_AXIS_STEPS, MONTHS_PER_YEAR } from './constants.js';

// ============ FORMATIERUNG ============

const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatCurrency(value) {
  return nf0.format(value) + ' €';
}

export function formatPercent(value, decimals = 1) {
  return nf1.format(value) + '%';
}

// ============ FARBEN ============

const COLORS = {
  total: '#f59e0b',      // Amber
  real: '#22c55e',       // Green
  savings: '#3b82f6',    // Blue
  etf: '#8b5cf6',        // Purple
  median: '#f59e0b',
  band50: 'rgba(99, 102, 241, 0.35)',
  band80: 'rgba(99, 102, 241, 0.15)',
  p5: '#ef4444',
  p95: '#22c55e',
  grid: 'rgba(255, 255, 255, 0.1)',
  text: 'rgba(255, 255, 255, 0.7)',
  anspar: 'rgba(56, 189, 248, 0.1)',
  entnahme: 'rgba(139, 92, 246, 0.05)',
};

// ============ CHART STATE ============

let standardChartState = null;
let mcChartState = null;

// ============ STANDARD CHART ============

/**
 * Zeichnet den Standard-Vermögensverlauf
 */
export function drawStandardChart(history, options = {}) {
  const canvas = document.getElementById('graph');
  if (!canvas || !history?.length) return;
  
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  const width = rect.width;
  const height = rect.height;
  // Wenn der Canvas gerade unsichtbar ist (z.B. anderer Tab aktiv), nicht neu zeichnen,
  // damit wir keine "zusammengedrückten" Charts erzeugen.
  if (!width || !height) {
    return;
  }

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  
  const margin = { top: 20, right: 20, bottom: 40, left: 70 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  
  // Daten vorbereiten
  const data = history.map((r, i) => ({
    x: i,
    month: r.month,
    year: r.year,
    total: r.total,
    real: r.total_real,
    phase: r.phase,
  }));
  
  // Y-Skala
  const useLog = options.logScale ?? false;
  const maxVal = Math.max(...data.map(d => Math.max(d.total, d.real)));
  const minVal = useLog ? Math.max(1, Math.min(...data.map(d => Math.min(d.total, d.real)))) : 0;
  
  let yScale;
  if (useLog) {
    const logMin = Math.log10(minVal);
    const logMax = Math.log10(maxVal);
    yScale = (val) => margin.top + (1 - (Math.log10(Math.max(val, 1)) - logMin) / (logMax - logMin)) * chartHeight;
  } else {
    yScale = (val) => margin.top + (1 - val / maxVal) * chartHeight;
  }
  
  const xScale = (idx) => margin.left + (idx / (data.length - 1)) * chartWidth;
  
  // Hintergrund löschen
  ctx.clearRect(0, 0, width, height);
  
  // Grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  
  // Y-Achse Grid und Labels
  const yTicks = calculateYTicks(minVal, maxVal, Y_AXIS_STEPS, useLog);
  for (const tick of yTicks) {
    const y = yScale(tick);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(width - margin.right, y);
    ctx.stroke();
    
    ctx.fillStyle = COLORS.text;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatCompact(tick), margin.left - 8, y + 1);
  }

  // Phasen-Trennung (Anspar → Entnahme) wie in der Legacy-Version
  const switchIdx = data.findIndex(d => d.phase === 'Entnahme');
  if (switchIdx !== -1) {
    const xSwitch = xScale(switchIdx);
    ctx.strokeStyle = '#6b7280';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(xSwitch, margin.top);
    ctx.lineTo(xSwitch, height - margin.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#94a3b8';
    ctx.font = "12px 'Segoe UI', sans-serif";
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('Entnahme ->', xSwitch - 6, margin.top + 40);
  }
  
  // X-Achse Labels (Jahre)
  const yearLabels = [];
  let lastYear = 0;
  for (let i = 0; i < data.length; i += 12) {
    const year = data[i].year;
    if (year !== lastYear) {
      yearLabels.push({ x: xScale(i), label: String(year) });
      lastYear = year;
    }
  }
  
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const label of yearLabels) {
    ctx.fillText(label.label, label.x, height - margin.bottom + 8);
  }
  
  // Linien zeichnen
  // Real (grün)
  ctx.strokeStyle = COLORS.real;
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = xScale(i);
    const y = yScale(d.real);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  
  // Total (orange)
  ctx.strokeStyle = COLORS.total;
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = xScale(i);
    const y = yScale(d.total);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  
  // State speichern für Tooltip
  standardChartState = {
    data,
    xScale,
    yScale,
    margin,
    width,
    height,
  };
}

/**
 * Zeichnet Monte-Carlo-Chart mit Perzentil-Bändern
 */
export function drawMonteCarloChart(results, options = {}) {
  const canvas = document.getElementById('mc-graph');
  if (!canvas || !results) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  const width = rect.width;
  const height = rect.height;
  // Wenn der Canvas gerade unsichtbar ist (z.B. MC-Tab nicht aktiv), Zeichnung beibehalten
  // und nicht mit Höhe/Breite 0 neu rendern.
  if (!width || !height) {
    return;
  }

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const { percentiles, percentilesReal, months, savingsYears } = results;
  if (!months || !months.length) return;

  const useReal = options.showReal ?? false;
  const activePercentiles = useReal && percentilesReal ? percentilesReal : percentiles;

  const padX = 60;
  const padY = 50;
  const xDenom = Math.max(months.length - 1, 1);

  // Prüfe, ob echte Pleite-Szenarien vorkommen
  const hasZeroScenarios = activePercentiles.p5.some(v => v <= 0) || activePercentiles.p10.some(v => v <= 0);

  // Log-/Linear-Skala wie in der Legacy-Version
  const effectiveLogScale = options.logScale ?? true;
  const LOG_FLOOR = 1;

  const positiveP5 = activePercentiles.p5.filter(v => v > 0);
  const minVal = effectiveLogScale
    ? Math.max(LOG_FLOOR, positiveP5.length > 0 ? Math.min(...positiveP5) : LOG_FLOOR)
    : 0;
  const maxVal = Math.max(minVal * 10, ...activePercentiles.p95);

  let toXY;
  if (effectiveLogScale) {
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
    toXY = (idx, val) => {
      const x = padX + (idx / xDenom) * (width - 2 * padX);
      const y = height - padY - (val / maxVal) * (height - 2 * padY);
      return [x, y];
    };
  }

  // Achsen
  ctx.strokeStyle = '#8b96a9';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, height - padY);
  ctx.lineTo(width - padX, height - padY);
  ctx.moveTo(padX, height - padY);
  ctx.lineTo(padX, padY);
  ctx.stroke();

  // Y-Hilfslinien & Labels
  ctx.font = "12px 'Segoe UI', sans-serif";
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  if (effectiveLogScale) {
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
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(width - padX, y);
      ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      const label = val >= 1_000_000
        ? `${(val / 1_000_000).toFixed(val % 1_000_000 === 0 ? 0 : 1)}M`
        : `${Math.round(val / 1000)}k`;
      ctx.fillText(label, padX - 8, y);
    }
  } else {
    for (let i = 0; i <= Y_AXIS_STEPS; i++) {
      const val = maxVal * (i / Y_AXIS_STEPS);
      const [, y] = toXY(0, val);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(width - padX, y);
      ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      const label = val >= 1_000_000
        ? `${(val / 1_000_000).toFixed(1)}M`
        : `${Math.round(val / 1000)}k`;
      ctx.fillText(label, padX - 8, y);
    }
  }

  // X-Achse: Jahreslabels
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const lastYear = Math.ceil(months.length / MONTHS_PER_YEAR);
  for (let year = 1; year <= lastYear; year += 1) {
    const idx = Math.min(year * MONTHS_PER_YEAR - 1, months.length - 1);
    const [x] = toXY(idx, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.moveTo(x, height - padY);
    ctx.lineTo(x, height - padY + 6);
    ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(String(year), x, height - padY + 8);
  }

  // Hilfsfunktion zum Zeichnen der Perzentil-Bänder
  const fillBand = (lower, upper, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();

    for (let i = 0; i < months.length; i++) {
      const [x, y] = toXY(i, upper[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    for (let i = months.length - 1; i >= 0; i--) {
      const [x, y] = toXY(i, lower[i]);
      ctx.lineTo(x, y);
    }

    ctx.closePath();
    ctx.fill();
  };

  // Bänder (10-90% und 25-75%)
  fillBand(activePercentiles.p10, activePercentiles.p90, COLORS.band80);
  fillBand(activePercentiles.p25, activePercentiles.p75, COLORS.band50);

  // Individuelle Pfade
  if (options.showIndividualPaths && results.allHistories?.length) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 0.5;

    const maxPaths = Math.min(50, results.allHistories.length);
    for (let p = 0; p < maxPaths; p++) {
      const history = results.allHistories[p];
      ctx.beginPath();
      history.forEach((row, i) => {
        const value = useReal ? (row.total_real || row.total) : row.total;
        const [x, y] = toXY(i, value);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }

  // Median-Linie
  ctx.strokeStyle = COLORS.median;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  activePercentiles.p50.forEach((val, i) => {
    const [x, y] = toXY(i, val);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 5%/95%-Linien (gestrichelt)
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;

  ctx.strokeStyle = COLORS.p5;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  activePercentiles.p5.forEach((val, i) => {
    const [x, y] = toXY(i, val);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.strokeStyle = COLORS.p95;
  ctx.beginPath();
  activePercentiles.p95.forEach((val, i) => {
    const [x, y] = toXY(i, val);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  // Ruin-Marker bei Log-Skala
  if (effectiveLogScale && hasZeroScenarios) {
    ctx.fillStyle = 'rgba(239, 68, 68, 0.7)';
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
    ctx.lineWidth = 2;

    activePercentiles.p5.forEach((val, i) => {
      if (val <= LOG_FLOOR) {
        const [x, y] = toXY(i, LOG_FLOOR);
        ctx.beginPath();
        ctx.moveTo(x, y + 6);
        ctx.lineTo(x - 5, y - 4);
        ctx.lineTo(x + 5, y - 4);
        ctx.closePath();
        ctx.fill();
      }
    });

    const firstRuinIdx = activePercentiles.p5.findIndex(v => v <= LOG_FLOOR);
    if (firstRuinIdx >= 0) {
      const [x, y] = toXY(firstRuinIdx, LOG_FLOOR);
      ctx.font = "11px 'Segoe UI', sans-serif";
      ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('⚠ Pleite-Szenarien', x + 8, y - 2);
    }
  }

  // Phasen-Trennung (Anspar → Entnahme)
  const savingsYearsOverride = typeof options.savingsYears === 'number' ? options.savingsYears : null;
  const savingsYearsVal = savingsYearsOverride != null
    ? savingsYearsOverride
    : (typeof results.savingsYears === 'number'
        ? results.savingsYears
        : (typeof savingsYears === 'number' ? savingsYears : 0));

  if (savingsYearsVal > 0) {
    const switchIdx = savingsYearsVal * MONTHS_PER_YEAR;
    if (switchIdx >= 0 && switchIdx <= months.length - 1) {
      const [sx] = toXY(switchIdx, 0);
      ctx.strokeStyle = '#6b7280';
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, padY);
      ctx.lineTo(sx, height - padY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('Entnahme →', sx - 6, padY + 20);
    }
  }

  // State für Tooltip
  const xScaleForState = (idx) => padX + (idx / xDenom) * (width - 2 * padX);
  const marginState = { top: padY, right: padX, bottom: padY, left: padX };

  mcChartState = {
    percentiles: activePercentiles,
    xScale: xScaleForState,
    yScale: null, // nicht benötigt für Tooltip
    margin: marginState,
    width,
    height,
    numMonths: months.length,
  };
}

/**
 * Zeichnet Vergleichs-Chart für mehrere Szenarien
 */
export function drawComparisonChart(scenarios, options = {}) {
  const canvas = document.getElementById('comparison-graph');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  
  const width = rect.width;
  const height = rect.height;
  const margin = { top: 20, right: 100, bottom: 40, left: 70 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  
  const scenarioColors = ['#f59e0b', '#3b82f6', '#8b5cf6'];
  
  // Alle Daten sammeln
  const allData = [];
  for (const [id, result] of Object.entries(scenarios)) {
    if (!result?.history) continue;
    allData.push({
      id,
      history: result.history,
      color: scenarioColors[['A', 'B', 'C'].indexOf(id)] || '#888',
    });
  }
  
  if (allData.length === 0) return;
  
  // Maximalwert über alle Szenarien
  const maxVal = Math.max(...allData.flatMap(d => d.history.map(r => r.total)));
  const numMonths = Math.max(...allData.map(d => d.history.length));
  
  const yScale = (val) => margin.top + (1 - val / maxVal) * chartHeight;
  const xScale = (idx) => margin.left + (idx / (numMonths - 1)) * chartWidth;
  
  ctx.clearRect(0, 0, width, height);
  
  // Grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  
  const yTicks = calculateYTicks(0, maxVal, Y_AXIS_STEPS, false);
  for (const tick of yTicks) {
    const y = yScale(tick);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(width - margin.right, y);
    ctx.stroke();
    
    ctx.fillStyle = COLORS.text;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatCompact(tick), margin.left - 8, y);
  }
  
  // Linien für jedes Szenario
  for (const { id, history, color } of allData) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    history.forEach((r, i) => {
      const x = xScale(i);
      const y = yScale(options.showReal ? r.total_real : r.total);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    
    // Legende
    const legendY = margin.top + 20 + ['A', 'B', 'C'].indexOf(id) * 20;
    ctx.fillStyle = color;
    ctx.fillRect(width - margin.right + 10, legendY, 16, 3);
    ctx.fillStyle = COLORS.text;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Szenario ${id}`, width - margin.right + 32, legendY + 2);
  }
}

// ============ HELPERS ============

/**
 * Berechnet Y-Achsen-Ticks
 */
function calculateYTicks(min, max, count, useLog) {
  if (useLog) {
    const logMin = Math.floor(Math.log10(Math.max(min, 1)));
    const logMax = Math.ceil(Math.log10(max));
    const ticks = [];
    for (let i = logMin; i <= logMax; i++) {
      ticks.push(Math.pow(10, i));
    }
    return ticks;
  }
  
  const range = max - min;
  const step = range / count;
  const ticks = [];
  for (let i = 0; i <= count; i++) {
    ticks.push(min + step * i);
  }
  return ticks;
}

/**
 * Formatiert Zahlen kompakt
 */
function formatCompact(value) {
  if (value >= 1000000) return nf1.format(value / 1000000) + ' M€';
  if (value >= 1000) return nf0.format(value / 1000) + ' k€';
  return nf0.format(value) + ' €';
}

// ============ TOOLTIP ============

/**
 * Initialisiert Chart-Tooltips
 */
export function initChartTooltips() {
  const tooltip = document.getElementById('tooltip');
  const standardCanvas = document.getElementById('graph');
  const mcCanvas = document.getElementById('mc-graph');
  
  if (!tooltip) return;
  
  function showTooltip(x, y, content) {
    tooltip.innerHTML = content;
    tooltip.style.left = `${x + 15}px`;
    tooltip.style.top = `${y - 10}px`;
    tooltip.setAttribute('data-visible', 'true');
  }
  
  function hideTooltip() {
    tooltip.setAttribute('data-visible', 'false');
  }
  
  // Standard-Chart Tooltip
  standardCanvas?.addEventListener('mousemove', (e) => {
    if (!standardChartState) return;
    
    const rect = standardCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { data, xScale, margin, width } = standardChartState;
    
    if (x < margin.left || x > width - margin.right) {
      hideTooltip();
      return;
    }
    
    // Finde nächsten Datenpunkt
    const ratio = (x - margin.left) / (width - margin.left - margin.right);
    const idx = Math.round(ratio * (data.length - 1));
    const point = data[idx];
    
    if (point) {
      const content = `
        <strong>Jahr ${point.year}, Monat ${((point.month - 1) % 12) + 1}</strong><br>
        Nominal: ${formatCurrency(point.total)}<br>
        Real: ${formatCurrency(point.real)}<br>
        Phase: ${point.phase}
      `;
      showTooltip(e.clientX, e.clientY, content);
    }
  });
  
  standardCanvas?.addEventListener('mouseleave', hideTooltip);
  
  // MC-Chart Tooltip
  mcCanvas?.addEventListener('mousemove', (e) => {
    if (!mcChartState) return;
    
    const rect = mcCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const { percentiles, xScale, margin, width, numMonths } = mcChartState;
    
    if (x < margin.left || x > width - margin.right) {
      hideTooltip();
      return;
    }
    
    const ratio = (x - margin.left) / (width - margin.left - margin.right);
    const idx = Math.min(Math.round(ratio * (numMonths - 1)), numMonths - 1);
    const year = Math.floor(idx / 12) + 1;
    const month = (idx % 12) + 1;
    
    const content = `
      <strong>Jahr ${year}, Monat ${month}</strong><br>
      Median: ${formatCurrency(percentiles.p50[idx])}<br>
      25-75%: ${formatCurrency(percentiles.p25[idx])} - ${formatCurrency(percentiles.p75[idx])}<br>
      10-90%: ${formatCurrency(percentiles.p10[idx])} - ${formatCurrency(percentiles.p90[idx])}
    `;
    showTooltip(e.clientX, e.clientY, content);
  });
  
  mcCanvas?.addEventListener('mouseleave', hideTooltip);
}

// ============ RISIKO-WIDGET ============

/**
 * Aktualisiert das Risiko-Widget
 */
export function updateRiskWidget(results, mcResults) {
  const widget = document.getElementById('risk-widget');
  if (!widget) return;
  
  // Notgroschen-Status
  let emergencyStatus = 'unknown';
  let emergencyText = '-';
  
  if (mcResults) {
    const fillProb = mcResults.emergencyFillProbability || 0;
    if (fillProb > 80) {
      emergencyStatus = 'good';
      emergencyText = `${nf0.format(fillProb)}% erreichen Ziel`;
    } else if (fillProb > 50) {
      emergencyStatus = 'warning';
      emergencyText = `${nf0.format(fillProb)}% erreichen Ziel`;
    } else {
      emergencyStatus = 'bad';
      emergencyText = `Nur ${nf0.format(fillProb)}% erreichen Ziel`;
    }
  }
  
  // Ruinrisiko
  let ruinStatus = 'unknown';
  let ruinText = '-';
  
  if (mcResults) {
    const ruinProb = mcResults.ruinProbability || 0;
    if (ruinProb < 5) {
      ruinStatus = 'good';
      ruinText = `${nf1.format(ruinProb)}% Pleite-Risiko`;
    } else if (ruinProb < 15) {
      ruinStatus = 'warning';
      ruinText = `${nf1.format(ruinProb)}% Pleite-Risiko`;
    } else {
      ruinStatus = 'bad';
      ruinText = `${nf1.format(ruinProb)}% Pleite-Risiko`;
    }
  }
  
  // Erfolgswahrscheinlichkeit
  let successStatus = 'unknown';
  let successText = '-';
  
  if (mcResults) {
    const successRate = mcResults.successRate || 0;
    if (successRate >= 95) {
      successStatus = 'good';
      successText = `${nf1.format(successRate)}% Erfolg`;
    } else if (successRate >= 80) {
      successStatus = 'warning';
      successText = `${nf1.format(successRate)}% Erfolg`;
    } else {
      successStatus = 'bad';
      successText = `${nf1.format(successRate)}% Erfolg`;
    }
  }
  
  widget.innerHTML = `
    <div class="risk-widget-header">
      <h4>Risiko-Übersicht</h4>
    </div>
    <div class="risk-widget-grid">
      <div class="risk-item risk-item--${successStatus}">
        <span class="risk-indicator"></span>
        <span class="risk-label">Erfolg</span>
        <span class="risk-value">${successText}</span>
      </div>
      <div class="risk-item risk-item--${ruinStatus}">
        <span class="risk-indicator"></span>
        <span class="risk-label">Ruin</span>
        <span class="risk-value">${ruinText}</span>
      </div>
      <div class="risk-item risk-item--${emergencyStatus}">
        <span class="risk-indicator"></span>
        <span class="risk-label">Notgroschen</span>
        <span class="risk-value">${emergencyText}</span>
      </div>
    </div>
  `;
}
