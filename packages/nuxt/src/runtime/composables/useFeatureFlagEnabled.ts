import { ref, onMounted, onUnmounted } from 'vue'
import { usePostHog } from './usePostHog'

/**
 * Check if a feature flag is enabled
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

  onMounted(() => {
    if (!posthog) return

    // Update when feature flags are loaded
    const unsubscribe = posthog.onFeatureFlags?.(() => {
      featureEnabled.value = posthog.isFeatureEnabled(flag)
    })

    onUnmounted(() => {
      if (unsubscribe) {
        unsubscribe()
      }
    })
  })

  return featureEnabled
}
