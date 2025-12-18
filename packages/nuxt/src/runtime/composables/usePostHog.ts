import { useNuxtApp } from '#app'
import type posthog from 'posthog-js'

/**
 * Get the PostHog client instance
 *
 * @remarks
 * This composable provides access to the PostHog client instance initialized.
 * It returns `undefined` on the server side or if PostHog is not yet initialized.
 *
 * @example
 * ```ts
 * const posthog = usePostHog()
 * posthog.capture('event')
 * ```
 *
 * @returns The PostHog client instance
 */
export function usePostHog(): typeof posthog | undefined {
  const { $posthog } = useNuxtApp()
  return ($posthog as () => typeof posthog | undefined)?.()
}
