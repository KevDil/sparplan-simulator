/**
 * Composable für konsistente Formatierung von Währungen und Prozenten
 * 
 * Zentralisiert die Darstellungslogik für alle Tabs und Komponenten.
 * Kapselt Intl.NumberFormat-Konfiguration für deutsche Lokale.
 */

// Vorkonfigurierte Formatter (werden nur einmal instanziiert)
const currencyFormatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
})

const currencyFormatterDecimals = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

export function useFormatting() {
  /**
   * Formatiert einen Wert als Währung (EUR)
   * @param {number|null|undefined} value - Der zu formatierende Wert
   * @param {Object} options - Optionale Konfiguration
   * @param {number} options.decimals - Nachkommastellen (0 oder 2), Standard: 0
   * @returns {string} Formatierter Währungsstring oder '-' bei ungültigem Wert
   */
  function formatCurrency(value, { decimals = 0 } = {}) {
    if (value === undefined || value === null || Number.isNaN(value)) {
      return '-'
    }
    return decimals === 2
      ? currencyFormatterDecimals.format(value)
      : currencyFormatter.format(value)
  }

  /**
   * Formatiert einen Wert als Prozent
   * @param {number|null|undefined} value - Der zu formatierende Wert (z.B. 5.5 für 5,5%)
   * @param {Object} options - Optionale Konfiguration
   * @param {number} options.decimals - Nachkommastellen, Standard: 1
   * @returns {string} Formatierter Prozentstring oder '-' bei ungültigem Wert
   */
  function formatPercent(value, { decimals = 1 } = {}) {
    if (value === undefined || value === null || Number.isNaN(value)) {
      return '-'
    }
    return `${value.toFixed(decimals)}%`
  }

  /**
   * Formatiert einen Wertebereich (z.B. für Perzentile)
   * @param {number} min - Unterer Wert
   * @param {number} max - Oberer Wert
   * @param {Function} formatter - Formatierungsfunktion (default: formatCurrency)
   * @returns {string} Formatierter Bereichsstring
   */
  function formatRange(min, max, formatter = formatCurrency) {
    return `${formatter(min)} - ${formatter(max)}`
  }

  return {
    formatCurrency,
    formatPercent,
    formatRange
  }
}
