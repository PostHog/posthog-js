/**
 * Typed event capture infrastructure for PostHog.
 *
 * Event schemas can be augmented in PostHogEventSchemas interface via module augmentation.
 * This is typically done by generated types from `posthog-cli schema pull`.
 *
 * @example
 * // In your types file or generated file:
 * declare module '@posthog/core' {
 *   interface PostHogEventSchemas {
 *     'user_signed_up': { plan: string; trial: boolean }
 *     'purchase_completed': { amount: number; currency: string }
 *   }
 * }
 *
 * // Usage:
 * posthog.typed.user_signed_up({ plan: 'pro', trial: true })
 * posthog.typed.purchase_completed({ amount: 99.99, currency: 'USD' })
 */

import type { PostHogEventSchemas } from './types'

// Utility type that allows schema properties plus any additional properties
// The schema properties are strictly typed, additional ones are any
export type EventWithAdditionalProperties<T> = T & Record<string, any>

/**
 * Mapped type that creates typed methods for each event in PostHogEventSchemas.
 * Methods are generated dynamically based on the augmented interface.
 */
export type TypedEventCapture<Client extends { capture: (event: string, properties?: any) => any }> = {
  [K in keyof PostHogEventSchemas]: (
    properties: EventWithAdditionalProperties<PostHogEventSchemas[K]>
  ) => ReturnType<Client['capture']>
}

/**
 * Creates a Proxy that dynamically generates typed event methods
 * based on the PostHogEventSchemas interface.
 */
export function createTypedEventCapture<Client extends { capture: (event: string, properties?: any) => any }>(
  client: Client
): TypedEventCapture<Client> {
  return new Proxy({} as TypedEventCapture<Client>, {
    get: (_target, eventName: string) => {
      return (properties: any) => {
        return client.capture(eventName, properties)
      }
    },
  })
}
