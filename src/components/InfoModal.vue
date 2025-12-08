<script setup>
defineEmits(['close'])
</script>

<template>
  <div class="modal-overlay active" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2>Wie funktioniert die Simulation?</h2>
        <button class="modal-close" @click="$emit('close')" aria-label="Schließen">&times;</button>
      </div>
      <div class="modal-body">
        <section class="info-section">
          <h3>📊 Simulationsübersicht</h3>
          <p>Die Simulation berechnet deinen Vermögensverlauf in zwei Phasen:</p>
          <ul>
            <li><strong>Ansparphase:</strong> Monatliche Sparraten (TG + ETF), optional mit jährlicher Dynamik. Erreicht das TG das Ziel, fließt der Überschuss in den ETF.</li>
            <li><strong>Entnahmephase:</strong> Fester EUR-Betrag oder %-Regel (z.B. 4%-Regel), optional inflationsangepasst. Entnahme-Reihenfolge: TG-Überschuss → ETF → TG unter Ziel.</li>
            <li><strong>Sonderausgaben:</strong> Größere Einmalkosten (z.B. Auto) alle X Jahre, für beide Phasen separat einstellbar.</li>
          </ul>
        </section>

        <section class="info-section">
          <h3>🎲 Monte-Carlo-Simulation</h3>
          <p>Hunderte bis tausende Durchläufe mit <strong>zufälligen ETF-Renditen</strong> (normalverteilt um die erwartete Rendite). Zeigt die Verteilung möglicher Ergebnisse als Konfidenz-Bänder.</p>
          <ul>
            <li><strong>Volatilität:</strong> Typisch 15-20% p.a. für Aktien-ETFs</li>
            <li><strong>Erfolgswahrscheinlichkeit:</strong> % der Simulationen ohne Engpass und positivem Endvermögen</li>
            <li><strong>Perzentile:</strong> 25% (Konservativ), 50% (Median), 75% (Optimistisch)</li>
          </ul>
        </section>

        <section class="info-section">
          <h3>💰 Steuern (Deutschland)</h3>
          <ul>
            <li><strong>Kapitalertragsteuer:</strong> 26,375% (inkl. Soli), mit KiSt ~27,8-28%</li>
            <li><strong>Teilfreistellung:</strong> 30% der ETF-Gewinne sind steuerfrei</li>
            <li><strong>Sparerpauschbetrag:</strong> 1.000€/2.000€ jährlich steuerfrei</li>
            <li><strong>Vorabpauschale:</strong> Jährliche Steuer auf thesaurierende ETFs (Basiszins × 0,7)</li>
            <li><strong>FIFO/LIFO:</strong> Verkaufsreihenfolge – FIFO ist gesetzlich vorgeschrieben, LIFO oft günstiger</li>
            <li><strong>Verlusttopf:</strong> Ein allgemeiner Topf für ETF-Gewinne/-Verluste (nach Teilfreistellung), Zinsen und Vorabpauschale.</li>
          </ul>
        </section>

        <section class="info-section">
          <h3>🛡️ Kapitalerhalt & Risiko</h3>
          <ul>
            <li><strong>Kapitalerhalt-Modus:</strong> Reduziert Entnahme automatisch, wenn Vermögen unter Schwellwert fällt</li>
            <li><strong>Sequence-of-Returns-Risk:</strong> Frühe Crashs in der Entnahmephase sind besonders schädlich</li>
            <li><strong>Strategien:</strong> Größerer Cash-Puffer, flexible Entnahme, Bond-Tent</li>
          </ul>
        </section>

        <section class="info-section">
          <h3>📈 Wichtige Kennzahlen</h3>
          <ul>
            <li><strong>Nominal vs. Real:</strong> Nominale Werte sind absolute Beträge, reale sind kaufkraftbereinigt</li>
            <li><strong>Effektive Entnahmerate:</strong> Tatsächliche jährliche Entnahme in % des Startvermögens</li>
            <li><strong>Kapitalerhalt-Rate:</strong> % der MC-Simulationen mit Endvermögen ≥ Startvermögen</li>
            <li><strong>Pleite-Risiko:</strong> % mit Vermögen unter Ruin-Schwelle oder Shortfall in Entnahmephase</li>
          </ul>
        </section>

        <section class="info-section">
          <h3>⚠️ Hinweise</h3>
          <ul>
            <li>Simulation ≠ Vorhersage – historische Renditen garantieren keine zukünftigen Ergebnisse</li>
            <li>Deutsches Steuerrecht 2025 – inkl. allgemeinem Verlusttopf für ETFs, Zinsen und Vorabpauschale</li>
            <li>Inflation, TG-Zins und TER sind fix – nur ETF-Renditen variieren in Monte-Carlo</li>
            <li>Eingaben werden im Browser gespeichert, Export als CSV/PDF möglich</li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>
