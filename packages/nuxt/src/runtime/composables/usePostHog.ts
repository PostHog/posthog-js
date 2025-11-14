import { useNuxtApp } from '#app'
import type posthog from 'posthog-js'

/**
 * Get the PostHog client instance
 *
 * @example
 * ```ts
 * const posthog = usePostHog()
 * posthog.capture('event')
 * ```
 *
 * @returns The PostHog client instance
 */
export function usePostHog(): typeof posthog {
  const { $posthog } = useNuxtApp()
  return $posthog()
}
