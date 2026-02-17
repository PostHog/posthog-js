import { useEffect, useState } from 'react'
import { useOverridablePostHog } from './utils'
import { FeatureFlagResult } from '@posthog/core'
import { PostHog } from '../posthog-rn'

export function useFeatureFlagResult(flag: string, client?: PostHog): FeatureFlagResult | undefined {
  const posthog = useOverridablePostHog(client, 'useFeatureFlagResult')
  const [result, setResult] = useState<FeatureFlagResult | undefined>(posthog?.getFeatureFlagResult(flag))

  useEffect(() => {
    setResult(posthog?.getFeatureFlagResult(flag))
    return posthog?.onFeatureFlags(() => {
      setResult(posthog.getFeatureFlagResult(flag))
    })
  }, [posthog, flag])

  return result
}
