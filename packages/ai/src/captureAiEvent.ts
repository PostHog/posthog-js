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
  getLibraryVersion?(): string
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

/**
 * Turns person processing off for an AI event with no user distinct id. On posthog-node 6 the
 * option beats context and global options, which the legacy `$process_person_profile` property
 * cannot do. posthog-node 5 ignores options and reads the property, so callers set both.
 *
 * @internal
 */
export function personlessOptions(personless: boolean): Pick<EventMessage, 'options'> {
  return personless ? { options: { process_person_profile: false } } : {}
}

/**
 * posthog-node 6 sends every AI event on its capture v1 AI lane; `enableFullAiCapture` then only
 * controls truncation and media redaction. posthog-node 5 keeps the opt-in, so an `@posthog/ai`
 * upgrade never changes how a 5.x client sends.
 *
 * @internal
 */
export function usesAiLane(client: AiLaneCapableClient): boolean {
  const major = Number.parseInt(client.getLibraryVersion?.() ?? '', 10)
  return major >= 6 || isFullAiCaptureEnabled(client)
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
