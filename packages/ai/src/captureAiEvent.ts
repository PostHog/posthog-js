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
}

/** @internal */
export function isFullAiCaptureEnabled(client?: FullAiCaptureGate): boolean {
  return client?.enableFullAiCapture === true
}

/** @internal */
export function captureAiEvent(client: AiLaneCapableClient, event: EventMessage): void {
  if (isFullAiCaptureEnabled(client) && typeof client.captureAi === 'function') {
    client.captureAi(event)
    return
  }
  client.capture(event)
}

/** @internal */
export async function captureAiEventImmediate(client: AiLaneCapableClient, event: EventMessage): Promise<void> {
  if (isFullAiCaptureEnabled(client) && typeof client.captureAiImmediate === 'function') {
    await client.captureAiImmediate(event)
    return
  }
  await client.captureImmediate(event)
}
