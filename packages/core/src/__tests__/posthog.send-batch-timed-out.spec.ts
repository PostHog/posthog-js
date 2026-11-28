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

  it('doubles the batch size back after a timeout once batches are delivered again', async () => {
    const [client] = createClient()
    let slow = true
    client.outcome = (batch) =>
      slow && batch.length > 1 ? { keepIndices: batch.map((_, index) => index), timedOut: true } : undefined
    for (let index = 0; index < 4; index++) {
      client.capture(`a${index}`)
    }
    await client.flush()
    slow = false
    await client.flush()
    for (let index = 0; index < 8; index++) {
      client.capture(`b${index}`)
    }
    await client.flush()

    expect(client.sentBatches.map((batch) => batch.length)).toEqual([4, 2, 2, 8])
  })

  it('keeps a 413 batch size after a timeout lowered it', async () => {
    const [client] = createClient()
    let slow = true
    client.outcome = (batch) => {
      const keepIndices = batch.map((_, index) => index)
      if (slow && batch.length > 1) {
        slow = false
        return { keepIndices, timedOut: true }
      }
      return batch.length > 2 ? { keepIndices, tooLarge: true } : undefined
    }
    for (let index = 0; index < 8; index++) {
      client.capture(`e${index}`)
    }
    await client.flush()
    await client.flush()

    expect(client.sentBatches.map((batch) => batch.length)).toEqual([8, 4, 2, 2, 2, 2])
  })

  it('restores the batch size a 413 set, not the configured one, after a timeout', async () => {
    const [client] = createClient()
    let timeouts = 1
    client.outcome = (batch) => {
      const keepIndices = batch.map((_, index) => index)
      if (batch.length > 4) {
        return { keepIndices, tooLarge: true }
      }
      if (timeouts > 0 && batch.length > 1) {
        timeouts--
        return { keepIndices, timedOut: true }
      }
      return undefined
    }
    for (let index = 0; index < 8; index++) {
      client.capture(`a${index}`)
    }
    await client.flush()
    await client.flush()
    for (let index = 0; index < 8; index++) {
      client.capture(`b${index}`)
    }
    await client.flush()

    expect(client.sentBatches.map((batch) => batch.length)).toEqual([8, 4, 2, 4, 2, 4, 4])
  })
})
