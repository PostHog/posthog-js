<script setup lang="ts">
const { $posthog } = useNuxtApp()

function captureException() {
    // manually capture exception
    $posthog().captureException(new Error('Nuxt manual error'))
}

function throwException() {
    // exception will be captured by vue:error hook defined in posthog.client.js
    throw new Error('Nuxt manual error')
}
</script>
<template>
    <button @click="captureException()">Capture Exception</button>
    <button @click="throwException()">Throw Exception</button>
</template>
