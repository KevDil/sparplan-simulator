# ETF Sparplan & Entnahme Simulator – Version 2.0 Plan

## 1. Ausgangslage (Version 1.x)

Version 1.x ist bereits ein sehr fortgeschrittener, rein clientseitiger Simulator mit Fokus auf deutsche Rahmenbedingungen:

- **Steuermodell (DE)** mit Vorabpauschale, Teilfreistellung, Sparerpauschbetrag, Verlusttopf und FIFO/LIFO-Option (Analysemode).
- **Zwei Phasen**: Ansparen (TG + ETF, dynamische Raten, Sonderausgaben) und Entnahme (EUR-/%-Modus, Inflationsanpassung, Sonderausgaben).
- **Monte-Carlo-Simulation** mit Web Worker, Perzentilen und Sequence-of-Returns-Auswertung.
- **Optimizer-Worker**: Grid-Suche zur Optimierung von Sparrate/Entnahme bei Ziel-Erfolgswahrscheinlichkeit.
- **Reines Frontend**: `index.html` + `styles.css` + `simulation-core.js` + `app.js` + Worker-Skripte.
- **CSV-Exports** (Standard- und Monte-Carlo-Simulation) mit umfangreichen Metadaten.

Version 2.0 soll auf dieser starken Basis aufbauen, aber Bedienung, Verständlichkeit, Analyse-Tiefe und technische Qualität sichtbar auf ein neues Niveau heben.

---

## 2. Übergeordnete Ziele von Version 2.0

- **Benutzerführung**: Einsteigerfreundliches Onboarding, Szenario-Vorlagen und klare Erklärungen.
- **Szenarien-Vergleich**: Mehrere Konfigurationen parallel vergleichen und bewerten.
- **Analyse-Tiefe**: Monte-Carlo-Ansicht erweitern (SoRR, Stress-Tests, Notgroschen-Auswertung).
- **UX & Design**: Aufgeräumtes, modernes UI mit Dark Mode und Mobile-Optimierung.
- **Transparenz**: Bessere Visualisierung von Steuern, Shortfalls, Kapitalerhalt und Risiken.
- **Code-Qualität**: Strukturierte Architektur, Tests für das Simulationsmodell, klar definierte Schnittstellen.

---

## 3. Neue Funktionen & Änderungen aus Nutzersicht

### 3.1 Onboarding & Szenario-Vorlagen

**Ziel:** Einstieg vereinfachen und typische Fragestellungen abbilden.

- **Start-Assistent (Wizard)**:
  - 3–5 Schritte mit einfachen Fragen (Alter, gewünschtes Rentenalter, monatliche Sparfähigkeit, Risikobereitschaft, bestehendes Vermögen).
  - Erzeugt automatisch eine sinnvolle Grundeinstellung für Anspar- und Entnahmephase.
- **Szenario-Vorlagen** (als Buttons über dem Formular):
  - „**FIRE / Frührente**“: Lange Ansparphase, hohe ETF-Quote, 3–4% Entnahme.
  - „**Klassische Rente**“: 67 → 95, moderate ETF-Quote, konservativere Entnahme.
  - „**Bildungskonto / Studium**“: Kürzere Laufzeit, Entnahmen über 3–6 Jahre.
  - „**Notgroschen-Fokus**“: Aggressiver Aufbau des Tagesgeldziels, konservativ in ETF.
- **Einfache vs. Expertenansicht**:
  - Toggle „**Einfacher Modus**“ blendet Detail-Parameter (Kirchensteuer, Basiszins, LIFO, Kapitalerhalt-Feintuning) aus.
  - „**Expertenmodus**“ zeigt alle Felder wie bisher plus neue Steuer-/MC-Optionen.

### 3.2 Szenarienvergleich (Multi-Szenario-Modus)

**Ziel:** „Was wäre wenn…?“-Vergleiche ohne manuelles Umschalten.

- **Bis zu 3 Szenarien** gleichzeitig:
  - Szenario A, B, C mit eigenen Parametern (werden jeweils separat im LocalStorage gespeichert).
  - Gemeinsame Steuer- und Marktannahmen (Inflation, Basiszins, Volatilität) optional synchron.
- **Vergleichsansicht**:
  - Gemeinsamer Chart mit 2–3 farbigen Kurven (nominal + optional reale Kurven umschaltbar).
  - Vergleichstabelle mit Kennzahlen je Szenario: Erfolgswahrscheinlichkeit, Ruin-Risiko, Median-Endvermögen nominal/real, Median-Vermögen zum Rentenbeginn, Kapitalerhaltquote, Notgroschen-Erreichung.
