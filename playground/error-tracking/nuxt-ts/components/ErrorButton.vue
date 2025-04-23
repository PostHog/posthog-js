<script setup lang="ts">
const { $posthog } = useNuxtApp()
async function captureException() {
    // manually capture exception
    $posthog().captureException(new Error('Nuxt manual error'))
}
</script>
<template>
    <button @click="captureException()">Hello World</button>
</template>