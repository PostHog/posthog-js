import type { EventMessage } from 'posthog-node'

/** The single flag the sanitization/truncation passthrough gate reads. */
export type MultimodalCaptureGate = {
  readonly _enableMultimodalCapture?: boolean
}

/**
 * Structural client contract for AI-lane routing. Optional members and strict-`true` checks
 * tolerate duck-typed and mock clients from downstream test suites.
 */
export interface AiLaneCapableClient extends MultimodalCaptureGate {
  capture(props: EventMessage): void
  captureImmediate(props: EventMessage): Promise<void>
  readonly _useAiLane?: boolean
  _captureAi?(props: EventMessage): void
  _captureAiImmediate?(props: EventMessage): Promise<void>
}

export function isMultimodalCaptureEnabled(client?: MultimodalCaptureGate): boolean {
  return client?._enableMultimodalCapture === true
}

function aiLaneEnabled(client: AiLaneCapableClient): boolean {
  return client._useAiLane === true || isMultimodalCaptureEnabled(client)
}

/**
 * Wrapper-layer send seam: routes to the dedicated AI capture lane when the client opted in,
 * falling back to `capture()` for clients without the lane so mock-based suites keep passing.
 */
export function captureAiEvent(client: AiLaneCapableClient, event: EventMessage): void {
  if (aiLaneEnabled(client) && typeof client._captureAi === 'function') {
    client._captureAi(event)
    return
  }
  client.capture(event)
}

/** Immediate-mode {@link captureAiEvent}. */
export function captureAiEventImmediate(client: AiLaneCapableClient, event: EventMessage): Promise<void> {
  if (aiLaneEnabled(client) && typeof client._captureAiImmediate === 'function') {
    return client._captureAiImmediate(event)
  }
  return client.captureImmediate(event)
}