- **Interaktion**:
  - Szenarien können dupliziert („Szenario B = Kopie von A + Änderung X“).
  - Szenario kann als „Baseline“ markiert werden; UI zeigt relative Unterschiede (z.B. +250€ Medianrente, −5% Ruin-Risiko).

### 3.3 Monte-Carlo-Ansicht 2.0

**Ziel:** MC-Simulation noch intuitiver und aussagekräftiger machen.

- **Konfigurierbare MC-Parameter** im UI (Expertenmodus):
  - Volatilität p.a., Anzahl Simulationen, optional Ziel-Erfolgswahrscheinlichkeit für grünes/rotes Feedback.
  - Auswahl, welche Perzentil-Bänder angezeigt werden (z.B. 10–90%, 25–75%, Median).
- **Neue Visualisierungen**:
  - Band-Chart mit klarer Legende (Median-Linie, Konfidenzbänder, „kritisches Fenster“ in den ersten Entnahmejahren farblich hinterlegt).
  - Kleine SoRR-Grafik: Punktdiagramm „Frühe Rendite (erste X Jahre Entnahme) vs. Endvermögen“ (ggf. nur aggregiert, nicht pro Pfad).
- **Textuelle MC-Zusammenfassung**:
  - Klarer Textblock in Alltagssprache („In 92% der Simulationen war dein Geld nach 30 Jahren noch nicht aufgebraucht…“).
  - Hervorhebung: Wahrscheinlichkeit, den Notgroschen rechtzeitig zu füllen, und Median-Füllzeit.
- **Stress-Test-Modus (Deterministische Szenarien)**:
  - Vordefinierte Rückkehrsequenzen als Auswahl:
    - „Früher Crash“: −30% im 1. Rentenjahr, langsame Erholung.
    - „Seitwärtsmarkt“: 0% Realrendite über 10 Jahre.
    - „Bärenmarkt-Phase“: 3–5 Jahre leicht negative Renditen, danach normal.
  - Umsetzung: Feste Sequenzen in `simulation-core.js`, die anstelle der Zufallsrenditen genutzt werden.

### 3.4 Optimizer 2.0 – UI & Modi

**Ziel:** Vorhandenen Optimizer sichtbar machen und einfacher nutzbar machen.

- **Explizite Optimierungsfunktionen im UI**:
  - Modus A: „Bei max. monatlichem Budget X: Finde die maximale nachhaltige Rente bei mind. Y% Erfolgswahrscheinlichkeit“.
  - Modus B: „Bei Zielrente X: Finde die minimale Sparrate bei mind. Y% Erfolgswahrscheinlichkeit“.
- **Ergebnisanzeige**:
  - Klarer Ergebnisblock: Optimierte monatliche TG-/ETF-Sparrate, empfohlene Rente, Erfolgswahrscheinlichkeit, Ruin-Risiko.
  - Button „Ergebnis in aktuelles Szenario übernehmen“.
- **Verknüpfung mit Multi-Szenario**:
  - Optimierter Vorschlag kann als neues Szenario B/C gespeichert und direkt verglichen werden.

### 3.5 Notgroschen- & Risikoansicht

**Ziel:** Den bereits vorhandenen Notgroschen-Mechanismus für Nutzer greifbar machen.

- **Eigener Abschnitt „Notgroschen“**:
  - Klar: Zielbetrag, Wahrscheinlichkeit, dass Ziel vor Rentenbeginn erreicht wird, Median-Zeit bis zur Füllung.
  - Ampeldarstellung (rot/gelb/grün) je nach Erreichungswahrscheinlichkeit und Zeit.
- **Risikokennzahlen kompakt**:
  - Erfolgswahrscheinlichkeit, Ruinwahrscheinlichkeit, Kapitalerhalt-Quote (nominal & real) in einem Risiko-Widget.
  - Optional „Risiko-Profil“: Konservativ, ausgewogen, offensiv (auf Basis dieser Kennzahlen).

### 3.6 Exporte & Reporting

**Ziel:** Ergebnisse leichter kommunizieren und dokumentieren.

- **Schöner PDF-/HTML-Report (Client-seitig)**:
  - Zusammenfassung des Szenarios (Eingaben, Strategie, Kennzahlen).
  - Charts als eingebettete SVG/Canvas-Screenshots.
  - Deutlich gekennzeichnet: „Keine Anlageberatung“.
