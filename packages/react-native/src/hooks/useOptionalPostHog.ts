import type { PostHog } from '../posthog-rn'
import React from 'react'
import { PostHogContext } from '../PostHogContext'

/**
 * Returns the optional PostHog client from context, or undefined if not available.
 * Should only be used in hooks that also accept an optional client via props, and should not throw if no client is available since the prop client may be provided instead.
 * @internal
 */
export const useOptionalPostHog = (): PostHog | undefined => {
  const { client } = React.useContext(PostHogContext)
  return client
}

/**
 * Assert that a PostHog client exists and throw a clear error if not. Should be used by any hook that accepts an optional client via props.
 * @internal
 */
export function validatePostHogClient(client?: PostHog, caller?: string): asserts client is PostHog {
  if (!client) {
    throw new Error(
      `${caller ? caller + ' requires' : 'This hook requires'} a PostHog client provided as an argument or via context. See https://posthog.com/docs/libraries/react-native#usefeatureflag`
    )
  }
}
