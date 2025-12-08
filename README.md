# ETF Sparplan- & Entnahme-Simulator

Ein interaktiver Simulator für langfristige Vermögensplanung mit ETFs und Tagesgeld – optimiert für die deutsche Steuergesetzgebung.

![Screenshot](docs/screenshot.png)

## Features

- **Steueroptimierung**: Standard ist gesetzeskonformes FIFO (First In, First Out), optional LIFO nur zur Analyse
- **Teilfreistellung**: 30% der ETF-Gewinne steuerfrei (§ 20 Abs. 1 InvStG)
- **Sparerpauschbetrag**: 1.000 EUR/Jahr automatisch berücksichtigt
- **Verlustverrechnungstöpfe**: Aktien-Topf für ETF-Verkaufsgewinne/-verluste, Allgemeiner Topf für Zinsen/Vorabpauschale (keine Kreuzverrechnung)
- **Dynamische Sparraten**: Jährliche Gehaltserhöhung einplanbar
- **Inflationsbereinigung**: Reale Kaufkraft neben Nominalwerten
- **Sonderausgaben**: Einplanbare größere Ausgaben in beiden Phasen
- **Zwei Entnahmemodi**: Fixbetrag (EUR/Monat) oder prozentual vom Vermögen

## Berechnungsgrundlagen

| Parameter | Wert | Beschreibung |
|-----------|------|--------------|
| Kapitalertragsteuer | 25% | Zzgl. 5,5% Soli = 26,375% |
| Teilfreistellung | 30% | Für Aktienfonds (>51% Aktienanteil) |
| Sparerpauschbetrag | 1.000 € | Pro Person/Jahr |

### Verkaufsreihenfolge (FIFO/LIFO)
**Standard: FIFO (First In, First Out)** – Die ältesten Anteile werden zuerst verkauft. Dies ist für Privatanleger in Deutschland gesetzlich vorgeschrieben (§ 20 Abs. 4 EStG).

**Optional: LIFO (Last In, First Out)** – Die jüngsten Anteile werden zuerst verkauft. Diese Option ist **nur zur Analyse/Vergleich** gedacht und **nicht gesetzeskonform** für Privatanleger.

## Installation & Nutzung

### Lokal
```bash
# Klonen
git clone https://github.com/username/etf_calculator.git
cd etf_calculator

# Starten (beliebiger HTTP-Server)
npx serve docs
# oder
python -m http.server 8000 --directory docs
```

### GitHub Pages
Das `docs/`-Verzeichnis kann direkt als GitHub Pages Site deployed werden:
1. Repository Settings → Pages
2. Source: "Deploy from a branch"
3. Branch: `main`, Folder: `/docs`

## Bedienung

1. **Basisdaten eingeben**: Startvermögen, Zinssätze, Tagesgeld-Ziel, Inflation
2. **Ansparphase konfigurieren**: Dauer, monatliche Raten, Dynamik, Sonderausgaben
3. **Entnahmephase planen**: Dauer, Wunschrente (EUR oder %), Sonderausgaben
4. **Simulation starten**: Graph und Tabelle werden generiert

### Buttons
- **Simulation starten**: Berechnet und zeigt Ergebnisse
- **Zurücksetzen**: Setzt alle Eingaben auf Standardwerte
- **CSV Export**: Lädt monatliche Daten als CSV-Datei

### Eingaben werden gespeichert
Alle Eingaben werden im Browser (localStorage) gespeichert und beim nächsten Besuch wiederhergestellt.

## Technologie

- **Vue 3** – Composition API mit `<script setup>`
- **Pinia** – State Management
- **Vite** – Build Tool & Dev Server
- **Canvas API** – Für performante Graphen
- **CSS Grid/Flexbox** – Responsives Layout
- **LocalStorage** – Persistente Einstellungen

## Installation & Development

```bash
# Dependencies installieren
npm install

# Development Server starten
npm run dev

# Produktions-Build erstellen
npm run build

# Build-Vorschau
npm run preview

# Tests ausführen
npm test
```

## Projektstruktur

```
etf_calculator/
├── src/
│   ├── main.js              # Vue Entry Point
│   ├── App.vue              # Root-Komponente
│   ├── components/          # Vue-Komponenten
│   │   ├── TopBar.vue
│   │   ├── ScenarioForm.vue
│   │   ├── ResultsPanel.vue
│   │   ├── StandardTab.vue
│   │   ├── MonteCarloTab.vue
│   │   ├── StandardChart.vue
│   │   └── ...
│   ├── stores/              # Pinia Stores
│   │   ├── scenario.js
│   │   ├── simulation.js
│   │   ├── monteCarlo.js
│   │   └── ui.js
│   ├── composables/         # Vue Composables
│   ├── core/                # Framework-unabhängige Logik
│   │   ├── simulation-core.js
│   │   ├── mc-analysis.js
│   │   ├── constants.js
│   │   └── ...
│   └── assets/
│       └── styles.css
├── docs/                    # Build-Output (GitHub Pages)
├── tests/                   # Unit Tests
├── index.html               # Vite Entry HTML
├── vite.config.js           # Vite Konfiguration
└── package.json
```

## Lizenz

MIT License – Frei verwendbar für private und kommerzielle Zwecke.

## Haftungsausschluss

Diese Software dient nur zu Informationszwecken und stellt keine Anlage-, Steuer- oder Finanzberatung dar. Alle Berechnungen basieren auf vereinfachten Annahmen. Für verbindliche Auskünfte wenden Sie sich an einen Steuerberater oder Finanzberater.
