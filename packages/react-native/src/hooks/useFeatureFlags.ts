import { useEffect, useState } from 'react'
import type { PostHog } from '../posthog-rn'
import { PostHogFlagsResponse } from '@posthog/core'
import { useOverridablePostHog } from './utils'

/** @internal The full flag map, including disabled flags, for survey targeting. */
export function useFeatureFlags(client?: PostHog): PostHogFlagsResponse['featureFlags'] | undefined {
  const posthog = useOverridablePostHog(client, 'useFeatureFlags')
  const [featureFlags, setFeatureFlags] = useState<PostHogFlagsResponse['featureFlags'] | undefined>(
    () => posthog?.getFeatureFlagDetails()?.featureFlags
  )

  useEffect(() => {
    setFeatureFlags(posthog?.getFeatureFlagDetails()?.featureFlags)
    return posthog?.onFeatureFlags(() => {
      setFeatureFlags(posthog.getFeatureFlagDetails()?.featureFlags)
    })
  }, [posthog])

  return featureFlags
}
