import { ref, onMounted, onUnmounted } from 'vue'
import { usePostHog } from './usePostHog'

/**
 * Get the value/variant of a feature flag
 *
 * @remarks
 * This composable initializes with the current feature flag variant key and automatically
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
 * const variant = useFeatureFlagVariantKey('my-flag')
 * ```
 *
 * @param flag - The feature flag key
 * @returns A reactive ref containing the feature flag value (string | boolean | undefined)
 */
export function useFeatureFlagVariantKey(flag: string) {
  const posthog = usePostHog()
  const featureFlagVariantKey = ref<string | boolean | undefined>(posthog?.getFeatureFlag?.(flag))

  let unsubscribe: (() => void) | undefined
  onMounted(() => {
    if (!posthog) return

    // Set initial value in case it wasn't available during setup
    featureFlagVariantKey.value = posthog.getFeatureFlag(flag)

    // Update when feature flags are loaded
    unsubscribe = posthog.onFeatureFlags?.(() => {
      featureFlagVariantKey.value = posthog.getFeatureFlag(flag)
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
  })

  return featureFlagVariantKey
}
