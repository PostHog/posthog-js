<script setup lang="ts">
async function createException() {
    const mod = await import('./throw-error')
    mod.throwError()
}
</script>

<template>
    <div class="container">
        <h1>vue + ts + esbuild</h1>
        <button @click="createException">Create exception</button>
    </div>
</template>

<style scoped>
.container {
    height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    flex-direction: column;
}
</style>
