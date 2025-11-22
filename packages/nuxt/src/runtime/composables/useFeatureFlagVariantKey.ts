import { ref, onMounted, onUnmounted } from 'vue'
import { usePostHog } from './usePostHog'

/**
 * Get the value/variant of a feature flag
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

  onMounted(() => {
    if (!posthog) return

    // Update when feature flags are loaded
    const unsubscribe = posthog.onFeatureFlags?.(() => {
      featureFlagVariantKey.value = posthog.getFeatureFlag(flag)
    })

    onUnmounted(() => {
      if (unsubscribe) {
        unsubscribe()
      }
    })
  })

  return featureFlagVariantKey
}
