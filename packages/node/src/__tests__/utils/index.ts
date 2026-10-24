import { PostHogV2FlagsResponse } from '@posthog/core'
import util from 'util'

const LEGACY_CAPTURE_PATH = '/batch/'
const V1_ANALYTICS_CAPTURE_PATH = '/i/v1/analytics/events'
const ANALYTICS_CAPTURE_PATHS = [LEGACY_CAPTURE_PATH, V1_ANALYTICS_CAPTURE_PATH]

const isAnalyticsCaptureUrl = (url: unknown): boolean => {
  const { pathname } = new URL(String(url))
  return ANALYTICS_CAPTURE_PATHS.includes(pathname)
}

/** Matches the analytics capture URL of either wire format: legacy `/batch/` or Capture V1. */
export const anyCaptureUrl = expect.stringMatching(/^https?:\/\/[^/]+(\/batch\/|\/i\/v1\/analytics\/events)$/)

/** A capture 2xx response. The legacy sender ignores the body; the Capture V1 sender reads `results`. */
export function v1Response(results: Record<string, unknown> = {}): any {
  const body = JSON.stringify({ results })
  return {
    status: 200,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve({ results }),
    headers: { get: () => null },
    body: null,
  }
}

type FetchMock = { mock: { calls: any[][] } }
type FetchCall = [string, any]

/** Capture V1 per-event `options`, keyed by the legacy property each one replaces. */
const V1_OPTION_PROPERTIES: Record<string, string> = {
  cookieless_mode: '$cookieless_mode',
  disable_skew_correction: '$ignore_sent_at',
  process_person_profile: '$process_person_profile',
  product_tour_id: '$product_tour_id',
}

function legacyPropertiesOf(v1Event: any, sdkInfo: string): Record<string, any> {
  const versionAt = sdkInfo.lastIndexOf('/')
  const properties: Record<string, any> = {
    ...v1Event.properties,
    $lib: sdkInfo.slice(0, versionAt),
    $lib_version: sdkInfo.slice(versionAt + 1),
  }
  for (const [option, value] of Object.entries(v1Event.options ?? {})) {
    properties[V1_OPTION_PROPERTIES[option] ?? option] = value
  }
  if (v1Event.session_id !== undefined) {
    properties.$session_id = v1Event.session_id
  }
  if (v1Event.window_id !== undefined) {
    properties.$window_id = v1Event.window_id
  }
  return properties
}

/**
 * The events of one analytics capture request, in the legacy `/batch/` event shape whichever wire
 * format carried them. A Capture V1 event's `options`, `session_id`, `window_id` and SDK info
 * header go back into the properties they replace, so one assertion holds for both formats.
 */
export function sentEventsOf([url, options]: FetchCall): any[] {
  const { batch } = JSON.parse(options.body)
  if (new URL(url).pathname !== V1_ANALYTICS_CAPTURE_PATH) {
    return batch
  }
  return batch.map((v1Event: any) => {
    const event = { ...v1Event, properties: legacyPropertiesOf(v1Event, options.headers['PostHog-Sdk-Info']) }
    delete event.options
    delete event.session_id
    delete event.window_id
    return event
  })
}

/** Analytics capture requests of either wire format, as `[url, options]` tuples in call order. */
export const captureRequests = (fetchMock: FetchMock): FetchCall[] =>
  fetchMock.mock.calls.filter((call) => isAnalyticsCaptureUrl(call[0])) as FetchCall[]

/** Every event sent to the analytics capture endpoint, in the shape {@link sentEventsOf} returns. */
export const sentEvents = (fetchMock: FetchMock): any[] => captureRequests(fetchMock).flatMap(sentEventsOf)

/** The events of the most recent analytics capture request, or `undefined` if none was sent. */
export const lastSentBatch = (fetchMock: FetchMock): any[] | undefined => {
  const requests = captureRequests(fetchMock)
  return requests.length ? sentEventsOf(requests[requests.length - 1]) : undefined
}

type ErrorResponse = {
  status: number
  json: () => Promise<any>
}

export const apiImplementationV4 = (flagsResponse: PostHogV2FlagsResponse | ErrorResponse) => {
  return (url: any): Promise<any> => {
    if ((url as any).includes('/flags/?v=2')) {
      // Check if the response is a flags response or an error response
      return 'flags' in flagsResponse
        ? Promise.resolve({
            status: 200,
            text: () => Promise.resolve('ok'),
            json: () => Promise.resolve(flagsResponse),
          })
        : Promise.resolve({
            status: flagsResponse.status,
            text: () => Promise.resolve('not-ok'),
            json: flagsResponse.json,
          })
    }

    if (isAnalyticsCaptureUrl(url)) {
      return Promise.resolve(v1Response())
    }

    return Promise.resolve({
      status: 400,
      text: () => Promise.resolve('ok'),
      json: () =>
        Promise.resolve({
          status: 'ok',
        }),
    }) as any
  }
}

/**
 * Creates a mock headers object for testing
 */
export const createMockHeaders = (headers: Record<string, string> = {}) => ({
  get: (name: string) => headers[name] ?? null,
})

export const apiImplementation = ({
  localFlags,
  decideFlags: flags,
  flagsPayloads,
  flagsStatus = 200,
  localFlagsStatus = 200,
  errorsWhileComputingFlags = false,
  localFlagsEtag,
}: {
  localFlags?: any
  decideFlags?: any
  flagsPayloads?: any
  flagsStatus?: number
  localFlagsStatus?: number
  errorsWhileComputingFlags?: boolean
  localFlagsEtag?: string
}) => {
  return (url: any): Promise<any> => {
    if ((url as any).includes('/flags/?')) {
      return Promise.resolve({
        status: flagsStatus,
        text: () => Promise.resolve('ok'),
        json: () => {
          if (flagsStatus !== 200) {
            return Promise.resolve(flags)
          } else {
            return Promise.resolve({
              featureFlags: flags,
              featureFlagPayloads: Object.fromEntries(
                Object.entries(flagsPayloads || {}).map(([k, v]) => [k, JSON.stringify(v)])
              ),
              errorsWhileComputingFlags,
            })
          }
        },
      }) as any
    }

    if ((url as any).includes('flags/definitions?token=TEST_API_KEY&send_cohorts')) {
      const headers = localFlagsEtag ? createMockHeaders({ ETag: localFlagsEtag }) : createMockHeaders()
      return Promise.resolve({
        status: localFlagsStatus,
        text: () => Promise.resolve('ok'),
        json: () => Promise.resolve(localFlags),
        headers,
      }) as any
    }

    if (isAnalyticsCaptureUrl(url)) {
      return Promise.resolve(v1Response())
    }

    return Promise.resolve({
      status: 400,
      text: () => Promise.resolve('ok'),
      json: () =>
        Promise.resolve({
          status: 'ok',
        }),
    }) as any
  }
}

export const anyLocalEvalCall = [
  'http://example.com/flags/definitions?token=TEST_API_KEY&send_cohorts',
  expect.any(Object),
]
export const anyFlagsCall = ['http://example.com/flags/?v=2', expect.any(Object)]

export const isPending = (promise: Promise<any>): boolean => {
  return util.inspect(promise).includes('pending')
}

export const waitForPromises = async (): Promise<void> => {
  await new Promise((resolve) => {
    // IMPORTANT: Only enable real timers for this promise - allows us to pass a short amount of ticks
    // whilst keeping any timers made during other promises as fake timers
    vi.useRealTimers()
    setTimeout(resolve, 10)
    vi.useFakeTimers()
  })
}

export const wait = async (t: number): Promise<void> => {
  await new Promise((r) => setTimeout(r, t))
}
