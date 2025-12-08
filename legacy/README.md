# Legacy-Dateien

Dieses Verzeichnis enthält archivierte Dateien aus Version 1.x des ETF Simulators.

## app.v1.js

Die ursprüngliche monolithische v1.x-Anwendung. Enthielt die gesamte Logik (UI, State, Simulation, Monte-Carlo, Export) in einer einzigen Datei.

**Status:** Deprecated, nicht mehr in Verwendung seit Version 2.0.

Der v2.0-Quellcode befindet sich modularisiert unter `src/`:
- `main.js` - Haupteinstiegspunkt
- `simulation-core.js` - Simulationslogik
- `mc-analysis.js` - Monte-Carlo-Analyse
- `mc-path-metrics.js` - MC-Pfad-Metriken
- `optimizer-logic.js` - Optimierer-Logik
- `state.js`, `ui-form.js`, `ui-charts.js` - State & UI
- `export.js` - Export-Funktionen

Die gebündelten Artefakte liegen unter `docs/`:
- `app.bundle.js` - Haupt-Bundle
- `mc-worker.js` - Monte-Carlo-Worker
- `optimizer-worker.js` - Optimierer-Worker
- `simulation-core.js` - Worker-Build des Simkerns
