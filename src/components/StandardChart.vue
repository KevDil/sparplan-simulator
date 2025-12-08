<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  history: {
    type: Array,
    default: () => []
  },
  logScale: {
    type: Boolean,
    default: false
  }
})

const canvas = ref(null)
let resizeObserver = null

// Colors
const COLORS = {
  total: '#f59e0b',
  real: '#22c55e',
  grid: 'rgba(255, 255, 255, 0.1)',
  text: '#94a3b8',
  savingsPhase: 'rgba(34, 197, 94, 0.1)',
  withdrawPhase: 'rgba(251, 146, 60, 0.1)'
}

function drawChart() {
  if (!canvas.value || !props.history.length) return
  
  const ctx = canvas.value.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.value.getBoundingClientRect()
  
  // Set canvas size
  canvas.value.width = rect.width * dpr
  canvas.value.height = rect.height * dpr
  ctx.scale(dpr, dpr)
  
  const width = rect.width
  const height = rect.height
  const padding = { top: 20, right: 20, bottom: 40, left: 70 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  
  // Clear
  ctx.clearRect(0, 0, width, height)
  
  // Find data range
  const allValues = props.history.flatMap(h => [h.total, h.totalReal])
  let minVal = Math.min(...allValues)
  let maxVal = Math.max(...allValues)
  
  // Add padding to range
  const range = maxVal - minVal
  minVal = Math.max(0, minVal - range * 0.05)
  maxVal = maxVal + range * 0.05
  
  // Scale functions
  const xScale = (i) => padding.left + (i / (props.history.length - 1)) * chartWidth
  const yScale = (val) => {
    if (props.logScale && val > 0) {
      const logMin = Math.log10(Math.max(1, minVal))
      const logMax = Math.log10(Math.max(1, maxVal))
      const logVal = Math.log10(Math.max(1, val))
      return padding.top + chartHeight - ((logVal - logMin) / (logMax - logMin)) * chartHeight
    }
    return padding.top + chartHeight - ((val - minVal) / (maxVal - minVal)) * chartHeight
  }
  
  // Draw grid
  ctx.strokeStyle = COLORS.grid
  ctx.lineWidth = 1
  const gridLines = 5
  for (let i = 0; i <= gridLines; i++) {
    const y = padding.top + (i / gridLines) * chartHeight
    ctx.beginPath()
    ctx.moveTo(padding.left, y)
    ctx.lineTo(width - padding.right, y)
    ctx.stroke()
    
    // Y-axis labels
    const val = maxVal - (i / gridLines) * (maxVal - minVal)
    ctx.fillStyle = COLORS.text
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(formatValue(val), padding.left - 8, y + 4)
  }
  
  // Find phase transition
  const savingsMonths = props.history.filter(h => h.phase === 'saving').length
  if (savingsMonths > 0 && savingsMonths < props.history.length) {
    const transitionX = xScale(savingsMonths)
    
    // Draw phase backgrounds
    ctx.fillStyle = COLORS.savingsPhase
    ctx.fillRect(padding.left, padding.top, transitionX - padding.left, chartHeight)
    
    ctx.fillStyle = COLORS.withdrawPhase
    ctx.fillRect(transitionX, padding.top, width - padding.right - transitionX, chartHeight)
    
    // Draw transition line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.setLineDash([5, 5])
    ctx.beginPath()
    ctx.moveTo(transitionX, padding.top)
    ctx.lineTo(transitionX, padding.top + chartHeight)
    ctx.stroke()
    ctx.setLineDash([])
  }
  
  // Draw lines
  function drawLine(data, color) {
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    data.forEach((val, i) => {
      const x = xScale(i)
      const y = yScale(val)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }
  
  drawLine(props.history.map(h => h.total), COLORS.total)
  drawLine(props.history.map(h => h.totalReal), COLORS.real)
  
  // X-axis labels (years)
  ctx.fillStyle = COLORS.text
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'
  const totalYears = Math.ceil(props.history.length / 12)
  const labelInterval = Math.ceil(totalYears / 10)
  for (let year = 0; year <= totalYears; year += labelInterval) {
    const monthIndex = year * 12
    if (monthIndex < props.history.length) {
      const x = xScale(monthIndex)
      ctx.fillText(`${year}J`, x, height - 10)
    }
  }
}

function formatValue(val) {
  if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M €`
  if (val >= 1000) return `${(val / 1000).toFixed(0)}k €`
  return `${val.toFixed(0)} €`
}

watch(() => [props.history, props.logScale], drawChart, { deep: true })

onMounted(() => {
  drawChart()
  resizeObserver = new ResizeObserver(drawChart)
  resizeObserver.observe(canvas.value)
})

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})
</script>

<template>
  <canvas ref="canvas" aria-label="Vermögensgraph" style="width: 100%; height: 320px;"></canvas>
</template>
