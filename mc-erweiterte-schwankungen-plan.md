# Plan: Erweiterung der Monte-Carlo-Simulation um zusätzliche Schwankungen

> **Status: IMPLEMENTIERT** (Dezember 2025)
> Alle 5 Iterationen vollständig umgesetzt und getestet.

## 1. Aktueller Stand der Simulation

### 1.1 Architekturskizze

- **`simulation-core.js`**
  - Enthält die zentrale Funktion `simulate(params, volatility, options)`.
  - Modelliert ETF-Preis mit lognormalem Zufallsprozess, wenn `volatility > 0`.
  - Alle anderen Größen (Inflation, Tagesgeldzins, Sparraten, Entnahmen, Steuern, Vorabpauschale, Kapitalerhalt-Logik) sind deterministisch gegeben den Szenario-Parametern.
- **`mc-controller.js` / `mc-worker-entry.js` / `stores/monteCarlo.js`**
  - Bauen `params` aus dem Szenario, übergeben `volatility` und `mcOptions` (z.B. Iterationen, Seed, Stress-Szenario) an den Worker.
  - Worker ruft mehrfach `simulate` auf und aggregiert die Historien mit `analyzeMonteCarloResults`.
- **`mc-analysis.js`**
  - Aggregiert die Ergebnisse der vielen Pfade: Perzentile, Erfolgs-/Ruinwahrscheinlichkeiten, Shortfalls, Notgroschen-Metriken etc.

### 1.2 Welche Zufallsgröße ist aktuell modelliert?

- **ETF-Rendite**
  - Annualisierte Zielrendite `etf_rate_pa` wird in eine monatliche Rate `monthlyEtfRate` umgerechnet.
  - Annualisierte Volatilität `volatility` (Eingabe für Monte Carlo) wird per `toMonthlyVolatility(volatility / 100)` in eine monatliche Volatilität umgerechnet.
  - Monatlicher ETF-Return wird als **lognormaler Prozess** modelliert:
    - `continuousMonthlyRate = log(1 + monthlyEtfRate)`
    - Drift = `continuousMonthlyRate - 0.5 * sigma^2`
    - `z ~ N(0,1)` via `randomNormal`
    - `monthlyEtfReturn = exp(drift + sigma * z)`
    - `currentEtfPrice *= monthlyEtfReturn`
- **Stress-Szenarien (`STRESS_SCENARIOS`)**
  - Liefern deterministische Pfade für Jahresrenditen in der Entnahmephase (z.B. früher Crash, spätes Crash-Szenario).
  - Werden auf monatlicher Ebene als deterministische Faktoren umgerechnet.
  - Sind **nicht** zufällig, sondern vordefinierte Pfade.

### 1.3 Konsequenzen / Limitierungen des Status quo

- Die **einzige stochastische Quelle** ist aktuell die ETF-Rendite (bzw. der ETF-Preisprozess).
- Wichtige realweltliche Unsicherheiten werden nur deterministisch abgebildet:
  - Inflation (fester jährlicher Satz `inflation_rate_pa`).
  - Tagesgeld-/Cashzins (`savings_rate_pa`).
  - Gehalt / Sparratenentwicklungen (deterministische jährliche Erhöhung `annual_raise_percent`).
  - Unerwartete Ausgaben werden nur über fixe, periodische Sonderentnahmen modelliert.
  - Steuersätze, Pauschbeträge und Regime bleiben über die Zeit fest (oder folgen festen Tabellen, wie `BASISZINS_HISTORY`).
- Folge: Die Monte-Carlo-Ergebnisse unterschätzen die Bandbreite vieler **haushaltsrelevanter Risiken**, weil alles außer den Aktienrenditen planbar erscheint.

Ziel der Erweiterung ist es, diese Lücke zu schließen und zusätzliche Schwankungsquellen realistisch, aber kontrolliert und für den Nutzer verständlich einzubauen.

---

## 2. Zielbild und Anforderungen

### 2.1 Fachliches Zielbild

- Abbildung eines **realistischeren Haushalts- und Vermögenspfads**, indem neben der Rendite weitere Unsicherheiten berücksichtigt werden:
  - Kaufkraft (Inflationspfad).
  - Verzinsung von Cash/Tagesgeld.
  - Schwankungen im Sparverhalten (Einkommensrisiko, Arbeitslosigkeit etc.).
  - Schwankungen in den Ausgaben (unerwartete Kosten, Gesundheit, größere Anschaffungen).
  - (Später) Änderungen des steuerlichen und regulatorischen Umfelds.
  - (Optional) Unsicherheit der Renten-/Entnahmedauer (Langlebigkeitsrisiko).

