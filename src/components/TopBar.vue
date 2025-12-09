<script setup>
import { useUiStore } from '../stores/ui'

const uiStore = useUiStore()
</script>

<template>
  <header class="topbar" role="banner">
    <div class="brand">
      <div class="brand__dot"></div>
      <div>
        <p class="eyebrow">ETF & Tagesgeld</p>
        <h1>Sparplan- & Entnahme-Simulator</h1>
        <p class="tagline">Interaktive Monte-Carlo-Analysen, Steuerlogik für Deutschland und Entnahmestrategien in einem Tool.</p>
      </div>
    </div>
    <div class="topbar-actions">
      <button 
        class="btn-info" 
        @click="uiStore.showInfoModal = true" 
        title="Wie funktioniert die Simulation?"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 16v-4M12 8h.01"/>
        </svg>
        <span>Wie funktioniert's?</span>
      </button>
      <button 
        class="btn-info" 
        @click="uiStore.showFormulaModal = true" 
        title="Formel-Cheatsheet anzeigen"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M7 12h10M9 8l-2 4 2 4"/>
        </svg>
        <span>Formel-Cheatsheet</span>
      </button>
      <button 
        class="btn-info btn-bav" 
        @click="uiStore.showBavComparisonModal = true" 
        title="bAV vs. ETF Vergleichsrechner"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 21h18M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1"/>
          <rect x="5" y="4" width="14" height="17" rx="1"/>
        </svg>
        <span>bAV vs. ETF</span>
      </button>
      <button 
        class="btn-theme" 
        type="button" 
        @click="uiStore.toggleTheme()"
        aria-label="Theme wechseln"
      >
        <span class="btn-theme__icon btn-theme__icon--dark">🌙</span>
        <span class="btn-theme__icon btn-theme__icon--light">☀</span>
      </button>
    </div>
  </header>
</template>
