import type { JsonType, PostHogEventProperties } from '@posthog/core'

import type { V1Event, V1EventOptions } from './types'

/** Legacy property -> the `options` key it fills when the caller left that option unset. */
const LEGACY_OPTION_PROPERTIES: ReadonlyArray<{ property: string; optionKey: string }> = [
  { property: '$process_person_profile', optionKey: 'process_person_profile' },
  { property: '$cookieless_mode', optionKey: 'cookieless_mode' },
  { property: '$ignore_sent_at', optionKey: 'disable_skew_correction' },
  { property: '$product_tour_id', optionKey: 'product_tour_id' },
]

/** Property -> top-level string field; any value that is not a string is dropped. */
const TOPLEVEL_SENTINELS: ReadonlyArray<{ property: string; field: 'session_id' | 'window_id' }> = [
  { property: '$session_id', field: 'session_id' },
  { property: '$window_id', field: 'window_id' },
]

function isRecord(value: unknown): value is PostHogEventProperties {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonTypeName(value: JsonType): string {
  return Array.isArray(value) ? 'array' : typeof value
}

/**
 * A copy of the caller's per-event options, or undefined when there are none. Any value that
 * is not an object is reported and ignored, so the event is still sent.
 */
export function readEventOptions(value: unknown): V1EventOptions | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (isRecord(value)) {
    return { ...value }
  }
  // console.error, not the client logger: the logger only prints in debug mode, and the event loses its options.
  console.error('[PostHog] options must be an object; sending the event without its options')
  return undefined
}

/**
 * Normalize an event timestamp to an RFC 3339 string. The queued message
 * carries either an ISO string (from `currentISOTime()`) or a `Date` (when the
 * caller passed one); numbers are treated as epoch milliseconds. Invalid values
 * fall back to "now" so a bad timestamp never rejects the whole batch.
 */
function toRfc3339(timestamp: unknown): string {
  if (typeof timestamp === 'string') {
    const asDate = new Date(timestamp)
    if (Number.isNaN(asDate.getTime())) {
      return new Date().toISOString()
    }

    const normalized = asDate.toISOString()
    const fractionalSeconds = timestamp.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})?$/i)?.[1]
    return fractionalSeconds && fractionalSeconds.length > 3
      ? normalized.replace(/\.\d{3}Z$/, `.${fractionalSeconds}Z`)
      : normalized
  }
  if (timestamp instanceof Date) {
    return Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString()
  }
  const asDate = timestamp == null ? new Date() : new Date(timestamp as string | number)
  return Number.isNaN(asDate.getTime()) ? new Date().toISOString() : asDate.toISOString()
}

/**
 * Relocate a top-level `$set`/`$set_once` value into `properties`. v1 has no
 * top-level form; the server reads them from inside `properties`. An existing
 * `properties` value wins on collision.
 */
function relocateInto(properties: PostHogEventProperties, key: string, value: JsonType | undefined): void {
  if (value !== undefined && !(key in properties)) {
    properties[key] = value
  }
}

/**
 * Transform one already-normalized queued message into a Capture V1 wire event.
 *
 * The input message is never mutated (events may be retried or handed to
 * callbacks): fresh `options` and `properties` maps are built. Option values are
 * sent unchanged; capture reads them. Each legacy option property is removed from
 * `properties` and fills its option when the caller left that option missing or
 * `null`. `$session_id`/`$window_id` move to the top-level `session_id`/`window_id`
 * fields; `$lib`/`$lib_version` are stripped (the server injects them from
 * `PostHog-Sdk-Info`); top-level `$set`/`$set_once` are relocated into `properties`.
 */
export function buildV1Event(message: PostHogEventProperties): V1Event {
  const sourceProperties = isRecord(message.properties) ? message.properties : {}
  const properties: PostHogEventProperties = { ...sourceProperties }

  const options: V1EventOptions = readEventOptions(message.options) ?? {}
  for (const { property, optionKey } of LEGACY_OPTION_PROPERTIES) {
    if (!(property in properties)) {
      continue
    }
    const legacyValue = properties[property]
    delete properties[property]
    const option = options[optionKey]
    if ((option === undefined || option === null) && legacyValue !== undefined) {
      options[optionKey] = legacyValue
    }
  }

  const topLevel: { session_id?: string; window_id?: string } = {}
  for (const { property, field } of TOPLEVEL_SENTINELS) {
    if (!(property in properties)) {
      continue
    }
    const value = properties[property]
    delete properties[property]
    if (typeof value === 'string') {
      topLevel[field] = value
    } else if (value !== undefined && value !== null) {
      // console.warn, not the client logger: the logger only prints in debug mode, and the event loses this id.
      console.warn(`[PostHog] dropping ${property}: a ${jsonTypeName(value)} value is not a string`)
    }
  }

  delete properties.$lib
  delete properties.$lib_version

  relocateInto(properties, '$set', message.$set)
  relocateInto(properties, '$set_once', message.$set_once)

  return {
    event: String(message.event ?? ''),
    uuid: String(message.uuid ?? ''),
    distinct_id: String(message.distinct_id ?? ''),
    timestamp: toRfc3339(message.timestamp),
    ...topLevel,
    options,
    properties,
  }
}