### 2.2 Technische Anforderungen

- **Rückwärtskompatibilität**:
  - Bestehende Szenarien ohne neue MC-Optionen müssen exakt die heutigen Ergebnisse liefern.
- **Parametrisierbarkeit**:
  - Alle neuen Schwankungsquellen sollen über Szenario- und/oder MC-Optionen konfigurierbar sein.
  - Einfache Voreinstellungen (z.B. "realistisch", "konservativ"), aber auch Expertentuning.
- **Performance**:
  - Zusätzliche Zufallsgrößen dürfen die Laufzeit nicht explodieren lassen.
  - Ziel: Weiterhin 1.000–10.000 Pfade in < ein paar Sekunden auf typischer Hardware.
- **Reproduzierbarkeit**:
  - Alle Zufallsteile müssen von **dem einen Seed** abhängen (`mcOptions.seed`), sodass Runs reproduzierbar bleiben.
- **Transparenz**:
  - Für jede neue Schwankungsquelle muss klar sein, **was** variiert und **wie stark**.
  - UI-Texte und ggf. Tooltips sollen die Bedeutung verständlich erklären.

---

## 3. Relevante zusätzliche Schwankungen (fachliche Sicht)

Im Folgenden werden sinnvolle Schwankungsdimensionen beschrieben. Nicht alle müssen sofort implementiert werden; wir priorisieren später.

### 3.1 Inflation (Preissteigerungsrate)

- Heute: fester `inflation_rate_pa`.
- Realität:
  - Starke jährliche Schwankungen; Cluster (Inflationsphasen vs. Deflation/Disinflation).
  - Tendenziell positive Korrelation zwischen **Nominalzins** und **Inflation**; teilweise negative Korrelation zwischen **Aktienrenditen** und **überraschend hoher Inflation**.
- Relevanz:
  - Bestimmt reale Kaufkraft der Entnahmen und des Endvermögens.
  - Zentrales Risiko für langfristige FIRE-/Renten-Szenarien.

### 3.2 Zins auf Tagesgeld/Cash (`savings_rate_pa`)

- Heute: fixer Zins.
- Realität:
  - Schwankt mit Zinsumfeld (EZB-Leitzins, Marktzinsen).
  - Tendenziell positiv korreliert mit Inflation.
- Relevanz:
  - Beeinflusst Attraktivität des Cash-Anteils.
  - Kann Pufferwirkung verstärken oder abschwächen.

### 3.3 Einkommens- und Sparratenrisiko

- Heute: `monthly_savings` und `monthly_etf` wachsen nur deterministisch mit `annual_raise_percent`.
- Realität:
  - Gehaltsentwicklung ist unsicher (Beförderungen, Jobwechsel, Arbeitslosigkeit, Teilzeit).
  - In Krisen werden Sparraten oft reduziert oder ausgesetzt.
- Relevanz:
  - Frühere Jahre sind für den Zinseszinseffekt besonders wichtig.
  - Längere Phasen reduzierter Sparleistungen wirken stark auf das Endvermögen.

### 3.4 Ausgaben- / Entnahmerisiko

- Heute:
  - Reguläre Entnahmen sind deterministisch.
  - Sonderausgaben (z.B. alle X Jahre Betrag Y) sind deterministisch.
- Realität:
  - Unerwartete Ausgaben (Auto, Hausreparaturen, Krankheit) treten zufällig auf.
  - Größere Risiken: Pflegekosten, Scheidung, unerwartete Unterstützungsleistungen.
- Relevanz:
  - Einzelne große Ausgabenereignisse können das Portfolio deutlich belasten.

### 3.5 Laufzeit- / Langlebigkeitsrisiko

- Heute: `withdrawal_years` ist fix.
- Realität:
  - Individuelle Lebensdauer ist unsicher.
  - Finanzplanung benötigt Puffer nach oben; z.B. 95%-Quantil der Lebenserwartung.
- Relevanz:
  - Zu kurze Planung → Ruinrisiko in hohem Alter.
  - Sehr lange Planung → ggf. "zu konservative" Entnahmen.

### 3.6 Steuer- und Regimewechsel

- Heute:
  - Abgeltungssteuer, Soli, Kirchensteuer, Pauschbeträge etc. sind fix.
  - `BASISZINS_HISTORY` ist deterministisch.
