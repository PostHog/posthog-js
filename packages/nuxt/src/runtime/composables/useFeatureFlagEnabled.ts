import { ref, onMounted, onUnmounted } from 'vue'
import { usePostHog } from './usePostHog'

/**
 * Check if a feature flag is enabled
 *
 * @remarks
 * This composable initializes with the current feature flag value and automatically
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
 * const isEnabled = useFeatureFlagEnabled('my-flag')
 * ```
 *
 * @param flag - The feature flag key
 * @returns A reactive ref containing the feature flag enabled state (boolean | undefined)
 */
export function useFeatureFlagEnabled(flag: string) {
  const posthog = usePostHog()
  const featureEnabled = ref<boolean | undefined>(posthog?.isFeatureEnabled?.(flag))

  let unsubscribe: (() => void) | undefined
  onMounted(() => {
    if (!posthog) return

    // Set initial value in case it wasn't available during setup
    featureEnabled.value = posthog.isFeatureEnabled(flag)

    // Update when feature flags are loaded
    unsubscribe = posthog.onFeatureFlags?.(() => {
      featureEnabled.value = posthog.isFeatureEnabled(flag)
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
  })

  return featureEnabled
}