- **Verbesserter CSV-Export**:
  - Option „Nur Jahreszeilen“ (statt monatsweise) für kompakte Auswertung.
  - Optional zweiter Export mit Szenario-Metadaten im Kopf (Lesbarkeit in Excel).

### 3.7 UX- und Design-Update

**Ziel:** Moderne, gut lesbare Oberfläche gerade auch auf Mobilgeräten.

- **Dark Mode**:
  - Toggle in der Topbar („Hell / Dunkel“), Speicherung im LocalStorage und Respektieren des System-Themes (`prefers-color-scheme`).
- **Responsives Layout 2.0**:
  - Bessere Aufteilung von Formular / Charts / Kennzahlen auf schmalen Bildschirmen.
  - Sticky-Kopfzeile für Kernkennzahlen, wenn man im Formular scrollt.
- **Tooltips & Erklärungen**:
  - Konsistente Tooltip-Komponente (Keyboard-fokussierbar, ARIA-konform).
  - Kurzbeschreibungen an den wichtigsten Feldern (Risiko, Entnahmerate, Notgroschen, LIFO-Hinweis) bleiben erhalten, aber optisch vereinheitlicht.
- **Zugänglichkeit**:
  - Fokus-Reihenfolge prüfen, ARIA-Attribute ergänzen, Kontraste verbessern.
  - Tastaturbedienung für Slider, Modals, Tabs.

### 3.8 Projektspeicherung & Teilen

**Ziel:** Langfristige Arbeit an Szenarien erleichtern.

- **Benannte Szenarien**:
  - Möglichkeit, Szenarien unter einem Namen im Browser zu speichern (z.B. „Mein FIRE-Plan“, „Plan mit Kind 1“).
- **Teilen per URL** (optional/fortgeschritten):
  - Serialisierung der wichtigsten Parameter in eine Base64-kodierte Query-Parameter-URL.
  - Achtung: rein clientseitig, keine sensiblen Daten speichern; Option, ob man das möchte.

---

## 4. Technische Architektur & Code-Änderungen

### 4.1 Strukturierung des Frontends

**Ziel:** Bessere Trennung von Logik, Darstellung und Zustand.

- **ES-Module-Einführung (falls Browser-Support ausreichend)**:
  - Aufteilung von `app.js` in:
    - `ui-form.js` (Formularbindung, Validierung, Onboarding/Wizard).
    - `ui-charts.js` (Zeichnen von Standard- und MC-Charts, Legenden, Tooltip-Logik).
    - `state.js` (Szenario-Objekte, LocalStorage, Versionierung, Migration).
    - `mc-controller.js` (Steuerung des MC-Workers, Aggregation von Chunk-Ergebnissen).
    - `optimizer-controller.js` (Steuerung des Optimizer-Workers).
  - `simulation-core.js` bleibt Framework-unabhängiger Kern.
- **Fallback**, falls ES-Module unerwünscht:
  - Beibehalt eines Bundling-Schritts (Rollup/ESBuild/Vite) mit Ausgabe eines einzelnen `app.bundle.js` im `docs/`-Ordner.

### 4.2 Stabiler Simulation-Core

- **API-Härtung von `simulate` und Analysefunktionen**:
  - Klar definierte Parametrisierung (`params`-Objekt), dokumentiert via JSDoc-Typen.
  - Separate Funktionen für Analyse/MC-Auswertung:
    - `analyzeHistory(history, params)`
    - `analyzeMonteCarloResults(histories, params, mcOptions)` (bereits vorhanden, weiter schärfen).
- **Performance-Optimierungen**:
  - Vermeidung unnötiger Objektallokationen im Monatsloop (Wiederverwenden temporärer Objekte, wo sinnvoll).
  - Option, History-Ausgabe zu verdichten (z.B. nur Monats- oder Jahreswerte, je nach Modus), wenn MC sehr viele Iterationen nutzt.

### 4.3 Web Worker & Parallelisierung

- **Worker-Pool-Konzept vereinheitlichen**:
  - Gemeinsames kleines Abstraktionsmodul für Worker-Pools (`createWorkerPool`), das sowohl von MC- als auch Optimizer-Worker genutzt wird.
  - Einheitliches Progress-Protokoll (z.B. `chunk-progress` mit globalem Fortschritt).
