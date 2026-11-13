import { useEffect, useState } from 'react'
import type { PostHog } from '../posthog-rn'
import { useOverridablePostHog } from './utils'

/**
 * The keys of the feature flags enabled for the current user, updated when flags load.
 *
 * @param client A PostHog client to use instead of the one from `PostHogProvider`
 */
export function useActiveFeatureFlags(client?: PostHog): string[] {
  const posthog = useOverridablePostHog(client, 'useActiveFeatureFlags')
  const [flags, setFlags] = useState<string[]>(() => enabledFlagKeys(posthog))

  useEffect(() => {
    setFlags(enabledFlagKeys(posthog))
    return posthog?.onFeatureFlags((loaded) => {
      setFlags(loaded.flags)
    })
  }, [posthog])

  return flags
}

const enabledFlagKeys = (posthog: PostHog | undefined): string[] =>
  Object.entries(posthog?.getFeatureFlagDetails()?.featureFlags ?? {})
    .filter(([, value]) => value === true || (typeof value === 'string' && value !== ''))
    .map(([key]) => key)
