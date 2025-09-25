<template>
  <div>
    <h1>Home Page</h1>
    <p>This is the home page with an intentional error!</p>
    <button @click="handleError">Click to Throw Error</button>
  </div>
</template>

<script setup lang="ts">
import { throwSimpleError } from '~/utils/errorUtils'

const handleError = () => {
  throwSimpleError()
}
</script>
