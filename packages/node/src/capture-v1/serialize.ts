import { type PostHogEventProperties, safeJsonStringify } from '@posthog/core'

import { buildV1Event } from './transform'

const encoder = new TextEncoder()

// `buildV1Event` puts `properties` last, so the event JSON is the rest of the event with this key and the properties appended.
const PROPERTIES_KEY = ',"properties":'
const PROPERTIES_KEY_BYTES = encoder.encode(PROPERTIES_KEY).length

/** One wire event, serialized once and reused verbatim in every request body that carries it. */
export interface SerializedV1Event {
  uuid: string
  json: string
  /** UTF-8 size of `json`. */
  bytes: number
  /** UTF-8 size of the serialized `properties` object alone, which is what the AI endpoint limits. */
  propertiesBytes: number
}

export function serializeV1Event(message: PostHogEventProperties): SerializedV1Event {
  const { properties, ...rest } = buildV1Event(message)
  const restJson = safeJsonStringify(rest)
  const propertiesJson = safeJsonStringify(properties)
  const propertiesBytes = encoder.encode(propertiesJson).length
  return {
    uuid: rest.uuid,
    json: `${restJson.slice(0, -1)}${PROPERTIES_KEY}${propertiesJson}}`,
    // The closing brace moves from the end of `restJson` to the end of the event, so it is counted once.
    bytes: encoder.encode(restJson).length + PROPERTIES_KEY_BYTES + propertiesBytes,
    propertiesBytes,
  }
}

/**
 * The Capture V1 batch envelope, built from already-serialized events. Unlike v0 there is no
 * `api_key` (Bearer auth) and no `sent_at`. `historical_migration` is omitted when false.
 */
export function buildV1Body(
  events: readonly { json: string }[],
  { createdAt, historicalMigration }: { createdAt: string; historicalMigration: boolean }
): string {
  const migration = historicalMigration ? ',"historical_migration":true' : ''
  return `{"created_at":${JSON.stringify(createdAt)}${migration},"batch":[${events.map((event) => event.json).join(',')}]}`
}
