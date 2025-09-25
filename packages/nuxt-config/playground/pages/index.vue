<template>
  <div>
    <h1>Home Page</h1>
    <p>This is the home page with an intentional error!</p>
    <button @click="throwError5">Click to Throw Error</button>
  </div>
</template>

<script setup>
const throwError5 = () => {
  throw new Error('Frontend error thrown intentionally for testing!')
}
</script>