- Realität:
  - Steuerrecht ändert sich alle paar Jahre.
  - Änderung von Steuersatz, Pauschbetrag, Teilfreistellung möglich.
- Relevanz:
  - Kann Nettoentnahmen signifikant ändern.

### 3.7 Marktregime / Crash-Risiko (über reine Volatilität hinaus)

- Heute:
  - Großer Teil des Sequence-of-Return-Risikos wird durch Zufallsrenditen + Stress-Szenarien abgedeckt.
- Ergänzend sinnvoll:
  - Zufällige Crash-Ereignisse (Zeitpunkt und Tiefe zufällig) statt rein deterministischer Pfade.
  - Regimewechsel (Bullenmarkt, Bärenmarkt, Seitwärtsphase) als stochastischer Prozess.

---

## 4. Priorisierte erste Ausbaustufe

Um die Komplexität zu steuern, werden in einer ersten Ausbaustufe folgende Schwankungen integriert:

1. **Stochastische Inflation**
   - Variation der jährlichen Inflationsrate um einen Mittelwert herum.
   - Optional: Korrelation mit Aktienrenditen.
2. **Stochastische Tagesgeld-/Cashverzinsung**
   - Jährlich schwankender Cashzins, korreliert mit Inflation.
3. **Schwankende Sparraten (Einkommensschocks)**
   - Gelegentliche negative und positive Schocks auf `monthly_savings` / `monthly_etf`.
4. **Unerwartete Ausgaben in der Entnahmephase**
   - Zufällige zusätzliche Entnahmen (z.B. seltene, aber größere Kostenblöcke).
5. **Optionale stochastische Crash-Ereignisse**
   - Zusätzlich zu den bestehenden Stress-Szenarien: zufälliger Crash mit konfigurierter Wahrscheinlichkeit und Tiefe.

Andere Themen (Steuerregime, Langlebigkeit) werden für eine spätere Ausbaustufe vorgesehen.

---

## 5. Technisches Design je Schwankungsart (Stufe 1)

### 5.1 Gemeinsame Designprinzipien

- **Zentrale Stelle für Zufallszahlen** bleibt `simulation-core.js`:
  - Alle neuen Zufallsereignisse nutzen `getRng()` / `randomNormal()` bzw. neue Hilfsfunktionen, nicht `Math.random` direkt.
- **Erweiterung von `params` und `options`**:
  - Neue Felder werden so eingeführt, dass Defaults dem Status quo entsprechen.
  - Beispiel: `mc_inflation_mode = 'deterministic' | 'random'` mit Default `'deterministic'`.
- **Konzentration auf Jahreslogik**:
  - Viele neue Schwankungen (Inflation, Zinsen, Einkommen) sind natürlicherweise jährlich, nicht monatlich.
  - Implementierung: Jährliche Zufallsvariablen erzeugen und auf Monate verteilen.

---

### 5.2 Stochastische Inflation

#### 5.2.1 Fachliches Modell

- Mittelwert der Inflation: vorhandenes `inflation_rate_pa` (z.B. 2%).
- Jährliche Inflation `I_year` wird modelliert als Zufallsvariable um diesen Mittelwert.
- Einfache Verteilungsannahme für Stufe 1:
  - **trunkierte Normalverteilung** (z.B. begrenzt auf [−2%, +15%]) oder **Lognormalverteilung** zur Vermeidung stark negativer Raten.
- Optional/Stufe 1.5: Persistenz/Mean-Reversion über ein einfaches AR(1)- oder Regime-Modell, um längere Hochinflationsphasen realistisch abbilden zu können.
- Optional: negative Korrelation zwischen realen Aktienrenditen und unerwarteter Inflation (siehe 5.7).

#### 5.2.2 Neue Parameter / UI-Felder

- Szenario/MC-Optionen (Expert-Mode):
  - `mc_inflation_mode`: `'deterministic' | 'random'` (Default: `'deterministic'`).
  - `mc_inflation_volatility`: jährliche Standardabweichung der Inflation (z.B. 1–3 Prozentpunkte).
  - `mc_inflation_floor`, `mc_inflation_cap`: optionale Begrenzungen.
  - `mc_corr_return_inflation`: Korrelation zwischen Aktienrendite und Inflation (z.B. −0.2 bis +0.3).

#### 5.2.3 Änderungen in `simulation-core.js`

1. **Erweiterung von `simulate`-Signatur und Param-Auslesung**:
   - `options` um neue Felder ergänzen (z.B. `inflationMode`, `inflationVolatility`, `corrReturnInflation`).
