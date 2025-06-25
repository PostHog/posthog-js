import { PostHog } from '../../src/entrypoints/index.node'
import { PostHogSentryIntegration } from '../../src/extensions/sentry-integration'
import { waitForPromises } from 'posthog-core/test/test-utils/test-utils'

jest.mock('../../package.json', () => ({ version: '1.2.3' }))

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

const getLastBatchEvents = (): any[] | undefined => {
  expect(mockedFetch).toHaveBeenCalledWith('http://example.com/batch/', expect.objectContaining({ method: 'POST' }))

  // reverse mock calls array to get the last call
  const call = mockedFetch.mock.calls.reverse().find((x) => (x[0] as string).includes('/batch/'))
  if (!call) {
    return undefined
  }
  return JSON.parse((call[1] as any).body as any).batch
}

const createMockSentryException = (): any => ({
  exception: {
    values: [
      {
        type: 'Error',
        value: 'example error',
        stacktrace: {
          frames: [],
        },
        mechanism: { type: 'generic', handled: true },
      },
    ],
  },
  event_id: '80a7023ac32c47f7acb0adaed600d149',
  platform: 'node',
  contexts: {},
  server_name: 'localhost',
  timestamp: 1704203482.356,
  environment: 'production',
  level: 'error',
  tags: { posthog_distinct_id: 'EXAMPLE_APP_GLOBAL' },
  breadcrumbs: [
    {
      timestamp: 1704203481.422,
      category: 'console',
      level: 'log',
      message: '⚡: Server is running at http://localhost:8010',
    },
    {
      timestamp: 1704203481.658,
      category: 'console',
      level: 'log',
      message:
        "PostHog Debug error [ClientError: Your personalApiKey is invalid. Are you sure you're not using your Project API key? More information: https://posthog.com/docs/api/overview]",
    },
  ],
  sdkProcessingMetadata: {
    propagationContext: { traceId: 'ea26146e5a354cb0b3b1daebb3f90e33', spanId: '8d642089c3daa272' },
  },
})

describe('PostHogSentryIntegration', () => {
  let posthog: PostHog
  let posthogSentry: PostHogSentryIntegration

  jest.useFakeTimers()

  beforeEach(() => {
    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      fetchRetryCount: 0,
      disableCompression: true,
    })

    posthogSentry = new PostHogSentryIntegration(posthog)

    mockedFetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('ok'),
      json: () =>
        Promise.resolve({
          status: 'ok',
        }),
    } as any)
  })

  afterEach(async () => {
    // ensure clean shutdown & no test interdependencies
    await posthog.shutdown()
  })

  it('should forward sentry exceptions to posthog', async () => {
    expect(mockedFetch).toHaveBeenCalledTimes(0)

    const mockSentry = {
      getClient: () => ({
        getDsn: () => ({
          projectId: 123,
        }),
      }),
    }

    let processorFunction: any

    posthogSentry.setupOnce(
      (fn) => (processorFunction = fn),
      () => mockSentry
    )

    processorFunction(createMockSentryException())

    await waitForPromises() // First flush
    jest.runOnlyPendingTimers() // Flush timer
    await waitForPromises() // Second flush
    const batchEvents = getLastBatchEvents()

    expect(batchEvents).toEqual([
      {
        distinct_id: 'EXAMPLE_APP_GLOBAL',
        event: '$exception',
        properties: {
          $exception_level: 'error',
          $exception_list: [
            {
              mechanism: { handled: true, type: 'generic' },
              stacktrace: { frames: [], type: 'raw' },
              type: 'Error',
              value: 'example error',
            },
          ],
          $exception_message: 'example error',
          $exception_type: 'Error',
          $exception_personURL: 'http://example.com/project/TEST_API_KEY/person/EXAMPLE_APP_GLOBAL',
          $sentry_event_id: '80a7023ac32c47f7acb0adaed600d149',
          $sentry_exception: {
            values: [
              {
                type: 'Error',
                value: 'example error',
                stacktrace: { frames: [] },
                mechanism: { type: 'generic', handled: true },
              },
            ],
          },
          $sentry_exception_message: 'example error',
          $sentry_exception_type: 'Error',
          $sentry_tags: {
            posthog_distinct_id: 'EXAMPLE_APP_GLOBAL',
            'PostHog Person URL': 'http://example.com/project/TEST_API_KEY/person/EXAMPLE_APP_GLOBAL',
          },
          $lib: 'posthog-node',
          $lib_version: '1.2.3',
          $geoip_disable: true,
        },
        type: 'capture',
        library: 'posthog-node',
        library_version: '1.2.3',
        timestamp: expect.any(String),
        uuid: expect.any(String),
      },
    ])
  })
})
