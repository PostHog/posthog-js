// `$mcp_error_status`: the HTTP status behind a failed call, read off the thrown
// error's `cause` chain (sdk-specs mcp-analytics "Failure capture").
import { describe, expect, it } from 'vitest'

import { PostHogMCP } from '../index'
import { PostHogMCPAnalyticsEvent, PostHogMCPAnalyticsProperty } from '../extensions/constants'
import { EventCapture } from './test-utils'

function failure(message: string, fields: Record<string, unknown> = {}, cause?: unknown): Error {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), fields)
}

function fetchFailure(status: number): Error {
  return failure(`${status} from upstream`, { response: new Response(null, { status }) })
}

function cycle(): Error {
  const first = failure('first')
  const second = failure('second', {}, first)
  Object.assign(first, { cause: second })
  return first
}

function chainOf(length: number, status: number): Error {
  let error = failure('innermost', { status })
  for (let link = 1; link < length; link++) {
    error = failure('wrapper', {}, error)
  }
  return error
}

function unreadableResponse(): Error {
  const error = failure('failed')
  Object.defineProperty(error, 'response', {
    get() {
      throw new Error('response not loaded')
    },
  })
  return error
}

describe('$mcp_error_status', () => {
  let capture: EventCapture
  let posthog: PostHogMCP

  beforeEach(async () => {
    capture = new EventCapture()
    await capture.start()
    posthog = new PostHogMCP('phc_test', { host: 'http://localhost', flushAt: 1, fetchRetryCount: 0 })
  })

  afterEach(async () => {
    await capture.stop()
    await posthog.shutdown()
  })

  async function toolCallProperties(): Promise<Record<string, unknown>> {
    await new Promise((resolve) => setTimeout(resolve, 0))
    const [toolCall] = capture.findCapturesByEvent(PostHogMCPAnalyticsEvent.ToolCall)
    return toolCall.properties
  }

  it.each([
    ['a fetch Response on the error', fetchFailure(503), 503],
    ['the error a wrapper names as its cause', failure('lookup failed', {}, fetchFailure(503)), 503],
    ['the outermost status in the chain', failure('not found', { status: 404 }, fetchFailure(503)), 404],
    ['status_code on the error', failure('failed', { status_code: 502 }), 502],
    ['statusCode on the error', failure('failed', { statusCode: 502 }), 502],
    ['status on the error', failure('failed', { status: 502 }), 502],
    ['a later name when an earlier one is unset', failure('failed', { status_code: null, status: 502 }), 502],
    ['statusCode on the response', failure('failed', { response: { statusCode: 502 } }), 502],
    [
      'the response when the error status is not HTTP',
      failure('failed', { status: 'failed', response: { status: 401 } }),
      401,
    ],
    ['nothing below 100', failure('failed', { status: 42 }), undefined],
    ['nothing above 599', failure('failed', { status: 600 }), undefined],
    ['nothing from a boolean', failure('failed', { status: true }), undefined],
    ['nothing from a numeric string', failure('failed', { status: '503' }), undefined],
    ['nothing from a fraction', failure('failed', { status: 503.5 }), undefined],
    ['nothing from an error without one', failure('no status here'), undefined],
    ['the 50th error in the chain', chainOf(50, 503), 503],
    ['nothing past the 50th error', chainOf(51, 503), undefined],
    ['nothing from a cause cycle', cycle(), undefined],
    ['nothing from a response that throws when read', unreadableResponse(), undefined],
    ['nothing from a thrown string', 'upstream returned 503', undefined],
  ])('reads %s', async (_case, error, status) => {
    posthog.captureToolCall({ toolName: 'fetch_invoice', isError: true, error })

    const properties = await toolCallProperties()
    expect(properties[PostHogMCPAnalyticsProperty.IsError]).toBe(true)
    expect(properties[PostHogMCPAnalyticsProperty.ErrorStatus]).toBe(status)
  })

  it('keeps a status the caller sets explicitly', async () => {
    posthog.captureToolCall({
      toolName: 'fetch_invoice',
      isError: true,
      error: fetchFailure(503),
      properties: { [PostHogMCPAnalyticsProperty.ErrorStatus]: 418 },
    })

    expect((await toolCallProperties())[PostHogMCPAnalyticsProperty.ErrorStatus]).toBe(418)
  })
})
