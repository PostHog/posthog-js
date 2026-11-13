import { useEffect, useState } from 'react'
import type { JsonType } from '@posthog/core'
import type { PostHog } from '../posthog-rn'
import { useOverridablePostHog } from './utils'

/**
 * A feature flag's payload for the current user, updated when flags load. Reading it doesn't send a
 * `$feature_flag_called` event.
 *
 * @param flag Key of the feature flag
 * @param client A PostHog client to use instead of the one from `PostHogProvider`
 */
export function useFeatureFlagPayload(flag: string, client?: PostHog): JsonType | undefined {
  const posthog = useOverridablePostHog(client, 'useFeatureFlagPayload')
  const [payload, setPayload] = useState<JsonType | undefined>(
    () => posthog?.getFeatureFlagResult(flag, { sendFeatureFlagEvent: false })?.payload
  )

  useEffect(() => {
    setPayload(posthog?.getFeatureFlagResult(flag, { sendFeatureFlagEvent: false })?.payload)
    return posthog?.onFeatureFlags(() => {
      setPayload(posthog.getFeatureFlagResult(flag, { sendFeatureFlagEvent: false })?.payload)
    })
  }, [posthog, flag])

  return payload
}
