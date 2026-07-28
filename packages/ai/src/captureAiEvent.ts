import type { EventMessage } from 'posthog-node'

/** @internal */
export type MultimodalCaptureGate = {
  readonly _enableMultimodalCapture?: boolean
}

/** @internal */
export interface AiLaneCapableClient extends MultimodalCaptureGate {
  capture(props: EventMessage): void
  captureImmediate(props: EventMessage): Promise<void>
  readonly _useAiLane?: boolean
  _captureAi?(props: EventMessage): void
  _captureAiImmediate?(props: EventMessage): Promise<void>
}

/** @internal */
export function isMultimodalCaptureEnabled(client?: MultimodalCaptureGate): boolean {
  return client?._enableMultimodalCapture === true
}

function aiLaneEnabled(client: AiLaneCapableClient): boolean {
  return client._useAiLane === true || isMultimodalCaptureEnabled(client)
}

/** @internal */
export function captureAiEvent(client: AiLaneCapableClient, event: EventMessage): void {
  if (aiLaneEnabled(client) && typeof client._captureAi === 'function') {
    client._captureAi(event)
    return
  }
  client.capture(event)
}

/** @internal */
export function captureAiEventImmediate(client: AiLaneCapableClient, event: EventMessage): Promise<void> {
  if (aiLaneEnabled(client) && typeof client._captureAiImmediate === 'function') {
    return client._captureAiImmediate(event)
  }
  return client.captureImmediate(event)
}
