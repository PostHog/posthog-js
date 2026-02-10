import { useEffect, useState } from 'react'
import { useOptionalPostHog, validatePostHogClient } from './useOptionalPostHog'
import { JsonType, FeatureFlagValue } from '@posthog/core'
import { PostHog } from '../posthog-rn'

export function useFeatureFlag(flag: string, client?: PostHog): FeatureFlagValue | undefined {
  const contextClient = useOptionalPostHog()
  const posthog = client ?? contextClient
  validatePostHogClient(posthog, 'useFeatureFlag')

  const [featureFlag, setFeatureFlag] = useState<FeatureFlagValue | undefined>(posthog.getFeatureFlag(flag))

  useEffect(() => {
    setFeatureFlag(posthog.getFeatureFlag(flag))
    return posthog.onFeatureFlags(() => {
      setFeatureFlag(posthog.getFeatureFlag(flag))
    })
  }, [posthog, flag])

  return featureFlag
}

export type FeatureFlagWithPayload = [FeatureFlagValue | undefined, JsonType | undefined]

export function useFeatureFlagWithPayload(flag: string, client?: PostHog): FeatureFlagWithPayload {
  const contextClient = useOptionalPostHog()
  const posthog = client ?? contextClient
  validatePostHogClient(posthog, 'useFeatureFlagWithPayload')

  const [featureFlag, setFeatureFlag] = useState<FeatureFlagWithPayload>([undefined, undefined])

  useEffect(() => {
    setFeatureFlag([posthog.getFeatureFlag(flag), posthog.getFeatureFlagPayload(flag)])
    return posthog.onFeatureFlags(() => {
      setFeatureFlag([posthog.getFeatureFlag(flag), posthog.getFeatureFlagPayload(flag)])
    })
  }, [posthog, flag])

  return featureFlag
}
