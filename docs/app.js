const TAX_RATE = 0.26375;
const TEILFREISTELLUNG = 0.7;
const SPARERPAUSCHBETRAG = 1000;
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
  };
  
  // Checkbox separat behandeln
  const inflationCheckbox = document.getElementById("inflation_adjust_withdrawal");
  if (inflationCheckbox && stored.inflation_adjust_withdrawal != null) {
    inflationCheckbox.checked = stored.inflation_adjust_withdrawal;
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
    years_withdraw: 30,
    rent_eur: 1000,
    rent_percent: 4.0,
    withdrawal_min: 0,
    withdrawal_max: 0,
    inflation_adjust_withdrawal: true,
    special_withdraw: 15000,
    special_withdraw_interval: 10,
    inflation_rate: 2.0,
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

  const dataHeader = ["Jahr", "Monat", "Phase", "Tagesgeld", "ETF", "Gesamt", "Gesamt (real)", "Rendite", "Entnahme", "Steuern"];
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

// ============ ETF SELLING (EXTRACTED) ============

function sellEtfOptimized(remaining, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag) {
  let taxPaid = 0;
  let freibetragUsed = yearlyUsedFreibetrag;
  
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
        const taxPerShareFull = taxableGainPerShare * TAX_RATE;
        const netPerShareTaxed = currentEtfPrice - taxPerShareFull;
        if (netPerShareTaxed <= 0) break;
        const additionalShares = stillNeeded / netPerShareTaxed;
        sharesNeeded = freibetragCoversShares + additionalShares;
      }
    } else {
      sharesNeeded = remaining / currentEtfPrice;
    }

    const sharesToSell = Math.min(sharesNeeded, lot.amount);
    const totalGain = sharesToSell * gainPerShare * TEILFREISTELLUNG;
    const taxableAfterFreibetrag = Math.max(0, totalGain - Math.max(0, sparerpauschbetrag - freibetragUsed));
    freibetragUsed += Math.min(totalGain, sparerpauschbetrag - freibetragUsed);
    const partTax = taxableAfterFreibetrag * TAX_RATE;
    const partNet = sharesToSell * currentEtfPrice - partTax;
    remaining -= partNet;
    taxPaid += partTax;

    if (sharesNeeded >= lot.amount) {
      etfLots.pop();
    } else {
      lot.amount -= sharesToSell;
    }
  }
  
  return { remaining, taxPaid, yearlyUsedFreibetrag: freibetragUsed };
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
    special_payout_net_withdrawal,
    special_interval_years_withdrawal,
    inflation_rate_pa = 0,
    sparerpauschbetrag = SPARERPAUSCHBETRAG,
  } = params;

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

  for (let monthIdx = 1; monthIdx <= totalMonths; monthIdx += 1) {
    const isSavingsPhase = monthIdx <= savings_years * MONTHS_PER_YEAR;
    const yearIdx = Math.floor((monthIdx - 1) / MONTHS_PER_YEAR);
    
    // Inflation kumulieren
    cumulativeInflation *= (1 + monthlyInflationRate);
    const totalEtfSharesStart = etfLots.reduce((acc, l) => acc + l.amount, 0);
    const totalEtfValueStart = totalEtfSharesStart * currentEtfPrice;

    // Neues Steuerjahr -> Freibetrag zurücksetzen
    if (yearIdx !== currentTaxYear) {
      currentTaxYear = yearIdx;
      yearlyUsedFreibetrag = 0;
    }

    // Wertentwicklung vor Cashflows
    currentEtfPrice *= 1 + monthlyEtfRate;
    const etfGrowth = totalEtfValueStart * monthlyEtfRate;

    const savingsInterest = savings * monthlySavingsRate;
    savings += savingsInterest;

    let savings_contrib = 0;
    let etf_contrib = 0;
    let overflow = 0;
    let withdrawal = 0;
    let tax_paid = 0;
    let withdrawal_paid = 0;
    let monthlyPayout = 0; // Reguläre monatliche Entnahme (ohne Sonderausgaben)

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
        let remaining = special_payout_net_savings;
        withdrawal = remaining;

        const extraCash = Math.max(0, savings - savings_target);
        if (extraCash > 0) {
          const use = Math.min(extraCash, remaining);
          savings -= use;
          remaining -= use;
        }

        // ETF verkaufen (steueroptimiert) - extrahierte Funktion
        const sellResult = sellEtfOptimized(remaining, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag);
        remaining = sellResult.remaining;
        tax_paid += sellResult.taxPaid;
        yearlyUsedFreibetrag = sellResult.yearlyUsedFreibetrag;

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

      monthlyPayout = currentPayout; // Nur reguläre monatliche Entnahme (für Statistik)
      let needed_net = currentPayout;
      if (special_interval_years_withdrawal > 0
        && monthIdx % (special_interval_years_withdrawal * MONTHS_PER_YEAR) === 0) {
        needed_net += special_payout_net_withdrawal;
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
        const sellResult = sellEtfOptimized(remaining, etfLots, currentEtfPrice, yearlyUsedFreibetrag, sparerpauschbetrag);
        remaining = sellResult.remaining;
        tax_paid += sellResult.taxPaid;
        yearlyUsedFreibetrag = sellResult.yearlyUsedFreibetrag;

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
      payout_value: effectivePayout,
      payout_percent_pa: isSavingsPhase ? null : payoutPercentPa,
      return_gain: etfGrowth + savingsInterest,
      cumulative_inflation: cumulativeInflation,
    });
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

  // Entnahme-Statistiken
  // Für Durchschnitt: Gesamtentnahmen (inkl. Sonderausgaben)
  const withdrawals = entnahmeRows.filter(r => r.withdrawal > 0).map(r => r.withdrawal);
  const withdrawalsReal = entnahmeRows.filter(r => r.withdrawal_real > 0).map(r => r.withdrawal_real);
  
  // Für Min/Max: Nur reguläre monatliche Entnahmen (ohne Sonderausgaben)
  const monthlyPayouts = entnahmeRows.filter(r => r.monthly_payout > 0).map(r => r.monthly_payout);
  const monthlyPayoutsReal = entnahmeRows.filter(r => r.monthly_payout_real > 0).map(r => r.monthly_payout_real);
  
  if (withdrawals.length > 0) {
    const avgWithdrawal = withdrawals.reduce((a, b) => a + b, 0) / withdrawals.length;
    document.getElementById("stat-avg-withdrawal").textContent = formatCurrency(avgWithdrawal);
    
    // Reale Kaufkraft der Entnahmen (Durchschnitt)
    const avgWithdrawalReal = withdrawalsReal.reduce((a, b) => a + b, 0) / withdrawalsReal.length;
    document.getElementById("stat-avg-withdrawal-real").textContent = formatCurrency(avgWithdrawalReal);
    
    // Min/Max nur für reguläre monatliche Entnahmen
    if (monthlyPayouts.length > 0) {
      const minMonthly = Math.min(...monthlyPayouts);
      const maxMonthly = Math.max(...monthlyPayouts);
      document.getElementById("stat-minmax-withdrawal").textContent = 
        `${formatCurrency(minMonthly)} / ${formatCurrency(maxMonthly)}`;
      
      const minMonthlyReal = Math.min(...monthlyPayoutsReal);
      const maxMonthlyReal = Math.max(...monthlyPayoutsReal);
      document.getElementById("stat-minmax-withdrawal-real").textContent = 
        `${formatCurrency(minMonthlyReal)} / ${formatCurrency(maxMonthlyReal)}`;
    } else {
      document.getElementById("stat-minmax-withdrawal").textContent = "-";
      document.getElementById("stat-minmax-withdrawal-real").textContent = "-";
    }
  } else {
    document.getElementById("stat-avg-withdrawal").textContent = "-";
    document.getElementById("stat-minmax-withdrawal").textContent = "-";
    document.getElementById("stat-avg-withdrawal-real").textContent = "-";
    document.getElementById("stat-minmax-withdrawal-real").textContent = "-";
  }

  // Steuern gesamt
  const totalTax = history.reduce((sum, r) => sum + (r.tax_paid || 0), 0);
  document.getElementById("stat-total-tax").textContent = formatCurrency(totalTax);

  // Effektive Entnahmerate (bezogen auf Startvermögen Entnahmephase)
  if (entnahmeRows.length > 0 && withdrawals.length > 0) {
    const entnahmeStartIdx = ansparRows.length;
    const entnahmeStartRow = entnahmeStartIdx > 0 ? history[entnahmeStartIdx - 1] : history[0];
    const startCapital = entnahmeStartRow.total;
    const avgAnnualWithdrawal = (withdrawals.reduce((a, b) => a + b, 0) / withdrawals.length) * 12;
    const effectiveRate = startCapital > 0 ? (avgAnnualWithdrawal / startCapital * 100) : 0;
    document.getElementById("stat-effective-rate").textContent = `${nf2.format(effectiveRate)} % p.a.`;
  } else {
    document.getElementById("stat-effective-rate").textContent = "-";
  }
}

