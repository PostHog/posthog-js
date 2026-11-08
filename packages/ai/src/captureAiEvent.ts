import type { JsonType } from '@posthog/core'
import type { EventMessage } from 'posthog-node'

/** @internal */
export type FullAiCaptureGate = {
  readonly enableFullAiCapture?: boolean
}

/** @internal */
export interface AiLaneCapableClient extends FullAiCaptureGate {
  capture(props: EventMessage): void
  captureImmediate(props: EventMessage): Promise<void>
  captureAi?(props: EventMessage): string | undefined
  captureAiImmediate?(props: EventMessage): Promise<string | undefined>
  registerOptions?(options: Record<string, unknown>): Promise<void>
}

/** @internal */
export function isFullAiCaptureEnabled(client?: FullAiCaptureGate): boolean {
  return client?.enableFullAiCapture === true
}

/**
 * The caller's distinct id as a string, or undefined when it is missing, empty or only whitespace.
 *
 * @internal
 */
export function userDistinctId(value: unknown): string | undefined {
  if (!value) {
    return undefined
  }
  const id = String(value)
  return id.trim() === '' ? undefined : id
}

/** Per-event options, as posthog-node 6 takes them on `capture()`. */
export type AiEventOptions = Record<string, JsonType>

/** Each posthog-node per-event option, mapped to the event property posthog-node 5 reads instead. */
const NODE_5_OPTION_PROPERTIES: ReadonlyMap<string, string> = new Map([
  ['process_person_profile', '$process_person_profile'],
  ['cookieless_mode', '$cookieless_mode'],
  ['disable_skew_correction', '$ignore_sent_at'],
  ['product_tour_id', '$product_tour_id'],
])

/**
 * The caller's per-event options when they are an object. A missing or `null` value means no
 * options. An array or any other value is reported and ignored, so it is never spread.
 *
 * @internal
 */
export function readAiEventOptions(value: unknown): AiEventOptions | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as AiEventOptions
  }
  console.warn(
    `[PostHog AI] options must be an object, got ${Array.isArray(value) ? 'array' : typeof value}; ignoring them`
  )
  return undefined
}

/**
 * The `properties` and `options` for an AI event. `personless` (no user distinct id) turns person
 * processing off and beats the caller's `process_person_profile`.
 *
 * posthog-node 6 takes the options as they are, so no option is written as a property.
 * posthog-node 5 has no per-event options: each known option is sent as the property that version
 * reads, and an unknown key is dropped.
 *
 * @internal
 */
export function eventOptionFields(
  client: Pick<AiLaneCapableClient, 'registerOptions'>,
  properties: Record<string, unknown>,
  options: unknown,
  personless: boolean
): Pick<EventMessage, 'properties' | 'options'> {
  const userOptions = readAiEventOptions(options)
  if (isPostHogNode6(client)) {
    const eventOptions: AiEventOptions = {
      ...userOptions,
      ...(personless ? { process_person_profile: false } : {}),
    }
    return Object.keys(eventOptions).length > 0 ? { properties, options: eventOptions } : { properties }
  }

  const withOptionProperties: Record<string, unknown> = { ...properties }
  for (const [key, value] of Object.entries(userOptions ?? {})) {
    const property = NODE_5_OPTION_PROPERTIES.get(key)
    // posthog-node 6 treats a missing or `null` option as unset, so neither becomes a property.
    if (property !== undefined && value !== undefined && value !== null) {
      withOptionProperties[property] = value
    }
  }
  if (personless) {
    withOptionProperties.$process_person_profile = false
  }
  return { properties: withOptionProperties }
}

/**
 * Whether the client is posthog-node 6 or later. `registerOptions` first shipped in 6.0. The
 * version is not read, because `getLibraryVersion()` can be overridden by a subclass or wrapper.
 *
 * @internal
 */
export function isPostHogNode6(client: Pick<AiLaneCapableClient, 'registerOptions'>): boolean {
  return typeof client.registerOptions === 'function'
}

/**
 * posthog-node 6 sends every AI event on its capture v1 AI lane; `enableFullAiCapture` then only
 * controls truncation and media redaction. posthog-node 5 keeps the opt-in, so an `@posthog/ai`
 * upgrade never changes how a 5.x client sends.
 *
 * @internal
 */
export function usesAiLane(client: AiLaneCapableClient): boolean {
  return isPostHogNode6(client) || isFullAiCaptureEnabled(client)
}

/** @internal */
export function captureAiEvent(client: AiLaneCapableClient, event: EventMessage): void {
  if (usesAiLane(client) && typeof client.captureAi === 'function') {
    client.captureAi(event)
    return
  }
  client.capture(event)
}

/** @internal */
export async function captureAiEventImmediate(client: AiLaneCapableClient, event: EventMessage): Promise<void> {
  if (usesAiLane(client) && typeof client.captureAiImmediate === 'function') {
    await client.captureAiImmediate(event)
    return
  }
  await client.captureImmediate(event)
}
