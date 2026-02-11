import { useEffect, useState } from 'react'
import type { PostHog } from '../posthog-rn'
import { PostHogFlagsResponse } from '@posthog/core'
import { useOverridablePostHog } from './utils'

export function useFeatureFlags(client?: PostHog): PostHogFlagsResponse['featureFlags'] | undefined {
  const posthog = useOverridablePostHog(client, 'useFeatureFlags')
  const [featureFlags, setFeatureFlags] = useState<PostHogFlagsResponse['featureFlags'] | undefined>(
    posthog?.getFeatureFlags()
  )

  useEffect(() => {
    setFeatureFlags(posthog?.getFeatureFlags())
    return posthog?.onFeatureFlags((flags) => {
      setFeatureFlags(flags)
    })
  }, [posthog])

  return featureFlags
}
