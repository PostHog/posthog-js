import { JsonType, PostHogEventProperties, PostHogPersistedProperty } from '@/types'
import { type SendBatchOutcome } from '@/posthog-core-stateless'
import { PostHogCoreTestClient, PostHogCoreTestClientMocks } from '@/testing'

class TimedOutClient extends PostHogCoreTestClient {
  public sentBatches: string[][] = []
  public outcome: (batch: (PostHogEventProperties | undefined)[]) => void | SendBatchOutcome = () => undefined

  protected async sendBatch(batch: (PostHogEventProperties | undefined)[]): Promise<void | SendBatchOutcome> {
    this.sentBatches.push(batch.map((message) => String(message?.event)))
    return this.outcome(batch)
  }
}

const createClient = (): [TimedOutClient, PostHogCoreTestClientMocks] => {
  const storageCache: { [key: string]: string | JsonType } = {}
  const mocks: PostHogCoreTestClientMocks = {
    fetch: vi.fn(),
    storage: {
      getItem: vi.fn((key) => storageCache[key]),
      setItem: vi.fn((key, val) => {
        storageCache[key] = val == null ? undefined : val
      }),
    },
  }
  const client = new TimedOutClient(mocks, 'TEST_API_KEY', {
    flushAt: 20,
    flushInterval: 0,
    fetchRetryCount: 0,
    disableCompression: true,
  })
  return [client, mocks]
}

const queuedEvents = (client: TimedOutClient): string[] =>
  (client.getPersistedProperty<any[]>(PostHogPersistedProperty.Queue) || []).map((item) => item?.message?.event)

describe('PostHog Core sendBatch timedOut outcome', () => {
  it('halves the next batch after a send that timed out, and keeps its events', async () => {
    const [client] = createClient()
    client.outcome = (batch) =>
      batch.length > 1 ? { keepIndices: batch.map((_, index) => index), timedOut: true } : undefined
    client.capture('first')
    client.capture('second')

    await client.flush()
    expect(client.sentBatches).toEqual([['first', 'second']])
    expect(queuedEvents(client)).toEqual(['first', 'second'])

    await client.flush()
    expect(client.sentBatches).toEqual([['first', 'second'], ['first'], ['second']])
    expect(queuedEvents(client)).toEqual([])
  })
})
