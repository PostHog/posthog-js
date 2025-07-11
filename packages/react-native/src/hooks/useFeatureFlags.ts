import { useEffect, useState } from 'react'
import type { PostHog } from '../posthog-rn'
import { PostHogFlagsResponse } from 'posthog-core'
import { usePostHog } from './usePostHog'

export function useFeatureFlags(client?: PostHog): PostHogFlagsResponse['featureFlags'] | undefined {
  const contextClient = usePostHog()
  const posthog = client || contextClient
  const [featureFlags, setFeatureFlags] = useState<PostHogFlagsResponse['featureFlags'] | undefined>(
    posthog.getFeatureFlags()
  )

  useEffect(() => {
    setFeatureFlags(posthog.getFeatureFlags())
    return posthog.onFeatureFlags((flags) => {
      setFeatureFlags(flags)
    })
  }, [posthog])

  return featureFlags
}
