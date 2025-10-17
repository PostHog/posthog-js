/**
 * Typed event capture infrastructure for PostHog.
 * Event schemas are defined via module augmentation in posthog-events.d.ts
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