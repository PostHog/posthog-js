import type { PostHogEventProperties } from '../types'
import { safeJsonStringify } from '../utils/string-utils'

import { buildV1Event } from './transform'

// Counted by hand: TextEncoder is missing on Hermes before React Native 0.74 and on JSC.
// A lone surrogate counts 3 bytes, the U+FFFD it becomes when encoded.
function utf8Length(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index++
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}

// `buildV1Event` puts `properties` last, so the event JSON is the rest of the event with this key and the properties appended.
const PROPERTIES_KEY = ',"properties":'
const PROPERTIES_KEY_BYTES = utf8Length(PROPERTIES_KEY)

/** One wire event, serialized once and reused verbatim in every request body that carries it. */
export interface SerializedV1Event {
  uuid: string
  json: string
  /** UTF-8 size of `json`. */
  bytes: number
  /** UTF-8 size of the serialized `properties` object alone, which is what the AI endpoint limits. */
  propertiesBytes: number
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
// JSON.stringify writes a lone surrogate as a `\udXXX` escape (a valid pair stays raw), which capture rejects for the whole
// request. The lookbehind skips an escaped backslash followed by literal "udXXX" text.
const LONE_SURROGATE_ESCAPE = /(?<!\\)((?:\\\\)*)\\u[dD][89a-fA-F][0-9a-fA-F]{2}/g

/**
 * Why capture would reject this event, or undefined when it can be sent. A name must be a non-empty string, the
 * distinct id a string, and the name and ids well-formed Unicode: a broken id is never repaired, because two broken ids
 * could collapse into one.
 */
export function wireProblem(message: PostHogEventProperties): string | undefined {
  const { event, distinct_id: distinctId, properties } = message
  if (typeof event !== 'string' || event === '') {
    return 'event name is missing, empty or not a string'
  }
  // Caller ids are already strings, so only a before_send hook can leave a non-string here.
  if (typeof distinctId !== 'string') {
    return 'distinct id is missing or not a string'
  }
  const props = (properties ?? {}) as Record<string, unknown>
  const ids = [event, distinctId, props.$session_id, props.$window_id]
  if (ids.some((value) => typeof value === 'string' && LONE_SURROGATE.test(value))) {
    return 'event name or id is not well-formed Unicode'
  }
  return undefined
}

export function serializeV1Event(message: PostHogEventProperties): SerializedV1Event {
  const { properties, ...rest } = buildV1Event(message)
  const restJson = safeJsonStringify(rest)
  const rawPropertiesJson = safeJsonStringify(properties)
  // Property strings are repaired to U+FFFD rather than dropping the event.
  const propertiesJson =
    rawPropertiesJson.includes('\\ud') || rawPropertiesJson.includes('\\uD')
      ? rawPropertiesJson.replace(LONE_SURROGATE_ESCAPE, '$1\\ufffd')
      : rawPropertiesJson
  const propertiesBytes = utf8Length(propertiesJson)
  return {
    uuid: rest.uuid,
    json: `${restJson.slice(0, -1)}${PROPERTIES_KEY}${propertiesJson}}`,
    // The closing brace moves from the end of `restJson` to the end of the event, so it is counted once.
    bytes: utf8Length(restJson) + PROPERTIES_KEY_BYTES + propertiesBytes,
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