- **Fehler-Handling**:
  - Klare Fehlerklassifikation (Parameterfehler vs. numerische Probleme) im Worker; UI zeigt verständliche Hinweise statt generischer Fehlermeldungen.

### 4.4 State-Management & Szenarien

- **Zentraler `Scenario`-Typ**:
  - Einheitliche Struktur für alle Parameter eines Szenarios (Ansparen, Entnahme, Steuern, MC-/Optimizer-Optionen).
  - Versionierte Speicherung im LocalStorage mit Schema-Version.
- **Migration** bei v2.0:
  - Beim Laden: Erkennen alter LocalStorage-Strukturen (Version 1.x) und Migration in v2.0-Format.
  - Falls Migration nicht möglich → Nutzer erhält klare Info und Option, mit Defaults zu starten.

### 4.5 Tests & Qualitätssicherung

- **Unit-Tests für `simulation-core.js`** (Node-basiert):
  - Deterministische Tests für:
    - FIFO vs. LIFO-Verkäufe.
    - Teilfreistellung und Sparerpauschbetrag.
    - Verlusttopf-Logik.
    - Vorabpauschale-Berechnung und korrekte Jahreszuordnung.
  - Tests für deterministische Stress-Szenarien.
- **Regressionstests für MC-Auswertung**:
  - „Golden Master“-Sätze: Fixe Seeds, fixe Parameter → erwartete Perzentile/Erfolgswahrscheinlichkeiten werden gegen Referenzwerte geprüft.
- **Smoke-Tests im Browser** (optional, manuell):
  - Checkliste: vordefinierte Szenarien durchklicken und Kennzahlen grob plausibilisieren.

### 4.6 Build- & Tooling-Verbesserungen (optional)

- **`package.json` & Skripte**:
  - `npm run dev` → einfacher HTTP-Server für `docs/`.
  - `npm run test` → Unit-Tests für `simulation-core.js`.
  - `npm run build` → evtl. Bundling/Minification der JS-Dateien.
- **ESLint/Prettier** (nur für Entwicklerqualität, keine UI-Änderung):
  - Konsistente Formatierung und Basis-Lintingregeln.

---

## 5. Datenmodell, LocalStorage & Abwärtskompatibilität

- **Versionierte LocalStorage-Keys**:
  - Einführung eines globalen Objektschlüssels z.B. `etf_simulator_v2` mit `version`-Feld.
  - Alt: `etf_simulator_params` (v1) → Migration nach v2 beim ersten Laden.
- **Migrationslogik**:
  - Mapping alter Feldnamen auf neue Struktur (z.B. `monthly_payout_net` ↔ Szenario-Felder in Multi-Szenario-Struktur).
  - Sinnvolle Defaults für neue Felder (z.B. Dark Mode = Systemstandard, neue Notgroschenparameter = bisheriges Verhalten).
- **Fehlertoleranz**:
  - Bei inkonsistenten Daten: Fallback auf Defaults, aber möglichst viele Felder retten.

---

## 6. UI-Flows (Kurzskizze)

### 6.1 Einstieg (Einfacher Modus)

1. Nutzer öffnet Seite → Startseite zeigt Kurzbeschreibung und CTA „Simulation starten“.
2. Optional: Start-Wizard stellt 3–5 Fragen und setzt Felder.
3. Nutzer wechselt zwischen 1–3 Szenarien (Tabs/Buttons), ändert einfache Parameter.
4. Klick auf „Simulation starten“ → Standard-Chart + MC-Chart + Kennzahlen werden angezeigt.

### 6.2 Expertenmodus

1. Nutzer aktiviert „Expertenmodus“.
2. Zusätzliche Felder erscheinen (Steuern im Detail, MC-Parameter, LIFO, Kapitalerhalt-Feintuning, Optimizer-Optionen).
3. Nutzer kann Optimizer starten, MC-Parameter justieren und Stress-Tests fahren.
4. Ergebnisse werden im Risiken-Widget und in Vergleichsansichten dargestellt.

### 6.3 Szenario-Verwaltung

1. Szenario A wird beim ersten Aufruf aus LocalStorage migriert oder mit Defaults erstellt.
2. Nutzer kann Szenario duplizieren (B aus A, C aus B usw.).
3. Szenarien können benannt und gelöscht werden; LocalStorage speichert Liste der Szenarien.

---

## 7. Implementierungs-Roadmap (Phasenplan)

### 7.1 MVP-Definition für Version 2.0

