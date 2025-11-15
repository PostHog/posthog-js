<template>
  <div style="padding: 20px; font-family: sans-serif">
    <h1>Feature Flags Testing Page</h1>
    <p>Test the PostHog feature flag composables:</p>

    <div style="margin-top: 20px">
      <h2>Feature Flag Examples</h2>

      <div style="margin-top: 15px; padding: 15px; background-color: #f5f5f5; border-radius: 8px">
        <h3>1. Check if flag is enabled</h3>
        <p><strong>Flag:</strong> beta-feature</p>
        <p><strong>Enabled:</strong> {{ featureFlagEnabled ?? 'Loading...' }}</p>
      </div>

      <div style="margin-top: 15px; padding: 15px; background-color: #f5f5f5; border-radius: 8px">
        <h3>2. Get flag variant/value</h3>
        <p><strong>Flag:</strong> test-variant</p>
        <p><strong>Variant:</strong> {{ featureFlagVariant ?? 'Loading...' }}</p>
      </div>

      <div style="margin-top: 15px; padding: 15px; background-color: #f5f5f5; border-radius: 8px">
        <h3>3. Get flag payload</h3>
        <p><strong>Flag:</strong> config-flag</p>
        <p><strong>Payload:</strong> {{ payloadDisplay }}</p>
      </div>

      <div style="margin-top: 15px; padding: 15px; background-color: #f5f5f5; border-radius: 8px">
        <h3>4. Use PostHog directly</h3>
        <button @click="captureEvent" style="padding: 10px; cursor: pointer; margin-right: 10px">
          Capture Event
        </button>
        <button @click="getAllFlags" style="padding: 10px; cursor: pointer">Get All Flags</button>
        <p v-if="allFlags" style="margin-top: 10px">
          <strong>All Flags:</strong>
          <pre>{{ JSON.stringify(allFlags, null, 2) }}</pre>
        </p>
      </div>
    </div>

    <div style="margin-top: 20px">
      <a href="/" style="color: blue; text-decoration: underline">← Back to Error Testing</a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

// Using the new composables
const featureFlagEnabled = useFeatureFlagEnabled('beta-feature')
const featureFlagVariant = useFeatureFlagVariantKey('test-variant')
const featureFlagPayload = useFeatureFlagPayload('config-flag')
const posthog = usePostHog()

const allFlags = ref<Record<string, boolean | string> | undefined>()

const payloadDisplay = computed(() => {
  if (featureFlagPayload.value === undefined) {
    return 'Loading...'
  }
  if (featureFlagPayload.value === null) {
    return 'No payload'
  }
  return JSON.stringify(featureFlagPayload.value, null, 2)
})

const captureEvent = () => {
  posthog?.capture('feature_flags_test_event', {
    page: 'feature-flags',
  })
  alert('Event captured!')
}

const getAllFlags = () => {
  allFlags.value = posthog?.featureFlags.getFlagVariants()
}
</script>
