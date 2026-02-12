import { useEffect, useState } from 'react'
import { useOverridablePostHog } from './utils'
import { JsonType, FeatureFlagValue } from '@posthog/core'
import { PostHog } from '../posthog-rn'

export function useFeatureFlag(flag: string, client?: PostHog): FeatureFlagValue | undefined {
  const posthog = useOverridablePostHog(client, 'useFeatureFlag')
  const [featureFlag, setFeatureFlag] = useState<FeatureFlagValue | undefined>(posthog?.getFeatureFlag(flag))

  useEffect(() => {
    setFeatureFlag(posthog?.getFeatureFlag(flag))
    return posthog?.onFeatureFlags(() => {
      setFeatureFlag(posthog.getFeatureFlag(flag))
    })
  }, [posthog, flag])

  return featureFlag
}

export type FeatureFlagWithPayload = [FeatureFlagValue | undefined, JsonType | undefined]

export function useFeatureFlagWithPayload(flag: string, client?: PostHog): FeatureFlagWithPayload {
  const posthog = useOverridablePostHog(client, 'useFeatureFlagWithPayload')
  const [featureFlag, setFeatureFlag] = useState<FeatureFlagWithPayload>([undefined, undefined])

  useEffect(() => {
    setFeatureFlag([posthog?.getFeatureFlag(flag), posthog?.getFeatureFlagPayload(flag)])
    return posthog?.onFeatureFlags(() => {
      setFeatureFlag([posthog.getFeatureFlag(flag), posthog.getFeatureFlagPayload(flag)])
    })
  }, [posthog, flag])

  return featureFlag
}
