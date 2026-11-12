import { useEffect, useState } from 'react'
import { useOverridablePostHog } from './utils'
import { FeatureFlagValue } from '@posthog/core'
import { PostHog } from '../posthog-rn'

export function useFeatureFlag(flag: string, client?: PostHog): FeatureFlagValue | undefined {
  const posthog = useOverridablePostHog(client, 'useFeatureFlag')
  const [featureFlag, setFeatureFlag] = useState<FeatureFlagValue | undefined>(() => posthog?.getFeatureFlag(flag))

  useEffect(() => {
    setFeatureFlag(posthog?.getFeatureFlag(flag))
    return posthog?.onFeatureFlags(() => {
      setFeatureFlag(posthog.getFeatureFlag(flag))
    })
  }, [posthog, flag])

  return featureFlag
}
