import { useEffect, useState } from 'react'
import { usePostHog } from './usePostHog'
import { FeatureFlagResult } from '@posthog/core'
import { PostHog } from '../posthog-rn'

export function useFeatureFlagResult(flag: string, client?: PostHog): FeatureFlagResult | undefined {
  const contextClient = usePostHog()
  const posthog = client || contextClient

  const [result, setResult] = useState<FeatureFlagResult | undefined>(posthog.getFeatureFlagResult(flag))

  useEffect(() => {
    setResult(posthog.getFeatureFlagResult(flag))
    return posthog.onFeatureFlags(() => {
      setResult(posthog.getFeatureFlagResult(flag))
    })
  }, [posthog, flag])

  return result
}
