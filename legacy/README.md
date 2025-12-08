# Legacy-Dateien

Dieses Verzeichnis enthält archivierte Dateien aus Version 1.x und 2.x (pre-Vue) des ETF Simulators.

**Status:** Deprecated seit Version 3.0 (Vue 3 Migration).

## Inhalt

| Datei | Beschreibung |
|-------|-------------|
| `app.v1.js` | Monolithische v1.x-Anwendung (vollständig deprecated) |
| `legacy-main.js` | v2.x DOM-basierter Einstiegspunkt |
| `state.js` | v2.x State-Management (ohne Pinia) |
| `ui-form.js`, `ui-charts.js` | v2.x DOM-UI-Module |
| `optimizer-*.js` | Optimizer-Module (noch nicht nach Vue portiert) |
| `*.js` (Core-Duplikate) | Kopien von `src/core/` für Legacy-Kompatibilität |

## Aktueller Code (v3.0 - Vue 3)

Der aktive Quellcode befindet sich unter:
- `src/main.js` - Vue 3 Einstiegspunkt
- `src/core/` - Framework-unabhängige Kernlogik (Single Source of Truth)
- `src/stores/` - Pinia Stores
- `src/components/` - Vue 3 Komponenten

## Legacy-Build

Falls benötigt: `npm run build:legacy` (erfordert Anpassung von `build.js` auf dieses Verzeichnis)
