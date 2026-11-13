import { useEffect, useState } from 'react'
import type { PostHog } from '../posthog-rn'
import { useOverridablePostHog } from './utils'

/**
 * Whether a feature flag is enabled for the current user, updated when flags load.
 *
 * Returns `false` when the flag evaluates off, and `undefined` while flags are loading or when the flag
 * doesn't exist, so a conclusive "off" can be told apart from "no value yet".
 *
 * @param flag Key of the feature flag
 * @param defaultValue Returned instead of `undefined` while the value is unknown
 * @param client A PostHog client to use instead of the one from `PostHogProvider`
 */
export function useFeatureFlagEnabled(flag: string): boolean | undefined
export function useFeatureFlagEnabled(flag: string, defaultValue: boolean, client?: PostHog): boolean
export function useFeatureFlagEnabled(flag: string, defaultValue?: boolean, client?: PostHog): boolean | undefined
export function useFeatureFlagEnabled(flag: string, defaultValue?: boolean, client?: PostHog): boolean | undefined {
  const posthog = useOverridablePostHog(client, 'useFeatureFlagEnabled')
  const [enabled, setEnabled] = useState<boolean | undefined>(() => posthog?.getFeatureFlagResult(flag)?.enabled)

  useEffect(() => {
    setEnabled(posthog?.getFeatureFlagResult(flag)?.enabled)
    return posthog?.onFeatureFlags(() => {
      setEnabled(posthog.getFeatureFlagResult(flag)?.enabled)
    })
  }, [posthog, flag])

  return enabled === undefined ? defaultValue : enabled
}
