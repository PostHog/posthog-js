import {
  acceptsEventOptions,
  EVENT_OPTION_LEGACY_PROPERTIES,
  eventOptionsAsLegacyProperties,
  type JsonType,
} from '@posthog/core'
import type { EventMessage, PostHog } from 'posthog-node'

import type { Event } from '../types'
import type { PostHogCaptureEvent } from './posthog-events'

export type EventOptions = Record<string, JsonType>

/** The event property that carried person processing before posthog-node had per-event options. */
export const PERSON_PROCESSING_PROPERTY = EVENT_OPTION_LEGACY_PROPERTIES.process_person_profile

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** posthog-node treats a missing or `null` option as unset, so a lower layer can still fill it. */
function isUnsetOption(value: unknown): boolean {
  return value === undefined || value === null
}

function nonEmpty(options: EventOptions): EventOptions | undefined {
  return Object.keys(options).length > 0 ? options : undefined
}

/**
 * Layers per-event options the way posthog-node does: each key `higher` sets wins, and `lower`
 * fills the keys it left unset. A value that is not an object counts as no options.
 */
export function mergeEventOptions(lower: unknown, higher: unknown): EventOptions | undefined {
  const merged: EventOptions = isRecord(higher) ? { ...(higher as EventOptions) } : {}
  if (isRecord(lower)) {
    for (const [key, value] of Object.entries(lower)) {
      if (value !== undefined && isUnsetOption(merged[key])) {
        merged[key] = value as JsonType
      }
    }
  }
  return nonEmpty(merged)
}

/**
 * Without a resolved identity the distinct id is just the session id, so processing a person
 * profile would mint one anonymous person per session and inflate person counts. Such an event
 * is personless by default, unless the caller chose a `process_person_profile` value through
 * `eventOptions` or the event property.
 */
export function hasPersonlessDefault(event: Event): boolean {
  if (event.identifyActorGivenId) {
    return false
  }
  if (isRecord(event.eventOptions) && !isUnsetOption(event.eventOptions.process_person_profile)) {
    return false
  }
  return event.properties?.[PERSON_PROCESSING_PROPERTY] === undefined
}

/**
 * The options for one payload `beforeSend` will see: the event's own, plus
 * `process_person_profile: false` when {@link hasPersonlessDefault} applies. The default is
 * also written to `properties`, so a hook that deletes or flips that property keeps working;
 * {@link settlePersonProcessing} removes it again after the hook.
 */
export function buildPayloadOptions(event: Event, properties: Record<string, unknown>): EventOptions | undefined {
  const options: EventOptions = isRecord(event.eventOptions) ? { ...event.eventOptions } : {}
  if (hasPersonlessDefault(event)) {
    options.process_person_profile = false
    properties[PERSON_PROCESSING_PROPERTY] = false
  }
  return nonEmpty(options)
}

/**
 * Settles person processing on a payload after `beforeSend`, so the result carries it only as the
 * `process_person_profile` option. A set option wins over the event property, except while the
 * option still holds the SDK's personless default: then the property decides, because an
 * existing hook deletes or flips the property to turn person processing back on.
 */
export function settlePersonProcessing(capture: PostHogCaptureEvent, personlessDefault: boolean): PostHogCaptureEvent {
  const { options: hookOptions, ...rest } = capture
  const properties = { ...capture.properties }
  const property = properties[PERSON_PROCESSING_PROPERTY]
  delete properties[PERSON_PROCESSING_PROPERTY]

  const options: EventOptions = isRecord(hookOptions) ? { ...hookOptions } : {}
  const option = options.process_person_profile
  if (isUnsetOption(option) || (personlessDefault && option === false)) {
    if (property === undefined) {
      delete options.process_person_profile
    } else {
      options.process_person_profile = property as JsonType
    }
  }

  const settled = nonEmpty(options)
  return settled ? { ...rest, properties, options: settled } : { ...rest, properties }
}

/**
 * The `properties` and `options` to hand a client. posthog-node 6 takes the options as they
 * are; `registerOptions` first shipped in 6.0, so it tells the majors apart. posthog-node 5 has
 * no per-event options: each known option is sent as the property that version reads, and an
 * unknown key is dropped.
 */
export function clientOptionFields(
  posthog: PostHog,
  properties: Record<string, unknown>,
  options: EventOptions | undefined
): Pick<EventMessage, 'properties' | 'options'> {
  if (!options) {
    return { properties }
  }
  if (acceptsEventOptions(posthog)) {
    return { properties, options }
  }
  return { properties: { ...properties, ...eventOptionsAsLegacyProperties(options) } }
}
