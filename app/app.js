const TAX_RATE = 0.26375;
const TEILFREISTELLUNG = 0.7;
const SPARERPAUSCHBETRAG = 1000;

const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const form = document.getElementById("sim-form");
const graphCanvas = document.getElementById("graph");
const tooltip = document.getElementById("tooltip");
const messageEl = document.getElementById("message");
const tableBody = document.querySelector("#year-table tbody");

let graphState = null;
let lastHistory = [];

function toMonthlyRate(annualPercent) {
  return Math.pow(1 + annualPercent / 100, 1 / 12) - 1;
}

function readNumber(id) {
  const el = document.getElementById(id);
  const val = parseFloat(String(el.value).replace(",", "."));
  if (Number.isNaN(val)) {
    throw new Error(`Bitte Wert prüfen: ${el.previousElementSibling?.textContent || id}`);
  }
  return val;
}

function simulate(params) {
  const {
    start_savings,
    start_etf,
    monthly_savings,
    monthly_etf,
    savings_rate_pa,
    etf_rate_pa,
    savings_target,
    annual_raise_percent,
    savings_years,
    withdrawal_years,
    monthly_payout_net,
    monthly_payout_percent,
    special_payout_net_savings,
    special_interval_years_savings,
    special_payout_net_withdrawal,
    special_interval_years_withdrawal,
    sparerpauschbetrag = SPARERPAUSCHBETRAG,
  } = params;

  const history = [];
  let savings = start_savings;
  let currentEtfPrice = 100;
  const etfLots = [];
  if (start_etf > 0) {
    etfLots.push({ amount: start_etf / currentEtfPrice, price: currentEtfPrice, monthIdx: 0 });
  }

  const monthlySavingsRate = toMonthlyRate(savings_rate_pa);
  const monthlyEtfRate = toMonthlyRate(etf_rate_pa);
  const annualRaise = annual_raise_percent / 100;
  const totalMonths = (savings_years + withdrawal_years) * 12;

  let savingsFull = savings >= savings_target;
  let yearlyUsedFreibetrag = 0;
  let currentTaxYear = 0;
  let payoutFromPercentDone = false;
  let payoutValue = monthly_payout_net;
  let payoutPercentPa = monthly_payout_percent;
  let entnahmeStartTotal = null;

  for (let monthIdx = 1; monthIdx <= totalMonths; monthIdx += 1) {
    const isSavingsPhase = monthIdx <= savings_years * 12;
    const yearIdx = Math.floor((monthIdx - 1) / 12);
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
        && monthIdx % (special_interval_years_savings * 12) === 0
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

        // ETF verkaufen (steueroptimiert)
        while (remaining > 0.01 && etfLots.length) {
          const lot = etfLots[etfLots.length - 1];
          const gainPerShare = currentEtfPrice - lot.price;
          const remainingFreibetrag = Math.max(0, sparerpauschbetrag - yearlyUsedFreibetrag);
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

          if (sharesNeeded >= lot.amount) {
            const sharesToSell = lot.amount;
            const totalGain = sharesToSell * gainPerShare * TEILFREISTELLUNG;
            const taxableAfterFreibetrag = Math.max(
              0,
              totalGain - Math.max(0, sparerpauschbetrag - yearlyUsedFreibetrag)
            );
            yearlyUsedFreibetrag += Math.min(totalGain, sparerpauschbetrag - yearlyUsedFreibetrag);
            const partTax = taxableAfterFreibetrag * TAX_RATE;
            const partNet = sharesToSell * currentEtfPrice - partTax;
            remaining -= partNet;
            tax_paid += partTax;
            etfLots.pop();
          } else {
            const sharesToSell = sharesNeeded;
            const totalGain = sharesToSell * gainPerShare * TEILFREISTELLUNG;
            const taxableAfterFreibetrag = Math.max(
              0,
              totalGain - Math.max(0, sparerpauschbetrag - yearlyUsedFreibetrag)
            );
            yearlyUsedFreibetrag += Math.min(totalGain, sparerpauschbetrag - yearlyUsedFreibetrag);
            const partTax = taxableAfterFreibetrag * TAX_RATE;
            const partNet = sharesToSell * currentEtfPrice - partTax;
            lot.amount -= sharesToSell;
            remaining -= partNet;
            tax_paid += partTax;
          }
        }

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
          payoutFromPercentDone = true;
          payoutPercentPa = monthly_payout_percent;
        } else if (payoutValue != null) {
          payoutPercentPa = entnahmeStartTotal > 0 ? (payoutValue * 12 / entnahmeStartTotal * 100) : 0;
        }
      }

      let needed_net = payoutValue || 0;
      if (special_interval_years_withdrawal > 0
        && monthIdx % (special_interval_years_withdrawal * 12) === 0) {
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

        while (remaining > 0.01 && etfLots.length) {
          const lot = etfLots[etfLots.length - 1];
          const gainPerShare = currentEtfPrice - lot.price;
          const remainingFreibetrag = Math.max(0, sparerpauschbetrag - yearlyUsedFreibetrag);
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

          if (sharesNeeded >= lot.amount) {
            const sharesToSell = lot.amount;
            const totalGain = sharesToSell * gainPerShare * TEILFREISTELLUNG;
            const taxableAfterFreibetrag = Math.max(
              0,
              totalGain - Math.max(0, sparerpauschbetrag - yearlyUsedFreibetrag)
            );
            yearlyUsedFreibetrag += Math.min(totalGain, sparerpauschbetrag - yearlyUsedFreibetrag);
            const partTax = taxableAfterFreibetrag * TAX_RATE;
            const partNet = sharesToSell * currentEtfPrice - partTax;
            remaining -= partNet;
            tax_paid += partTax;
            etfLots.pop();
          } else {
            const sharesToSell = sharesNeeded;
            const totalGain = sharesToSell * gainPerShare * TEILFREISTELLUNG;
            const taxableAfterFreibetrag = Math.max(
              0,
              totalGain - Math.max(0, sparerpauschbetrag - yearlyUsedFreibetrag)
            );
            yearlyUsedFreibetrag += Math.min(totalGain, sparerpauschbetrag - yearlyUsedFreibetrag);
            const partTax = taxableAfterFreibetrag * TAX_RATE;
            const partNet = sharesToSell * currentEtfPrice - partTax;
            lot.amount -= sharesToSell;
            remaining -= partNet;
            tax_paid += partTax;
          }
        }

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

    history.push({
      month: monthIdx,
      year: yearIdx + 1,
      phase: isSavingsPhase ? "Anspar" : "Entnahme",
      savings,
      etf: etf_value,
      total: savings + etf_value,
      savings_contrib,
      etf_contrib,
      savings_interest: savingsInterest,
      withdrawal: withdrawal_paid,
      tax_paid,
      payout_value: isSavingsPhase ? null : payoutValue,
      payout_percent_pa: isSavingsPhase ? null : payoutPercentPa,
      return_gain: etfGrowth + savingsInterest,
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
  const etfs = history.map(r => r.etf);
  const savings = history.map(r => r.savings);
  const maxVal = Math.max(1, ...totals);
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
  const steps = 5;
  for (let i = 0; i <= steps; i += 1) {
    const val = maxVal * (i / steps);
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
    const idx = Math.min(year * 12 - 1, history.length - 1);
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
  drawLine(etfs, "#2563eb");
  drawLine(savings, "#0ea5e9");

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
    `ETF: ${formatCurrency(row.etf)} | TG: ${formatCurrency(row.savings)}`
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

form.addEventListener("submit", (e) => {
  e.preventDefault();
  try {
    messageEl.textContent = "";
    const mode = form.querySelector('input[name="rent_mode"]:checked')?.value || "eur";
    const params = {
      start_savings: readNumber("start_savings"),
      start_etf: readNumber("start_etf"),
      monthly_savings: readNumber("monthly_savings"),
      monthly_etf: readNumber("monthly_etf"),
      savings_rate_pa: readNumber("savings_rate"),
      etf_rate_pa: readNumber("etf_rate"),
      savings_target: readNumber("savings_target"),
      annual_raise_percent: readNumber("annual_raise"),
      savings_years: readNumber("years_save"),
      withdrawal_years: readNumber("years_withdraw"),
      monthly_payout_net: mode === "eur" ? readNumber("rent_eur") : null,
      monthly_payout_percent: mode === "percent" ? readNumber("rent_percent") : null,
      special_payout_net_savings: readNumber("special_savings"),
      special_interval_years_savings: readNumber("special_savings_interval"),
      special_payout_net_withdrawal: readNumber("special_withdraw"),
      special_interval_years_withdrawal: readNumber("special_withdraw_interval"),
    };

    lastHistory = simulate(params);
    renderGraph(lastHistory);
    renderTable(lastHistory);
    updateRentFields(lastHistory, mode);
    messageEl.textContent = "Simulation aktualisiert.";
  } catch (err) {
    messageEl.textContent = err.message || String(err);
  }
});

graphCanvas.addEventListener("mousemove", handleHover);
graphCanvas.addEventListener("mouseleave", hideTooltip);
window.addEventListener("resize", () => {
  if (lastHistory.length) renderGraph(lastHistory);
});

// erste Berechnung mit Defaultwerten
form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