- **Muss für 2.0**:
  - Modularisierung von `app.js` und klare Trennung von UI / State / Worker / Simulation-Core.
  - Einführung der `Scenario`-Struktur + versioniertes LocalStorage inkl. Migration von v1.x.
  - Multi-Szenario-Unterstützung für mindestens Szenario A und B (C optional).
  - MC 2.0 „light“: konfigurierbare MC-Parameter, Perzentil-Bänder, textuelle MC-Zusammenfassung.
  - Risiko- / Notgroschen-Widget mit Erfolgs- und Ruinwahrscheinlichkeit sowie Notgroschen-Erreichung.
  - Basis-Optimizer-UI für **einen** stabilen Modus (z.B. „Maximale nachhaltige Rente bei Budget X und Erfolgswahrscheinlichkeit Y%“).

- **Kann nach 2.0 (2.1/2.2)**:
  - Start-Wizard (Onboarding) mit Fragebaum.
  - Zweiter Optimizer-Modus („Minimale Sparrate bei Zielrente X“).
  - Sharing per URL, erweiterter PDF-Report, zusätzliche Stress- und SoRR-Visualisierungen.
  - Historische Backtests, Mehrwährungsunterstützung, erweiterte Familienmodelle.

### 7.2 Phase 1 – Fundament & Refactor (v2.0-alpha)

- **Simulation-Core-Härtung**
  - API von `simulate(params)` sowie `analyzeHistory(history, params)` und `analyzeMonteCarloResults(histories, params, mcOptions)` klar definieren und per JSDoc dokumentieren.
  - Steuer-, Entnahme- und Notgroschen-Logik konsolidiert im `simulation-core.js` halten.

- **Unit-Tests für `simulation-core.js`**
  - Node-basiertes Test-Setup (`npm test`).
  - Deterministische Tests für FIFO/LIFO, Teilfreistellung, Sparerpauschbetrag, Verlusttopf, Vorabpauschale und 1–2 definierte Stress-Szenarien.

- **Modulstruktur Frontend**
  - Aufteilung von `app.js` in:
    - `state.js` (Szenario-Objekte, Defaults, LocalStorage, Migration),
    - `ui-form.js` (Formularbindung, Validierung),
    - `ui-charts.js` (Standard- und MC-Charts, Legenden, Tooltip-Logik),
    - `mc-controller.js` (Ansteuerung des MC-Workers, Progress, Aggregation),
    - `optimizer-controller.js` (Ansteuerung des Optimizer-Workers).
  - Entscheidung: ES-Module direkt im Browser **oder** schlanker Bundling-Schritt mit einem `app.bundle.js`.

- **Szenario-Modell & LocalStorage-Migration**
  - Einführung eines zentralen `Scenario`-Typs, der Anspar-, Entnahme-, Steuer-, MC- und Optimizer-Parameter bündelt.
  - Neues LocalStorage-Schema `etf_simulator_v2` mit `version`.
  - Migration von `etf_simulator_params` (v1.x) auf den neuen Typ inkl. Fehlertoleranz und sinnvollen Defaults.

- **UI-Grundstruktur**
  - Vorbereitung für Szenario-Tabs, Risiko-Widget und MC-Controls (Layout-Anpassungen).
  - Kleines Facelift (Typografie, Abstände), aber noch kein vollständiger Redesign.

### 7.3 Phase 2 – Multi-Szenario & MC 2.0 (v2.0-beta)

- **Multi-Szenario-Unterstützung**
  - Verwaltung mehrerer Szenarien (A/B, optional C) in `state.js` inkl. aktives Szenario.
  - Funktionen zum Duplizieren, Benennen und Löschen von Szenarien.
  - Persistenz der Szenario-Liste im LocalStorage.

- **Vergleichsansicht**
  - Standard-Chart mit getrennten Kurven je Szenario.
  - Vergleichstabelle mit Kernkennzahlen je Szenario:
    - Erfolgswahrscheinlichkeit,
    - Ruinwahrscheinlichkeit,
    - Median-Endvermögen nominal/real,
    - Wahrscheinlichkeit und Median-Zeit zur Erreichung des Notgroschen-Ziels.
  - Optional: Markierung eines Baseline-Szenarios mit relativen Abweichungen (kann bei Zeitmangel auf 2.1 verschoben werden).

