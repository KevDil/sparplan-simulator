<script setup>
defineProps({
  label: {
    type: String,
    required: true
  },
  value: {
    type: String,
    default: '-'
  },
  hint: {
    type: String,
    default: ''
  },
  highlight: {
    type: Boolean,
    default: false
  },
  variant: {
    type: String,
    default: '' // '', 'worst', 'best', 'mc'
  },
  clickable: {
    type: Boolean,
    default: false
  }
})

defineEmits(['click'])
</script>

<template>
  <div
    class="stat-card"
    :class="{
      'stat-card--clickable': clickable,
      [`stat-card--${variant}`]: variant
    }"
    @click="clickable && $emit('click')"
  >
    <span class="stat-label">{{ label }}</span>
    <span
      class="stat-value"
      :class="{ 'stat-value--highlight': highlight }"
    >
      {{ value }}
    </span>
    <small v-if="hint" class="stat-hint">{{ hint }}</small>
  </div>
</template>