2. **Struktur für jährliche Inflation**:
   - Vor der Monats-Schleife ein Array `annualInflationRates[yearIdx]` erzeugen:
     - Wenn `inflationMode === 'deterministic'`: alle Einträge = `inflation_rate_pa`.
     - Wenn `inflationMode === 'random'`:
       - Ziehung einer Zufallsgröße pro Jahr (z.B. `zI ~ N(0,1)`), dann
         - `inflationYear = inflation_rate_pa + zI * mc_inflation_volatility` (mit Clipping).
       - Optional: Korrelation mit Rendite über gemeinsamen Normalvektor (siehe 5.7).
3. **Monatliche Umrechnung**:
   - Bisher: `monthlyInflationRate = toMonthlyRate(inflation_rate_pa)`.
   - Neu: `monthlyInflationRate = toMonthlyRate(annualInflationRates[yearIdx])`.
4. **Rückwärtskompatibilität**:
   - Default-Werte so wählen, dass bei `mc_inflation_mode = 'deterministic'` das alte Verhalten exakt reproduziert wird.

#### 5.2.4 Auswirkungen auf Analyse

- `mc-analysis.js` nutzt bereits `total_real` und `withdrawal_net_real`.
- Die gesamte Simulation inklusive Steuer- und Vorabpauschalen-Berechnung bleibt nominal; reale Größen (`total_real`, `withdrawal_net_real` etc.) dienen ausschließlich der Auswertung und Anzeige.
- Potenziell neue Metriken:
  - Verteilung der durchschnittlichen jährlichen Inflationsrate.
  - Streuung der realen Entnahmen.
- Für Stufe 1 optional; Fokus liegt auf korrekter Simulation, UI-Anzeige kann später erweitert werden.

---

### 5.3 Stochastische Cash-/Tagesgeldzinsen

#### 5.3.1 Fachliches Modell

- Ausgangswert: vorhandenes `savings_rate_pa` (Tagesgeld-/Cashzins).
- Jährliche Zinsrate `C_year` für Cash wird um diesen Mittelwert herum variiert.
- Positive Korrelation zu Inflation: hohe Inflation → tendenziell höhere Nominalzinsen.
- Für die steuerliche Vorabpauschale wird aus demselben Zins-/Inflationsumfeld ein stark korrelierter Pfad für den regulatorischen Basiszins abgeleitet (siehe 5.3.3 und 7.2), um Hochzinsphasen nicht steuerlich zu unterschätzen.

#### 5.3.2 Neue Parameter / UI-Felder

- `mc_cash_rate_mode`: `'deterministic' | 'random'` (Default `'deterministic'`).
- `mc_cash_rate_volatility`: jährliche Standardabweichung.
- `mc_corr_inflation_cash`: Korrelation zwischen Inflation und Cashzins (z.B. 0.5–0.9), oder vereinfachend fester Wert.

#### 5.3.3 Änderungen in `simulation-core.js`

1. **Jährliche Cashzins-Pfade**:
   - Analog zu Inflation ein Array `annualCashRates[yearIdx]`.
   - Erzeugung: ggf. gemeinsam mit Inflation aus multivariater Normalverteilung (siehe 5.7), um Korrelation zu berücksichtigen.
2. **Monatliche Umrechnung**:
   - Bisher: `monthlySavingsRate = toMonthlyRate(savings_rate_pa)` (konstant).
   - Neu: `monthlySavingsRate` pro Jahr auf Basis von `annualCashRates[yearIdx]`.
3. **Besteuerung der Zinsen**:
   - Die Logik für Zinsbesteuerung am Jahresende bleibt unverändert.
   - Es ändert sich nur der Betrag `yearlyAccumulatedInterestGross`.
4. **Vorabpauschale / Basiszins**:
   - Wenn `mc_cash_rate_mode = 'random'`, zusätzlich ein Array `annualBasisRates[yearIdx]`, das stark an `annualCashRates` gekoppelt ist (z.B. über lineare Funktion + Floors/Caps).
   - In deterministischen Läufen wird wie bisher `BASISZINS_HISTORY` genutzt; in stochastischen Läufen werden zukünftige Basiszinse aus `annualBasisRates` abgeleitet.
   - Die nominale Steuerlogik (inkl. gesetzlichem 0,7-Faktor und Deckelung durch tatsächliche Wertsteigerung) bleibt unverändert; es ändert sich nur der zugrunde liegende Basiszins-Pfad.

