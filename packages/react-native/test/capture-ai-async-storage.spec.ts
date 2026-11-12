const { asyncStorage } = vi.hoisted(() => {
  const items = new Map<string, string>()
  return {
    asyncStorage: {
      getItem: vi.fn(async (key: string) => items.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        items.set(key, value)
      }),
    },
  }
})

vi.mock('../src/optional/OptionalExpoFileSystem', () => ({ OptionalExpoFileSystem: undefined }))
vi.mock('../src/optional/OptionalExpoFileSystemLegacy', () => ({ OptionalExpoFileSystemLegacy: undefined }))
vi.mock('../src/optional/OptionalAsyncStorage', () => ({ OptionalAsyncStorage: asyncStorage }))

import { PostHog } from '../src'

describe('captureAi with AsyncStorage', () => {
  const originalFetch = (globalThis as any).window.fetch

  beforeAll(() => {
    vi.useRealTimers()
  })

  afterAll(() => {
    ;(globalThis as any).window.fetch = originalFetch
    vi.useFakeTimers()
  })

  it('keeps the AI queue out of AsyncStorage, whose Android rows and database are size-limited', async () => {
    ;(globalThis as any).window.fetch = vi.fn(async () => ({
      status: 503,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '{}',
    }))
    const posthog = new PostHog('test-token', {
      flushInterval: 0,
      preloadFeatureFlags: false,
      captureAppLifecycleEvents: false,
      captureAiCompression: 'none',
    })
    await posthog.ready()

    posthog.captureAi('$ai_generation', { $ai_input: 'x'.repeat(1024) })
    await posthog.flush()
    await posthog.shutdown()

    expect(asyncStorage.setItem).toHaveBeenCalled()
    expect(asyncStorage.setItem.mock.calls.map(([key]) => key)).not.toContain('.posthog-rn-ai.json')
  })
})
