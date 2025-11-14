import { ref, onMounted } from 'vue'
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const featureFlagPayload = ref<JsonType>(posthog?.getFeatureFlagPayload?.(flag))

  onMounted(() => {
    if (!posthog) return

    // Update when feature flags are loaded
    const unsubscribe = posthog.onFeatureFlags?.(() => {
      featureFlagPayload.value = posthog.getFeatureFlagPayload(flag)
    })

    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  })

  return featureFlagPayload
}