---

### 5.4 Schwankende Sparraten (Einkommensschocks)

#### 5.4.1 Fachliches Modell

- Es werden **Ereignisse** modelliert, die Sparraten beeinflussen:
  - Negative Ereignisse: Arbeitslosigkeit, Krankheit, Elternzeit → temporäre Reduktion oder Aussetzung der Sparraten.
  - Positive Ereignisse: Beförderung, Gehaltssprung → dauerhafte Erhöhung der Sparraten-Basis.
- Sparraten-Schocks wirken immer auf `monthly_savings` / `monthly_etf` (nicht direkt auf das Bruttoeinkommen); negative Schocks können die Sparrate realistisch bis auf 0 reduzieren.
- Vereinfachtes diskretes Ereignis-Modell pro Jahr:
  - Mit kleiner Wahrscheinlichkeit `p_neg` tritt ein negativer Schock auf (Dauer D_neg Jahre, Reduktionsfaktor f_neg auf die Sparrate; f_neg kann 0 bedeuten: vollständige Aussetzung der Sparleistung).
  - Mit Wahrscheinlichkeit `p_pos` ein positiver Schock; dieser erhöht die Basis-Sparrate dauerhaft um Faktor f_pos (kein automatischer Rückfall auf das alte Niveau).
  - Kein Schock: Standardpfad (nur `annual_raise_percent`).

#### 5.4.2 Neue Parameter / UI-Felder

- Im Expert-Modus:
  - `mc_saving_shock_mode`: `'off' | 'simple'` (Default `'off'`).
  - `mc_saving_shock_p_neg`, `mc_saving_shock_p_pos`.
  - `mc_saving_shock_factor_neg` (z.B. 0.0–0.5), `mc_saving_shock_factor_pos` (z.B. 1.1–1.5).
  - `mc_saving_shock_duration_neg_years`, `mc_saving_shock_duration_pos_years`.
- Für UI-Vereinfachung können vordefinierte Presets angeboten werden ("konservativ", "realistisch", "optimistisch").

#### 5.4.3 Änderungen in `simulation-core.js`

1. **Statusvariablen für Schocks**:
   - Separate Baseline-Variablen für Sparraten (z.B. `currMonthlySavBase`, `currMonthlyEtfBase`) und temporäre negative Schockfaktoren (z.B. `savingShockActiveNeg`, `savingShockMonthsRemainingNeg`, `savingShockFactorNeg`).
2. **Jährliche Ereignisprüfung** (z.B. zu Jahresbeginn):
   - Ziehung `u_neg ~ U(0,1)` und `u_pos ~ U(0,1)` von `getRng()`.
   - Falls kein negativer Schock aktiv und `u_neg < p_neg` → starte temporären negativen Schock (setze `savingShockFactorNeg < 1` für D_neg Jahre/Monate).
   - Wenn `u_pos < p_pos` → hebe die Baseline-Sparraten dauerhaft um Faktor `f_pos` an (Anpassung der Baseline, kein automatischer Rückfall).
3. **Anwendung auf monatliche Sparleistungen**:
   - Bisher: `currMonthlySav`, `currMonthlyEtf` werden nur über `annual_raise_percent` skaliert.
   - Neu: Fortschreibung der Baseline über `annual_raise_percent`; in Phasen mit negativem Schock zusätzliche Multiplikation mit `savingShockFactorNeg` (bis hin zu 0 für vollständige Aussetzung der Sparrate).
4. **Rückwärtskompatibilität**:
   - Wenn `mc_saving_shock_mode = 'off'`, keine Änderung gegenüber heute.

---

### 5.5 Unerwartete Ausgaben / Extra-Entnahmen in der Entnahmephase

#### 5.5.1 Fachliches Modell

- Zusätzlich zu planmäßigen und periodischen Sonderentnahmen werden **stochastische Extra-Ausgaben** eingeführt.
- Modellidee:
  - Pro Jahr hat der Haushalt eine Wahrscheinlichkeit `p_extra`, dass eine große außerplanmäßige Ausgabe anfällt.
  - Die Höhe kann z.B. prozentual vom aktuellen Gesamtvermögen oder als fester, inflationsadjustierter Betrag modelliert werden.

#### 5.5.2 Neue Parameter / UI-Felder

