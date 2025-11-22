import { ref, onMounted, onUnmounted } from 'vue'
import { usePostHog } from './usePostHog'
import type { JsonType } from 'posthog-js'

/**
 * Get the payload of a feature flag
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

  onMounted(() => {
    if (!posthog) return

    // Update when feature flags are loaded
    const unsubscribe = posthog.onFeatureFlags?.(() => {
      featureFlagPayload.value = posthog.getFeatureFlagPayload(flag)
    })

    onUnmounted(() => {
      if (unsubscribe) {
        unsubscribe()
      }
    })
  })

  return featureFlagPayload
}
