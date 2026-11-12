import { useEffect, useState } from 'react'
import type { PostHog } from '../posthog-rn'
import { useOverridablePostHog } from './utils'

/**
 * A feature flag's value for the current user, updated when flags load: the variant key for a
 * multivariate flag, or `true`/`false` for a boolean flag. `undefined` while flags are loading or when
 * the flag doesn't exist.
 *
 * @param flag Key of the feature flag
 * @param client A PostHog client to use instead of the one from `PostHogProvider`
 */
export function useFeatureFlagVariantKey(flag: string, client?: PostHog): string | boolean | undefined {
  const posthog = useOverridablePostHog(client, 'useFeatureFlagVariantKey')
  const [value, setValue] = useState<string | boolean | undefined>(() => posthog?.getFeatureFlag(flag))

  useEffect(() => {
    setValue(posthog?.getFeatureFlag(flag))
    return posthog?.onFeatureFlags(() => {
      setValue(posthog.getFeatureFlag(flag))
    })
  }, [posthog, flag])

  return value
}
