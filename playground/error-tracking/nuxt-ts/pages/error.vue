<script setup>
function throwError() {
    // Error will be caught by the error handler vue:error in posthog plugin
    throw new Error('Uncaught error')
}
</script>
<template>
    <h1>Error Page</h1>
    <p>Something went wrong</p>
    <NuxtLink to="/">Go back home</NuxtLink>
    <button @click="throwError()">Hello World</button>
</template>