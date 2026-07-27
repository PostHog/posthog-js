import { JsonType, PostHogCoreOptions, PostHogEventProperties, PostHogPersistedProperty } from '@/types'
import { PostHogCoreTestClient, PostHogCoreTestClientMocks } from '@/testing'

// Exercises the caller-chosen route override on enqueue/sendImmediate: an explicit route
// must win over content-based getQueueRouteKey routing, and omitting it must be identical
// to before the parameter existed.
class ExplicitRouteTestClient extends PostHogCoreTestClient {
  public sendBatchCalls: { route: string; events: (string | undefined)[] }[] = []

  protected getQueueRouteKey(_message: PostHogEventProperties): string {
    return 'content-based'
  }

  protected persistedQueueKeyForRoute(route: string): PostHogPersistedProperty {
    return route === 'explicit' ? PostHogPersistedProperty.AiCaptureQueue : PostHogPersistedProperty.Queue
  }

  protected getActiveQueueRoutes(): string[] {
    return ['content-based', 'explicit']
  }

  protected async sendBatch(
    batch: (PostHogEventProperties | undefined)[],
    retryOptions?: any,
    route?: string
  ): Promise<void> {
    this.sendBatchCalls.push({
      route: route ?? 'default',
      events: batch.map((m) => m?.event as string | undefined),
    })
    return super.sendBatch(batch, retryOptions, route)
  }

  public enqueueOnRoute(route: string | undefined, event: string): void {
    this.enqueue('capture', { event, distinct_id: 'test-user', properties: {} }, {}, route)
  }

  public sendImmediateOnRoute(route: string | undefined, event: string): Promise<void> {
    return this.sendImmediate('capture', { event, distinct_id: 'test-user', properties: {} }, {}, route)
  }
}

const createClient = (options?: PostHogCoreOptions): [ExplicitRouteTestClient, PostHogCoreTestClientMocks] => {
  const storageCache: { [key: string]: string | JsonType } = {}
  const mocks: PostHogCoreTestClientMocks = {
    fetch: jest.fn(),
    storage: {
      getItem: jest.fn((key) => storageCache[key]),
      setItem: jest.fn((key, val) => {
        storageCache[key] = val == null ? undefined : val
      }),
    },
  }
  mocks.fetch.mockImplementation(() =>
    Promise.resolve({
      status: 200,
      text: () => Promise.resolve('ok'),
      json: () => Promise.resolve({ status: 'ok' }),
    })
  )
  const client = new ExplicitRouteTestClient(mocks, 'TEST_API_KEY', {
    flushAt: 100,
    flushInterval: 0,
    fetchRetryCount: 0,
    disableCompression: true,
    ...options,
  })
  return [client, mocks]
}

const queueEvents = (client: ExplicitRouteTestClient, key: PostHogPersistedProperty): (string | undefined)[] =>
  (client.getPersistedProperty<any[]>(key) || []).map((item) => item?.message?.event)

describe('PostHog Core explicit queue route', () => {
  beforeEach(() => {
    jest.setSystemTime(new Date('2022-01-01'))
  })

  it('enqueues onto the explicit route, overriding getQueueRouteKey', () => {
    const [posthog] = createClient()

    posthog.enqueueOnRoute('explicit', 'lane_event')
    posthog.enqueueOnRoute(undefined, 'normal_event')

    expect(queueEvents(posthog, PostHogPersistedProperty.AiCaptureQueue)).toEqual(['lane_event'])
    expect(queueEvents(posthog, PostHogPersistedProperty.Queue)).toEqual(['normal_event'])
  })

  it('flushes the explicit route independently and tags sendBatch with it', async () => {
    const [posthog, mocks] = createClient()

    posthog.enqueueOnRoute('explicit', 'lane_event')
    posthog.enqueueOnRoute(undefined, 'normal_event')
    await posthog.flush()

    expect(posthog.sendBatchCalls).toEqual([
      { route: 'content-based', events: ['normal_event'] },
      { route: 'explicit', events: ['lane_event'] },
    ])
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(queueEvents(posthog, PostHogPersistedProperty.AiCaptureQueue)).toEqual([])
    expect(queueEvents(posthog, PostHogPersistedProperty.Queue)).toEqual([])
  })

  it('sendImmediate honors the explicit route', async () => {
    const [posthog] = createClient()

    await posthog.sendImmediateOnRoute('explicit', 'lane_event')
    await posthog.sendImmediateOnRoute(undefined, 'normal_event')

    expect(posthog.sendBatchCalls).toEqual([
      { route: 'explicit', events: ['lane_event'] },
      { route: 'content-based', events: ['normal_event'] },
    ])
  })

  it('sendBatch posts each route to its getBatchEndpointPath', async () => {
    class EndpointRoutedClient extends ExplicitRouteTestClient {
      protected getBatchEndpointPath(route: string): string {
        return route === 'explicit' ? '/i/v0/test-lane/' : super.getBatchEndpointPath(route)
      }
    }
    const storageCache: { [key: string]: string | JsonType } = {}
    const mocks: PostHogCoreTestClientMocks = {
      fetch: jest.fn(),
      storage: {
        getItem: jest.fn((key) => storageCache[key]),
        setItem: jest.fn((key, val) => {
          storageCache[key] = val == null ? undefined : val
        }),
      },
    }
    mocks.fetch.mockImplementation(() =>
      Promise.resolve({
        status: 200,
        text: () => Promise.resolve('ok'),
        json: () => Promise.resolve({ status: 'ok' }),
      })
    )
    const posthog = new EndpointRoutedClient(mocks, 'TEST_API_KEY', {
      flushAt: 100,
      flushInterval: 0,
      fetchRetryCount: 0,
      disableCompression: true,
    })

    posthog.enqueueOnRoute('explicit', 'lane_event')
    posthog.enqueueOnRoute(undefined, 'normal_event')
    await posthog.flush()

    const urls = mocks.fetch.mock.calls.map((call) => call[0])
    expect(urls.some((url) => url.endsWith('/batch/'))).toBe(true)
    expect(urls.some((url) => url.endsWith('/i/v0/test-lane/'))).toBe(true)

    const laneCall = mocks.fetch.mock.calls.find((call) => call[0].endsWith('/i/v0/test-lane/'))
    const body = JSON.parse(laneCall![1].body as string)
    expect(Object.keys(body).sort()).toEqual(['api_key', 'batch', 'sent_at'])
    expect(body.batch.map((event: any) => event.event)).toEqual(['lane_event'])
  })
})