- **MC 2.0 – Parameter, Visualisierung und Text**
  - UI-Controls für Volatilität p.a., Anzahl Simulationen und Auswahl der Perzentil-Bänder.
  - Band-Chart mit Median und z.B. 10–90 %-Band, farblich markiertem „kritischen Fenster“ der frühen Entnahmejahre.
  - Textuelle MC-Zusammenfassung auf Basis der berechneten Kennzahlen (kein Freitext).

- **Stress-Test-Modus**
  - Implementierung deterministischer Rendite-Sequenzen im `simulation-core.js` (z.B. „Früher Crash“, „Seitwärtsmarkt“).
  - Umschaltbare Auswahl im UI („Standard / Früher Crash / …“).
  - Tests, die für jede Sequenz die erwartete Entwicklung prüfen.

- **Risiko- / Notgroschen-Widget**
  - Aggregation der relevanten Kennzahlen im Core.
  - UI-Widget mit Ampel-Darstellung und kompaktem Text (Erfolgswahrscheinlichkeit, Ruinrisiko, Notgroschen-Erreichung).

### 7.4 Phase 3 – Onboarding, UX & Reporting (v2.0)

- **Szenario-Vorlagen**
  - Implementierung von Preset-Funktionen (FIRE, klassische Rente, Bildungskonto, Notgroschen-Fokus).
  - Buttons im UI, die ein neues Szenario erzeugen oder das aktive Szenario überschreiben.

- **Wizard & Modus-Umschaltung**
  - Einfacher Start-Wizard auf Basis der bestehenden Presets (3–4 Fragen, keine überkomplexe Logik).
  - „Einfacher Modus“ vs. „Expertenmodus“:
    - Definition, welche Felder im einfachen Modus ausgeblendet werden.
    - Persistenter Toggle im State / LocalStorage.

- **UX-Verbesserungen**
  - Dark Mode mit `prefers-color-scheme`-Unterstützung und Toggle.
  - Überarbeitetes responsives Layout (besonders für Mobilgeräte: erst Kennzahlen, dann Charts, dann Formular).
  - Konsistente Tooltips und bessere Zugänglichkeit (Fokus, ARIA, Kontrast).

- **Reporting & Exporte**
  - Erweiterter CSV-Export:
    - Option „Nur Jahreszeilen“,
    - Kopfbereich mit Szenario-Metadaten.
  - Einfacher HTML-Report:
    - Zusammenfassungsseite, die im Browser als PDF gedruckt werden kann.
    - Später ausbaufähig zu einem vollwertigen PDF-Export.

- **Stabilisierung & Feinschliff**
  - Test- und Bugfix-Zyklus.
  - Feintuning der Default-Parameter und Presets auf Basis von Test-Szenarien.

### 7.5 Phase 4 – 2.x-Ideen (optional, nach 2.0)

- Ausbau der Stress-Szenarien mit kalibrierten historischen Phasen.
- Weitere Optimizer-Modi (z.B. „Minimiere Ruin-Risiko bei fixer Rente & Budgetobergrenze“).
- Erweiterte Visualisierung des Steuerflusses über die Jahre (z.B. Heatmap der gezahlten Steuern).
- Historische Backtests, Mehrwährungs-Unterstützung und komplexere Familienmodelle als eigenständige 2.x Releases.

---

## 8. Backlog / Nice-to-have für 2.x

- **Historische Backtests** mit vordefinierten Renditereihen (nur mit lokal eingebetteten Daten, ohne API-Abhängigkeit).
- **Mehrwährungsunterstützung** (nur UI, Berechnung bleibt in EUR; Umrechnungskurs als Parameter).
- **Erweiterte Familienmodelle** (2 Personen mit unterschiedlichen Rentenstartdaten und Sparerpauschbeträgen).
- **Export/Import von Szenarien** als JSON-Datei für Backup oder Transfer zwischen Geräten.

---

## 9. Zusammenfassung

Version 2.0 macht den bestehenden ETF-Simulator:

- Verständlicher (Wizard, Vorlagen, Risiko-Widgets).
- Mächtiger (Multi-Szenario-Vergleiche, Optimizer im UI, Stress-Tests, erweiterte MC-Auswertung).
- Schöner und zugänglicher (Dark Mode, bessere Mobile-UX, Barrierefreiheit).
- Stabiler und besser wartbar (modularisierte Architektur, Tests, versionierte Szenarien).

Die technische Basis bleibt ein performanter, reiner Frontend-Ansatz ohne Backend-Abhängigkeiten – ideal für GitHub Pages oder statische Hosting-Setups.
