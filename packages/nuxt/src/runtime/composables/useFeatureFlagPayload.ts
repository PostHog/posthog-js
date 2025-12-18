import { ref, onMounted, onUnmounted } from 'vue'
import { usePostHog } from './usePostHog'
import type { JsonType } from 'posthog-js'

/**
 * Get the payload of a feature flag
 *
 * @remarks
 * This composable initializes with the current feature flag payload and automatically
 * updates when PostHog feature flags are reloaded.
 *
 * **Server-Side Rendering (SSR) Behavior:**
 * - During SSR, PostHog is typically not available or feature flags are not yet loaded
 * - The returned ref will be `undefined` on the server side
 * - The ref will be properly hydrated on the client side once PostHog initializes
 * - Consider using a fallback value or `v-if` directive when rendering based on this value
 *
 * @example
 * ```ts
 * const payload = useFeatureFlagPayload('my-flag')
 * ```
 *
 * @param flag - The feature flag key
 * @returns A reactive ref containing the feature flag payload
 */
export function useFeatureFlagPayload(flag: string) {
  const posthog = usePostHog()
  const featureFlagPayload = ref<JsonType | undefined>(posthog?.getFeatureFlagPayload?.(flag))

  let unsubscribe: (() => void) | undefined
  onMounted(() => {
    if (!posthog) return

    // Set initial value in case it wasn't available during setup
    featureFlagPayload.value = posthog.getFeatureFlagPayload(flag)

    // Update when feature flags are loaded
    unsubscribe = posthog.onFeatureFlags?.(() => {
      featureFlagPayload.value = posthog.getFeatureFlagPayload(flag)
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
  })

  return featureFlagPayload
}
