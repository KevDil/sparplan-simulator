# Repository Guidelines

## Project Structure & Module Organization
- Source lives entirely in `docs/`: `index.html` (layout), `app.js` (simulation logic, charting, localStorage), `styles.css` (theme, layout, modal/tooltip styling).
- Static site only—no backend or build pipeline. GitHub Pages can publish directly from `docs/` on `main`.
- Assets (e.g., `screenshot.png`) stay under `docs/`; keep additional media light to preserve load speed.

## Build, Test, and Development Commands
- `npx serve docs` — start a local server (default http://localhost:3000) to exercise the UI.
- `python -m http.server 8000 --directory docs` — zero-dependency alternative for local preview.
- Open `docs/index.html` directly in a browser only for quick HTML checks; prefer a server so fetches and relative paths behave like production.

## Coding Style & Naming Conventions
- JavaScript: vanilla ES6, 2-space indentation, camelCase for functions/variables, UPPER_SNAKE_CASE for constants. Keep calculations in small pure helpers; guard user input with early validation (see `readNumber`).
- Comments are concise and often German; include rationale for tax assumptions when changing calculations.
- No bundler/linter is configured—format consistently with existing spacing and quote style (double quotes).
- CSS: rely on the defined CSS variables in `:root`; reuse existing class patterns (`topbar`, `modal-*`, `card`) instead of introducing new globals.

## Testing Guidelines
- No automated tests; run manual checks in a browser after each change: load defaults, run a simulation, toggle FIFO/LIFO, switch inflation/tax options, export CSV, and verify graph/table update without console errors.
- Validate localStorage persistence: refresh and confirm inputs restore correctly; check new fields hook into save/load maps in `app.js`.
- For visual changes, test at narrow widths to keep the grid/cards responsive.

## Commit & Pull Request Guidelines
- History favors descriptive, sentence-style messages (e.g., “fix Vorabpauschale calculation to apply Teilfreistellung earlier”). Follow that pattern; prefix with the feature/tax topic when relevant.
- Pull requests should include: a short summary, linked issue (if any), manual test notes (browsers/steps), and before/after screenshots for UI changes.
- Call out any tax-law assumptions or deviations (FIFO/LIFO behavior, Teilfreistellung factors) in the PR description so reviewers can sanity-check the model.