- Expert-Optionen für die Entnahmephase:
  - `mc_extra_expense_mode`: `'off' | 'percent_of_wealth' | 'fixed_real'`.
  - `mc_extra_expense_probability_pa` (z.B. 0–20%).
  - `mc_extra_expense_percent_of_wealth` (z.B. 5–20%).
  - `mc_extra_expense_fixed_amount` + Inflationsanpassungsschalter.

#### 5.5.3 Änderungen in `simulation-core.js`

1. **Jährliche Ereignisziehung in der Entnahmephase**:
   - Nur für `monthIdx > savingsMonths`.
   - Einmal pro Kalenderjahr prüfen: `u ~ U(0,1)`, wenn `u < p_extra` → Extra-Ausgabe dieses Jahr.
2. **Integration in bestehende Entnahmelogik**:
   - Heute wird `needed_net` aufgebaut aus regulärer Entnahme + evtl. periodischer Sonderentnahme.
   - Neu: `needed_net += extraExpenseThisYear`.
   - Der Rest der Logik (Reihenfolge: Cash > ETF-Verkäufe > Shortfall) bleibt gleich.
3. **Tracking**:
   - Zusätzliche Felder in `history`-Einträgen:
     - `extra_expense`, `total_requested_with_extras`, o.ä.
    - Optional: Kennzeichnung, ob ein Pfad-Ruin (oder das Unterschreiten eines Sicherheits-Thresholds) unmittelbar durch eine Extra-Ausgabe mit ausgelöst wurde (z.B. `ruin_caused_by_extra_expense`), zur besseren Diagnose im UI.

---

### 5.6 Stochastische Crash-Ereignisse

#### 5.6.1 Fachliches Modell

- Zusätzlich zu deterministischen Stress-Szenarien:
  - Pro Jahr besteht eine Wahrscheinlichkeit `p_crash`, dass ein Crash eintritt.
  - Crash-Tiefe (z.B. −20% bis −50%) und evtl. Erholungsprofil sind Zufallsvariablen.
- Crash kann über mehrere Monate verteilt werden (z.B. exponentielle Erholung).

#### 5.6.2 Neue Parameter / UI-Felder

- `mc_crash_mode`: `'off' | 'simple'`.
- `mc_crash_probability_pa`.
- `mc_crash_drop_min`, `mc_crash_drop_max` (Jahresrendite in Crashjahr).
- `mc_crash_recovery_years_min/max`.

#### 5.6.3 Technischer Ansatz

- Generisches Vorgehen:
  - Vor der Monats-Schleife eine **Liste von Crash-Events** generieren (Jahr, Drop, Erholungsdauer) basierend auf den Parametern.
  - In der Monats-Schleife bei ETF-Rendite-Berechnung prüfen, ob ein Crashjahr aktiv ist:
    - ETF-Return wird dann als Kombination aus
      - Crashkomponente (deterministische Form aus Drop & Recovery-Plan) und
      - normalem Monte-Carlo-Return (oder reduziertem Return) modelliert.
- Vereinfachte erste Version:
  - Crash-Jahr hat deterministisch eine besonders negative Jahresrendite (innerhalb des lognormalen Modells), ohne separate Erholungskurve.
- **Kalibrierung und Vermeidung von Double-Counting**:
  - Wenn Crash-Events aktiviert sind, muss die Basissigma/Verteilung der normalen Renditen ggf. reduziert oder das Jahresreturn im Crashjahr vollständig durch den Crash-Pfad ersetzt werden, um keine doppelte Zählung extremer Tails zu erzeugen.

---

### 5.7 Gemeinsame Modellierung von Korrelationen

- Für höhere Realismusgrade werden **gemeinsame Zufallsvektoren** verwendet:
  - Minimale Variante (Stufe 1): 2D-Vektor `Z = (Z_inflation, Z_cash)` ~ multivariate Normalverteilung mit vorgegebener Kovarianzmatrix, um unplausible Kombinationen (z.B. hohe Inflation bei 0%-Zins) zu vermeiden.
  - Erweiterte Variante (Stufe 1.5): 3D-Vektor `Z = (Z_return, Z_inflation, Z_cash)`.
- Implementation:
  - `randomNormal` liefert Standardnormalen; für Korrelationen kann eine einfache 2D-/3D-Cholesky-Zerlegung implementiert werden.
  - Aufwand ist überschaubar; die volle 3D-Kopplung ist ein optionales Expert-Feature, die 2D-Korrelation Inflation/Cashzins gehört jedoch zum Basisumfang.

---

## 6. Integration mit bestehenden Stress-Szenarien

### 6.1 Aktuelle Logik