function renderGraph(history) {
  const ctx = graphCanvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = graphCanvas.clientWidth || graphCanvas.parentElement.clientWidth || 800;
  const height = graphCanvas.clientHeight || 320;
  graphCanvas.width = width * dpr;
  graphCanvas.height = height * dpr;
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
  const maxVal = Math.max(1, ...totals, ...totalsReal);
  const xDenom = Math.max(history.length - 1, 1);

  const toXY = (idx, val) => {
    const x = padX + (idx / xDenom) * (width - 2 * padX);
    const y = height - padY - (val / maxVal) * (height - 2 * padY);
    return [x, y];
  };

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
  for (let i = 0; i <= Y_AXIS_STEPS; i += 1) {
    const val = maxVal * (i / Y_AXIS_STEPS);
    const [, y] = toXY(0, val);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(width - padX, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(val / 1000)}k`, padX - 8, y);
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
      special_payout_net_withdrawal: readNumber("special_withdraw", { min: 0 }),
      special_interval_years_withdrawal: readNumber("special_withdraw_interval", { min: 0 }),
      inflation_rate_pa: readNumber("inflation_rate", { min: -10, max: 30 }),
      rent_mode: mode,
    };

    lastHistory = simulate(params);
    lastParams = params;
    renderGraph(lastHistory);
    renderTable(lastHistory);
    renderStats(lastHistory, params);
    updateRentFields(lastHistory, mode);
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

// CSV-Export
document.getElementById("btn-export")?.addEventListener("click", () => exportToCsv(lastHistory));

graphCanvas.addEventListener("mousemove", handleHover);
graphCanvas.addEventListener("mouseleave", hideTooltip);
window.addEventListener("resize", () => {
  if (lastHistory.length) renderGraph(lastHistory);
});

// Gespeicherte Werte laden
applyStoredValues();
updateRentModeFields();
