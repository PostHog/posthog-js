import { Linking, AppState } from 'react-native'
import { PostHog } from '../src'

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()

describe('fatal exception persistence', () => {
  let posthog: PostHog
  let previous: ReturnType<typeof vi.fn>
  let handler: (error: Error, isFatal: boolean) => void
  let holdWrites: boolean
  let pending: Array<() => void>
  let stored: Map<string, string>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      })
    )
    previous = vi.fn()
    handler = previous
    vi.stubGlobal('ErrorUtils', {
      getGlobalHandler: () => handler,
      setGlobalHandler: (next: typeof handler) => {
        handler = next
      },
    })
    holdWrites = false
    pending = []
    stored = new Map()
  })

  afterEach(async () => {
    holdWrites = false
    pending.splice(0).forEach((finish) => finish())
    await posthog?.shutdown().catch(() => {})
    vi.clearAllTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function createClient(preload?: Promise<string | null>): PostHog {
    return new PostHog('test-token', {
      customStorage: {
        getItem: () => preload ?? null,
        setItem: (key, value) => {
          const write = () => {
            stored.set(key, value)
          }
          if (holdWrites) {
            return new Promise<void>((resolve) =>
              pending.push(() => {
                write()
                resolve()
              })
            )
          }
          write()
        },
      },
      flushInterval: 0,
      flushAt: 100,
      fetchRetryCount: 0,
      remoteConfig: false,
      preloadFeatureFlags: false,
      captureAppLifecycleEvents: false,
      errorTracking: { autocapture: { uncaughtExceptions: true } },
    })
  }

  it('waits for the queued fatal event even when the API flush has already failed', async () => {
    posthog = createClient()
    await posthog.ready()
    await (posthog as any)._eventsStorage.waitForPersist()
    holdWrites = true

    handler(new Error('fatal-persist-me'), true)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalled()
    expect(previous).not.toHaveBeenCalled()
    expect(stored.get('.posthog-rn.json')).not.toContain('fatal-persist-me')

    pending.splice(0).forEach((finish) => finish())
    await vi.advanceTimersByTimeAsync(0)
    expect(stored.get('.posthog-rn.json')).toContain('fatal-persist-me')
    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('waits for initialization to enqueue an early fatal exception before draining storage', async () => {
    let load!: (value: string | null) => void
    posthog = createClient(
      new Promise((resolve) => {
        load = resolve
      })
    )
    holdWrites = true
    handler(new Error('fatal-during-preload'), true)
    await vi.advanceTimersByTimeAsync(0)
    expect(previous).not.toHaveBeenCalled()
    load(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(previous).not.toHaveBeenCalled()
    expect(pending.length).toBeGreaterThan(0)

    pending.splice(0).forEach((finish) => finish())
    await vi.advanceTimersByTimeAsync(0)
    expect(stored.get('.posthog-rn.json')).toContain('fatal-during-preload')
    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('still invokes the native handler when initialization exceeds the deadline', async () => {
    let load!: (value: string | null) => void
    posthog = createClient(
      new Promise((resolve) => {
        load = resolve
      })
    )
    handler(new Error('fatal-stuck-preload'), true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(previous).toHaveBeenCalledTimes(1)
    load(null)
    await vi.advanceTimersByTimeAsync(100)
    expect(previous).toHaveBeenCalledTimes(1)
  })
})
