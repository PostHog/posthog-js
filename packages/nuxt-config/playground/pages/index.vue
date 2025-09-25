<template>
  <div>
    <h1>Home Page</h1>
    <p>This is the home page with an intentional error!</p>
  </div>
</template>

<script setup>
// Throw an error in the frontend
throw new Error('Frontend error thrown intentionally for testing!')
</script>
