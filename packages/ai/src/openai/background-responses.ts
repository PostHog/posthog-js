import { Stream } from 'openai/streaming'
import type { Response, ResponseStreamEvent } from 'openai/resources/responses/responses'

const TERMINAL_RESPONSE_STATUSES = new Set(['completed', 'failed', 'cancelled', 'incomplete'])

export function isPendingBackgroundResponse(
  params: { background?: boolean | null },
  response: { status?: string | null }
): boolean {
  return params.background === true && !!response.status && !TERMINAL_RESPONSE_STATUSES.has(response.status)
}

export function isTerminalResponse(response: { status?: string | null }): boolean {
  return !!response.status && TERMINAL_RESPONSE_STATUSES.has(response.status)
}

/**
 * Uses provider timestamps so background polling cadence does not inflate
 * generation latency. Non-completed responses do not expose a terminal time.
 */
export function getBackgroundResponseLatency(
  response: Pick<Response, 'created_at' | 'completed_at'>
): number | undefined {
  if (typeof response.created_at !== 'number' || typeof response.completed_at !== 'number') {
    return undefined
  }

  return Math.max(0, response.completed_at - response.created_at)
}

/**
 * Keeps the original create context available while a background response is
 * polled. Entries are insertion ordered, so the oldest context is discarded
 * when the bound is reached.
 */
export class BackgroundResponseTracker<Context> {
  private readonly contexts = new Map<string, Context>()

  constructor(private readonly maxEntries = 1000) {}

  set(responseID: string, context: Context): void {
    // Refresh an existing response's insertion order.
    this.contexts.delete(responseID)
    this.contexts.set(responseID, context)

    while (this.contexts.size > this.maxEntries) {
      const oldestResponseID = this.contexts.keys().next().value
      if (oldestResponseID === undefined) {
        break
      }
      this.contexts.delete(oldestResponseID)
    }
  }

  get(responseID: string): Context | undefined {
    return this.contexts.get(responseID)
  }

  take(responseID: string): Context | undefined {
    const context = this.contexts.get(responseID)
    if (context !== undefined) {
      this.contexts.delete(responseID)
    }
    return context
  }
}

/**
 * Inspects a streamed background retrieval without consuming it on the
 * caller's behalf. The stored create context is consumed only by a terminal
 * response; an interrupted or nonterminal stream may be followed by another
 * retrieval while the background job continues.
 */
export function wrapBackgroundResponseStream<Context>(
  stream: Stream<ResponseStreamEvent>,
  responseID: string,
  tracker: BackgroundResponseTracker<Context>,
  captureTerminalResponse: (response: Response, context: Context) => Promise<void>
): Stream<ResponseStreamEvent> {
  async function* inspectStream(): AsyncGenerator<ResponseStreamEvent> {
    for await (const event of stream) {
      if ('response' in event && isTerminalResponse(event.response)) {
        const context = tracker.take(responseID)
        if (context) {
          // Monitoring must not delay or disrupt delivery of the provider stream.
          void captureTerminalResponse(event.response, context).catch(() => undefined)
        }
      }

      yield event
    }
  }

  return new Stream(() => inspectStream(), stream.controller)
}
