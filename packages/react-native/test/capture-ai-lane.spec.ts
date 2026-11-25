import { PostHogPersistedProperty } from '@posthog/core'
import { CAPTURE_AI_DEFAULT_MAX_EVENT_BYTES, CaptureAiLane } from '../src/capture-ai-lane'

describe('CaptureAiLane', () => {
  beforeAll(() => {
    vi.useRealTimers()
  })

  afterAll(() => {
    vi.useFakeTimers()
  })

  it('stores an AI event captured while storage loads before waitForPersist resolves', async () => {
    let loaded!: () => void
    const values: Record<string, unknown> = {}
    const storage = {
      preloadPromise: new Promise<void>((resolve) => (loaded = resolve)),
      getItem: (key: string) => values[key],
      setItem: (key: string, value: unknown) => {
        values[key] = value
      },
      removeItem: (key: string) => {
        delete values[key]
      },
      waitForPersist: async () => {},
    }
    const files: Record<string, string> = {}
    const eventFiles = {
      storage: {
        getItem: async (key: string) => files[key] ?? null,
        setItem: async (key: string, value: string) => {
          files[key] = value
        },
        removeItem: async (key: string) => {
          delete files[key]
        },
        keys: async () => Object.keys(files),
      },
      prefix: 'event-',
    }
    const lane = new CaptureAiLane(
      storage as any,
      eventFiles,
      {
        flushAt: 100,
        maxBatchSize: 100,
        flushIntervalMs: 0,
        maxQueueSize: 100,
        maxEventBytes: CAPTURE_AI_DEFAULT_MAX_EVENT_BYTES,
      },
      () => ({ send: async (batch: unknown[]) => batch }) as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), critical: vi.fn() } as any,
      () => {}
    )

    const uuid = lane.enqueue({
      event: '$ai_generation',
      distinct_id: 'user',
      uuid: '019a0000-0000-7000-8000-000000000000',
      timestamp: new Date().toISOString(),
      properties: {},
    })
    let persisted = false
    const wait = lane.waitForPersist().then(() => {
      persisted = true
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(persisted).toBe(false)

    loaded()
    await wait

    expect(values[PostHogPersistedProperty.AiQueue]).toEqual([expect.objectContaining({ uuid, file: 0 })])
    expect(JSON.parse(files['event-0']).uuid).toBe(uuid)
  })
})
