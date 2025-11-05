<template>
  <div>Hello World</div>
</template>
<script setup lang="ts">
if (typeof window !== 'undefined') {
  throw new Error('Rendering error')
}
</script>