- Wenn `stressScenario !== 'none'` und `getStressReturn` eine Rendite liefert, wird diese deterministisch verwendet und **überschreibt** den normalen Monte-Carlo-Return.
- Volatilität und Zufall greifen dann nur in Phasen außerhalb der Stress-Szenarien.

### 6.2 Zielbild

- Stress-Szenarien sollen weiterhin deterministisch definierte Pfade sein.
- Neue Schwankungsquellen (Inflation, Cash, Sparraten, Extra-Ausgaben) dürfen **auch in Stress-Szenarien** zufällig sein.
- Option, Stress-Szenario **rein deterministisch** zu fahren (Debugging / Kommunikation):
  - Flag `mc_disable_other_randomness_in_stress`.

### 6.3 Technische Anpassungen

- `simulate` muss klar trennen:
  - Rendite-Berechnung: Stress-Szenario vs. normaler Monte-Carlo-Prozess.
  - Andere Zufallsereignisse: unabhängig von `stressScenario`, sofern nicht explizit deaktiviert.
- Dokumentation im Code und ggf. in der UI, wie sich Stress-Szenarien mit zusätzlichen Schwankungen kombinieren.

---

## 7. Änderungen pro Datei (High-Level-Design)

### 7.1 `src/core/simulation-core.js`

- Neue Optionen in der `simulate`-Signatur (über `options`-Objekt):
  - Inflationsmodus/-parameter.
  - Cashzinsmodus/-parameter.
  - Sparraten-Schock-Parameter.
  - Extra-Ausgaben-Parameter.
  - Crash-Parameter.
- Implementierung:
  - Jährliche Zufallspfade für Inflation und Cashzins.
  - Event-Logik für Sparraten-Schocks und Extra-Ausgaben.
  - (Optional) Crash-Event-Liste.
  - Zusätzliche Felder in den `history`-Einträgen (z.B. `extra_expense`, `saving_shock_factor`).

### 7.2 `src/core/constants.js`

- Ergänzung um **Defaults** für neue MC-bezogene Parameter (z.B. Standard-Volatilitäten, Wahrscheinlichkeiten).
- Evtl. neue Presets für Szenarien, die diese Optionen sinnvoll vorbelegen.
 - Defaults und Kalibrierungsparameter für den stochastischen Basiszins-Pfad (z.B. Spread und Korrelation zum Cashzins, Floors/Caps, Fallback auf `BASISZINS_HISTORY`).

### 7.3 `src/stores/monteCarlo.js`

- Erweiterung der `mcOptions`, die an den Worker geschickt werden:
  - Mapping von UI-Feldern (z.B. `scenario.mcInflationMode`) auf `mcOptions.inflationMode` etc.
- Sicherstellung, dass fehlende Felder die Defaults nutzen (kein Bruch bestehender Szenarien).

### 7.4 `src/components/ScenarioForm.vue`

- Neue Eingabefelder / Sektion "Monte-Carlo-Erweiterte Risiken" (nur im Expert-Modus):
  - Toggles und Slider für die neuen Parameter (Inflation, Cashzins, Sparraten-Schocks, Extra-Ausgaben, Crash-Risiko).
- Fokus auf:
  - Klare Beschriftungen und Tooltips.
  - Sinnvolle Default-Werte.

### 7.5 `src/components/MonteCarloTab.vue` / `ResultsPanel.vue`

- Optional: Zusätzliche Ergebnisanzeigen, z.B.:
  - Verteilung der realen Entnahmen.
  - Verteilung der durchschnittlichen jährlichen Inflation.
  - Anteil der Pfade mit Extra-Ausgaben-Events.

### 7.6 `src/core/mc-analysis.js`

- Erweiterung des Analyse-Outputs, falls neue Felder in `history` genutzt werden sollen:
  - Zählung von Pfaden mit starken Extra-Ausgaben.
  - Statistiken zu Dauer und Häufigkeit von Sparraten-Schocks.
  - Optional: Kennzeichnung und Auswertung von Pfaden, in denen ein Ruin (oder das Unterschreiten von Sicherheits-Thresholds) unmittelbar durch Extra-Ausgaben mit ausgelöst wurde (z.B. `ruin_caused_by_extra_expense`), um die Kommunikation im UI zu verbessern.
- Für Stufe 1 genügt es, wenn die Hauptmetriken stabil bleiben; Zusatzmetriken sind ein Bonus.

---

## 8. Migrations- und Kompatibilitätsaspekte

