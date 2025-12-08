import { onMounted, onUnmounted } from 'vue'

/**
 * Composable für globale Tastatur-Shortcuts
 * 
 * Kapselt Event-Listener-Management und ermöglicht einfache Erweiterung
 * von Keyboard-Shortcuts ohne App.vue aufzublähen.
 * 
 * @param {Object} handlers - Callback-Funktionen für verschiedene Shortcuts
 * @param {Function} handlers.onRunSimulation - Ctrl+Enter: Simulation starten
 * @param {Function} handlers.onCloseModals - Escape: Alle Modals schließen
 * @param {Function} handlers.onAbortMonteCarlo - Escape (bei laufender MC): MC abbrechen
 * @param {Function} handlers.onToggleTab - Alt+1/2/3: Tab wechseln
 */
export function useKeyboardShortcuts(handlers = {}) {
  const {
    onRunSimulation,
    onCloseModals,
    onAbortMonteCarlo,
    onToggleTab
  } = handlers

  function handleKeydown(e) {
    // Ctrl+Enter: Simulation starten
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault()
      onRunSimulation?.()
      return
    }

    // Escape: Modals schließen oder MC abbrechen
    if (e.key === 'Escape') {
      // Falls MC läuft, zuerst abbrechen versuchen
      if (onAbortMonteCarlo?.()) {
        return
      }
      onCloseModals?.()
      return
    }

    // Alt+1/2/3: Tab-Wechsel (für zukünftige Erweiterung)
    if (e.altKey && ['1', '2', '3'].includes(e.key)) {
      e.preventDefault()
      const tabMap = {
        '1': 'standard',
        '2': 'monte-carlo',
        '3': 'yearly'
      }
      onToggleTab?.(tabMap[e.key])
      return
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })
}
