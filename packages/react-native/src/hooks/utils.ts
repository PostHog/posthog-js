import { useContext } from 'react'
import type { PostHog } from '../posthog-rn'
import { PostHogContext } from '../PostHogContext'

const warnedCallers = new Set<string>()

/**
 * Log an error if the PostHog client is not available. Warns once per unique caller to avoid console spam.
 * @internal
 */
export function warnIfNoClient(client: PostHog | undefined, caller: string): void {
  if (!client && !warnedCallers.has(caller)) {
    warnedCallers.add(caller)
    console.error(
      `${caller} was called without a PostHog client. Wrap your app with <PostHogProvider> or pass a client directly. See https://posthog.com/docs/libraries/react-native?#with-the-posthogprovider`
    )
  }
}

/** @internal Exported for testing only. */
export function resetWarnedCallers(): void {
  warnedCallers.clear()
}

/**
 * Returns the first available PostHog client from arguments or context, correctly typed. Logs an error if no
 * client is found. This is used internally by hooks that accept an optional client parameter.
 * @internal
 */
export const useOverridablePostHog = (client: PostHog | undefined, caller: string): PostHog | undefined => {
  const { client: contextClient } = useContext(PostHogContext)
  const posthog = client ?? (contextClient as PostHog | undefined)
  warnIfNoClient(posthog, caller)
  return posthog
}