- **Szenario-Schema-Version (`SCENARIO_VERSION`)**:
  - Erhöhung von `2.0.0` auf `2.1.0` oder ähnlich.
  - Neue Felder werden mit sinnvollen Defaults hinterlegt:
    - Alle neuen Modi stehen standardmäßig auf `'off'` oder `'deterministic'`.
- **Laden alter Szenarien**:
  - Beim Laden werden fehlende Felder auf Defaults gesetzt.
  - UI zeigt bei alten Szenarien weiterhin das gewohnte Verhalten, solange der Nutzer neue Optionen nicht explizit aktiviert.
- **Dokumentation**:
  - Kurzbeschreibung der neuen Risikoquellen in der README / docs.
  - Beispiel-Szenarien, die die neuen Optionen nutzen.

---

## 9. Test- und Validierungsstrategie

### 9.1 Deterministische Regressions-Tests

- Testfälle mit `volatility = 0` und allen neuen MC-Optionen = `'off'` / `'deterministic'`:
  - Erwartung: Bitgenaue oder zumindest numerisch identische Ergebnisse wie in der aktuellen Version.

### 9.2 Stochastische Konsistenz-Tests

- Mit fixem Seed mehrere Runs ausführen und prüfen:
  - Ergebnisse bleiben zwischen Runs identisch (Reproduzierbarkeit).
  - Statistiken (Mittelwerte, Perzentile) verhalten sich plausibel (z.B. höhere Inflationsvola → größere Streuung der realen Entnahmen).

### 9.3 Extrem- und Grenzfalltests

- Extrem hohe / niedrige Parameterwerte testen:
  - Sehr hohe Inflationsvolatilität.
  - Crash-Wahrscheinlichkeit = 0 oder sehr hoch.
  - Sparraten-Schocks mit Faktor 0 (komplette Aussetzung) über mehrere Jahre.

### 9.4 Performance-Tests

- Messung der Laufzeit für typische Iterationszahlen (1.000, 5.000, 10.000) mit allen neuen Schwankungsquellen aktiv.
- Ziel: Kein massiver Einbruch gegenüber aktuellem Stand.

---

## 10. Roadmap / Umsetzung in Iterationen

### Iteration 1: Infrastruktur & Inflation

- Erweiterung der `simulate`-Signatur und der MC-Optionen (`monteCarlo.js`, Worker-Schnittstelle).
- Implementierung stochastischer jährlicher Inflationsraten + monatliche Umrechnung.
- Sicherstellung der Rückwärtskompatibilität.
- Einfache UI-Optionen für Inflationsmodus und Volatilität.

### Iteration 2: Cashzins & Sparraten-Schocks

- Stochastische jährliche Cashzinsen implementieren (ggf. gekoppelt an Inflation).
- Einkommens-/Sparraten-Schock-Modell (einfache Diskret-Ereignisse mit Faktor und Dauer).
- UI-Optionen und Defaults.
- Erste einfache Auswertungen in `mc-analysis.js` (z.B. Anteil der Pfade mit Schocks).

### Iteration 3: Unerwartete Ausgaben in der Entnahmephase

- Extra-Ausgaben-Modell (Jahreswahrscheinlichkeit + Höhe).
- Integration in Entnahmelogik.
- Optional: Anzeige der durchschnittlichen zusätzlichen Entnahmen und ihrer Streuung.

### Iteration 4: Stochastische Crash-Ereignisse

- Einfaches Crash-Modell (Crashjahr mit stark negativer Jahresrendite).
- Optionale Kombination mit bestehenden deterministischen Stress-Szenarien.
- UI-Optionen und Presets.

### Iteration 5: Verfeinerungen & Korrelationen

- Einführung eines einfachen Korrelationmodells zwischen Inflation, Cashzins und Aktienrenditen (multivariate Normalverteilung).
- Erweiterung der Dokumentation und visuellen Auswertungen.

---

## 11. Zusammenfassung

- Der Plan erweitert die Monte-Carlo-Simulation systematisch um zusätzliche, realistische Schwankungen:
  - Stochastische Inflation.
  - Stochastische Cashzinsen.
  - Schwankende Sparraten (Einkommensschocks).
  - Unerwartete Ausgaben in der Entnahmephase.
  - Optional stochastische Crash-Ereignisse.
- Die Erweiterung erfolgt schrittweise, rückwärtskompatibel und performancebewusst.
- Alle neuen Risikofaktoren bleiben steuerbar über MC-Optionen im Szenario und können im einfachen UI-Modus verborgen werden.
