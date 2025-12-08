<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { drawMonteCarloChart } from '../core/ui-charts.js'

const props = defineProps({
  results: {
    type: Object,
    default: null
  },
  logScale: {
    type: Boolean,
    default: true
  }
})

const canvas = ref(null)
let resizeObserver = null

function render() {
  if (!props.results) return
  drawMonteCarloChart(props.results, {
    logScale: props.logScale,
  })
}

watch(() => [props.results, props.logScale], () => {
  render()
}, { deep: true })

onMounted(() => {
  render()
  resizeObserver = new ResizeObserver(() => {
    render()
  })
  if (canvas.value) {
    resizeObserver.observe(canvas.value)
  }
})

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})
</script>

<template>
  <canvas
    id="mc-graph"
    ref="canvas"
    aria-label="Monte-Carlo Vermögensgraph"
    style="width: 100%; height: 320px;"
  ></canvas>
</template>
