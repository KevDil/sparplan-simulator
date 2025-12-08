<script setup>
defineEmits(['close'])
</script>

<template>
  <div class="modal-overlay active" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2>Formel-Cheatsheet</h2>
        <button class="modal-close" @click="$emit('close')" aria-label="Schließen">&times;</button>
      </div>
      <div class="modal-body">
        <section class="info-section">
          <h3>📐 Zinsen & Rendite</h3>
          <ul>
            <li><strong>Monatszins aus Jahreszins:</strong> <code>(1 + Jahreszins/100)^(1/12) - 1</code></li>
            <li><strong>ETF-Rendite nach Kosten:</strong> <code>ETF-Rendite p.a. - TER p.a.</code></li>
            <li><strong>Monatsrendite ETF:</strong> <code>(1 + effektive Rendite/100)^(1/12) - 1</code></li>
          </ul>
        </section>

        <section class="info-section">
          <h3>🏦 Tagesgeld & ETF</h3>
          <ul>
            <li><strong>Tagesgeld-Zinsen pro Monat:</strong> <code>Kontostand × Monatszins</code></li>
            <li><strong>Neuer TG-Saldo:</strong> <code>alter Saldo + Zinsen + Einzahlungen - Entnahmen</code></li>
            <li><strong>Gekaufte ETF-Anteile:</strong> <code>investierter Betrag / aktueller Kurs</code></li>
            <li><strong>ETF-Wert:</strong> <code>Anzahl Anteile × Kurs</code></li>
          </ul>
        </section>

        <section class="info-section">
          <h3>📉 Inflation & reale Werte</h3>
          <ul>
            <li><strong>Monatsinflation:</strong> <code>(1 + Inflation p.a./100)^(1/12) - 1</code></li>
            <li><strong>Inflationsfaktor:</strong> wächst jeden Monat mit <code>1 + Monatsinflation</code></li>
            <li><strong>Vermögen real:</strong> <code>Vermögen nominal / Inflationsfaktor</code></li>
          </ul>
        </section>

        <section class="info-section">
          <h3>💸 Entnahmephase</h3>
          <ul>
            <li><strong>Start-Rente (EUR-Modus):</strong> eingegebene Monatsrente</li>
            <li><strong>Start-Rente (%-Modus):</strong> <code>Vermögen zum Rentenstart × Entnahme% / 12</code></li>
            <li><strong>Rente Jahr n:</strong> <code>Start-Rente × (1 + Inflation p.a./100)^n</code></li>
          </ul>
        </section>

        <section class="info-section">
          <h3>💰 Steuern (vereinfacht)</h3>
          <ul>
            <li><strong>Effektiver Steuersatz ohne KiSt:</strong> ca. 26,375 %</li>
            <li><strong>Sparerpauschbetrag:</strong> Gewinne/Zinsen bis 1.000/2.000 € pro Jahr steuerfrei</li>
            <li><strong>Vorabpauschale Basisertrag:</strong> <code>Wert × Basiszins/100 × 0,7 × Zeitanteil</code></li>
            <li><strong>Vorabpauschale:</strong> <code>min(Basisertrag, tatsächlicher Wertzuwachs)</code></li>
          </ul>
        </section>

        <section class="info-section">
          <h3>🎲 Monte-Carlo (Zufallsrenditen)</h3>
          <ul>
            <li><strong>Monatsvolatilität:</strong> <code>Jahresvola / √12</code></li>
            <li><strong>Monatsrendite in Zufallssimulation:</strong> schwankt um die erwartete Monatsrendite mit obiger Volatilität</li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>
