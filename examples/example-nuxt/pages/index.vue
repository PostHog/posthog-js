<template>
  <div style="padding: 20px; font-family: sans-serif">
    <h1>Error Testing Page</h1>
    <p>Test various hard-to-catch errors:</p>

    <div style="display: flex; flex-direction: column; gap: 10px; max-width: 400px">
      <button @click="testCaptureEvent" style="padding: 10px; cursor: pointer">0. Test Event</button>

      <button @click="testCaptureException" style="padding: 10px; cursor: pointer">0. Test Exception</button>

      <button @click="throwSimpleError" style="padding: 10px; cursor: pointer">1. Simple Synchronous Error</button>

      <button @click="throwUncaughtPromiseRejection" style="padding: 10px; cursor: pointer">
        2. Uncaught Promise Rejection
      </button>

      <button @click="throwAsyncError" style="padding: 10px; cursor: pointer">
        3. Async Function Error (no catch)
      </button>

      <button @click="throwTimeoutError" style="padding: 10px; cursor: pointer">4. setTimeout Error</button>

      <button @click="throwPromiseChainError" style="padding: 10px; cursor: pointer">5. Promise Chain Error</button>

      <button @click="throwEventLoopError" style="padding: 10px; cursor: pointer">6. NextTick/Event Loop Error</button>

      <button @click="throwNestedAsyncError" style="padding: 10px; cursor: pointer">7. Nested Async Error</button>

      <button @click="redirectRenderingError" style="padding: 10px; cursor: pointer">8. Rendering Error</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { throwSimpleError as utilThrowError } from '~/utils/errorUtils'

const { $posthog } = useNuxtApp()

// 0. Test manual capture
const testCaptureEvent = () => {
  $posthog()?.capture('test_event')
}

// 0. Test event
const testCaptureException = () => {
  $posthog()?.captureException(new Error('Test exception'))
}

// 1. Simple synchronous error
const throwSimpleError = () => {
  utilThrowError()
}

// 2. Uncaught promise rejection
const throwUncaughtPromiseRejection = () => {
  Promise.reject(new Error('Uncaught promise rejection!'))
  // Intentionally no .catch()
}

// 3. Async function error
const throwAsyncError = async () => {
  await new Promise((resolve) => setTimeout(resolve, 100))
  throw new Error('Async function error without catch!')
}

// 4. setTimeout error
const throwTimeoutError = () => {
  setTimeout(() => {
    throw new Error('Error thrown in setTimeout!')
  }, 100)
}

// 5. Promise chain error
const throwPromiseChainError = () => {
  Promise.resolve()
    .then(() => {
      return Promise.resolve('step 1')
    })
    .then(() => {
      throw new Error('Error in promise chain!')
    })
}

// 6. Error in nextTick
const throwEventLoopError = () => {
  nextTick(() => {
    throw new Error('Error in nextTick!')
  })
}

// 7. Nested async error
const throwNestedAsyncError = () => {
  const innerAsync = async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    throw new Error('Nested async error!')
  }

  const outerAsync = async () => {
    innerAsync()
  }

  outerAsync()
}

// 8. Rendering error
const redirectRenderingError = () => {
  window.location.href = '/error'
}
</script>
