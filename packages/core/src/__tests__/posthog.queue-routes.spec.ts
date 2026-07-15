import {
  JsonType,
  PostHogCoreOptions,
  PostHogEventProperties,
  PostHogFetchOptions,
  PostHogPersistedProperty,
} from '@/types'
import { PostHogCoreTestClient, PostHogCoreTestClientMocks } from '@/testing'

// A client that segregates `$ai_*` events onto a second queue route, mirroring how
// posthog-node keeps AI events on the legacy transport. Exercises the core route seam
// (getQueueRouteKey / persistedQueueKeyForRoute / getActiveQueueRoutes) generically.
class RoutedTestClient extends PostHogCoreTestClient {
  public sendBatchCalls: { route: string; events: (string | undefined)[] }[] = []

  protected getQueueRouteKey(message: PostHogEventProperties): string {
    return typeof message.event === 'string' && message.event.startsWith('$ai_') ? 'ai' : 'default'
  }

  protected persistedQueueKeyForRoute(route: string): PostHogPersistedProperty {
    return route === 'ai' ? PostHogPersistedProperty.AiQueue : PostHogPersistedProperty.Queue
  }

  protected getActiveQueueRoutes(): string[] {
    return ['default', 'ai']
  }

  protected async sendBatch(
    batch: (PostHogEventProperties | undefined)[],
    retryOptions?: any,
    route?: string
  ): Promise<void> {
    this.sendBatchCalls.push({ route: route ?? 'default', events: batch.map((m) => m?.event as string | undefined) })
    return super.sendBatch(batch, retryOptions, route)
  }
}

const createRoutedClient = (options?: PostHogCoreOptions): [RoutedTestClient, PostHogCoreTestClientMocks] => {
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

  const client = new RoutedTestClient(mocks, 'TEST_API_KEY', {
    flushAt: 100,
    flushInterval: 0,
    fetchRetryCount: 0,
    disableCompression: true,
    ...options,
  })
  return [client, mocks]
}

const queueEvents = (client: RoutedTestClient, key: PostHogPersistedProperty): (string | undefined)[] =>
  (client.getPersistedProperty<any[]>(key) || []).map((item) => item?.message?.event)

describe('PostHog Core queue routes', () => {
  beforeEach(() => {
    jest.setSystemTime(new Date('2022-01-01'))
  })

  it('routes each event to its route queue at enqueue time', () => {
    const [posthog] = createRoutedClient()

    posthog.capture('normal_1', { foo: 'bar' })
    posthog.capture('$ai_generation', { foo: 'bar' })
    posthog.capture('normal_2', { foo: 'bar' })

    expect(queueEvents(posthog, PostHogPersistedProperty.Queue)).toEqual(['normal_1', 'normal_2'])
    expect(queueEvents(posthog, PostHogPersistedProperty.AiQueue)).toEqual(['$ai_generation'])
  })

  it('flushes each route as a homogeneous batch tagged with its route', async () => {
    const [posthog, mocks] = createRoutedClient()

    posthog.capture('normal_1', {})
    posthog.capture('$ai_generation', {})
    posthog.capture('normal_2', {})

    await posthog.flush()

    // One send per non-empty route, each batch homogeneous.
    expect(posthog.sendBatchCalls).toEqual([
      { route: 'default', events: ['normal_1', 'normal_2'] },
      { route: 'ai', events: ['$ai_generation'] },
    ])
    expect(mocks.fetch).toHaveBeenCalledTimes(2)

    // Both queues fully drained.
    expect(queueEvents(posthog, PostHogPersistedProperty.Queue)).toEqual([])
    expect(queueEvents(posthog, PostHogPersistedProperty.AiQueue)).toEqual([])
  })

  it('isolates a failing route: the healthy route drains once and is never re-sent', async () => {
    const [posthog, mocks] = createRoutedClient()

    // Fail only the batch that carries the AI event (simulated network error).
    mocks.fetch.mockImplementation((_url: string, options: PostHogFetchOptions) => {
      const body = typeof options.body === 'string' ? options.body : ''
      if (body.includes('$ai_')) {
        return Promise.reject(new Error('network down'))
      }
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve('ok'),
        json: () => Promise.resolve({ status: 'ok' }),
      })
    })

    posthog.capture('normal_1', {})
    posthog.capture('$ai_generation', {})

    await expect(posthog.flush()).rejects.toBeDefined()

    // Healthy default route advanced to empty; failing AI route retained for a later cycle.
    expect(queueEvents(posthog, PostHogPersistedProperty.Queue)).toEqual([])
    expect(queueEvents(posthog, PostHogPersistedProperty.AiQueue)).toEqual(['$ai_generation'])

    // The healthy batch was submitted exactly once (no duplicate delivery from the AI failure).
    const defaultSends = posthog.sendBatchCalls.filter((c) => c.route === 'default')
    expect(defaultSends).toEqual([{ route: 'default', events: ['normal_1'] }])
  })
})
