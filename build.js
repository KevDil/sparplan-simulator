/**
 * ETF Simulator Build Script
 * 
 * Bundelt src/ Module nach docs/app.bundle.js
 * Verwendung:
 *   node build.js         - Einmaliges Build
 *   node build.js --watch - Watch-Modus für Entwicklung
 */

import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const isWatch = process.argv.includes('--watch');

// Build-Konfiguration
const buildOptions = {
  entryPoints: ['src/main.js'],
  bundle: true,
  outfile: 'docs/app.bundle.js',
  format: 'iife',
  globalName: 'ETFSimulator',
  target: ['es2020'],
  minify: !isWatch,
  sourcemap: isWatch,
  banner: {
    js: `/**
 * ETF Sparplan & Entnahme Simulator v2.0
 * Bundled: ${new Date().toISOString()}
 * https://github.com/KevDil/sparplan-simulator
 */`
  },
  define: {
    'process.env.NODE_ENV': isWatch ? '"development"' : '"production"'
  }
};

// Worker-Bundle-Konfiguration (simulation-core.js für Worker)
const workerBuildOptions = {
  entryPoints: ['src/simulation-core.js'],
  bundle: true,
  outfile: 'docs/simulation-core.js',
  format: 'iife',
  globalName: 'SimulationCore',
  target: ['es2020'],
  minify: !isWatch,
  banner: {
    js: `/**
 * ETF Simulator - Simulation Core (Worker Build)
 * Bundled: ${new Date().toISOString()}
 */
// Globale Variablen für Worker-Kompatibilität
var currentRng = Math.random;`
  },
  footer: {
    js: `
// Worker-Globals exportieren
if (typeof self !== 'undefined') {
  Object.assign(self, SimulationCore);
}`
  }
};

// MC-Worker Bundle-Konfiguration
const mcWorkerBuildOptions = {
  entryPoints: ['src/mc-worker-entry.js'],
  bundle: true,
  outfile: 'docs/mc-worker.js',
  format: 'iife',
  target: ['es2020'],
  minify: !isWatch,
  banner: {
    js: `/**
 * ETF Simulator - Monte-Carlo Web Worker
 * Bundled: ${new Date().toISOString()}
 * Source: src/mc-worker-entry.js
 */`
  }
};

// Optimizer-Worker Bundle-Konfiguration
const optimizerWorkerBuildOptions = {
  entryPoints: ['src/optimizer-worker-entry.js'],
  bundle: true,
  outfile: 'docs/optimizer-worker.js',
  format: 'iife',
  target: ['es2020'],
  minify: !isWatch,
  banner: {
    js: `/**
 * ETF Simulator - Optimizer Web Worker
 * Bundled: ${new Date().toISOString()}
 * Source: src/optimizer-worker-entry.js
 */`
  }
};

async function build() {
  try {
    if (isWatch) {
      // Watch-Modus
      const ctx = await esbuild.context(buildOptions);
      const workerCtx = await esbuild.context(workerBuildOptions);
      const mcWorkerCtx = await esbuild.context(mcWorkerBuildOptions);
      const optimizerWorkerCtx = await esbuild.context(optimizerWorkerBuildOptions);
      await Promise.all([
        ctx.watch(), 
        workerCtx.watch(),
        mcWorkerCtx.watch(),
        optimizerWorkerCtx.watch()
      ]);
      console.log('👀 Watching for changes...');
    } else {
      // Einmaliges Build
      await Promise.all([
        esbuild.build(buildOptions),
        esbuild.build(workerBuildOptions),
        esbuild.build(mcWorkerBuildOptions),
        esbuild.build(optimizerWorkerBuildOptions),
      ]);
      console.log('✅ Build complete: docs/app.bundle.js');
      console.log('✅ Build complete: docs/simulation-core.js (Worker)');
      console.log('✅ Build complete: docs/mc-worker.js (MC Worker)');
      console.log('✅ Build complete: docs/optimizer-worker.js (Optimizer Worker)');
    }
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();
