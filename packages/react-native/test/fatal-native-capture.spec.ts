import { Linking, AppState } from 'react-native'
import { PostHog } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()

vi.mock('../src/optional/OptionalPlugin', () => ({
  OptionalReactNativePluginVersion: undefined,
  OptionalReactNativePlugin: {
    start: vi.fn(() => Promise.resolve()),
    setup: vi.fn(() => Promise.resolve()),
    startSession: vi.fn(() => Promise.resolve()),
    endSession: vi.fn(() => Promise.resolve()),
    isEnabled: vi.fn(() => Promise.resolve(false)),
    identify: vi.fn(() => Promise.resolve()),
    startRecording: vi.fn(() => Promise.resolve()),
    stopRecording: vi.fn(() => Promise.resolve()),
    addExceptionStep: vi.fn(() => Promise.resolve()),
    setOptOut: vi.fn(() => Promise.resolve()),
    captureFatalException: vi.fn(() => Promise.resolve()),
  },
}))

const mockPlugin = OptionalReactNativePlugin as unknown as {
  setup: vi.Mock
  captureFatalException: vi.Mock
}

const TEST_API_KEY = 'test-token'

// The JS queue is drained by the flush() the fatal path kicks off, so reading persisted
// storage cannot tell "never enqueued" from "enqueued and already sent". The `capture` event
// fires from enqueue() only for events that actually entered the queue, which is the signal
// these tests need.
const observeEnqueuedExceptions = (client: PostHog): any[] => {
  const seen: any[] = []
  client.on('capture', (message: any) => {
    if (message?.event === '$exception') {
      seen.push(message)
    }
  })
  return seen
}

const resetMockPlugin = (): void => {
  mockPlugin.captureFatalException = vi.fn(() => Promise.resolve())
}

describe('fatal JavaScript exceptions captured through the native SDK', () => {
  let posthog: PostHog
  let previous: ReturnType<typeof vi.fn>
  let handler: (error: Error, isFatal: boolean) => void
  let stored: Map<string, string>

  const clientOptions = (overrides: Record<string, unknown> = {}): any => ({
    customStorage: {
      getItem: () => null,
      setItem: (key: string, value: string) => {
        stored.set(key, value)
      },
    },
    flushInterval: 0,
    flushAt: 100,
    fetchRetryCount: 0,
    remoteConfig: false,
    preloadFeatureFlags: false,
    captureAppLifecycleEvents: false,
    capturePushNotificationSubscriptions: false,
    capturePushNotificationOpened: false,
    errorTracking: { autocapture: { uncaughtExceptions: true } },
    ...overrides,
  })

  const createClient = (overrides: Record<string, unknown> = {}): PostHog =>
    new PostHog(TEST_API_KEY, clientOptions(overrides))

  // Native setup is kicked off fire-and-forget after the storage preload, so let it settle:
  // a real app is almost always past init by the time it crashes, and the fatal path only
  // hands an exception to native once the native SDK is actually up.
  const readyClient = async (overrides: Record<string, unknown> = {}): Promise<PostHog> => {
    const client = createClient(overrides)
    await client.ready()
    await (client as any)._sessionReplayEvalChain?.catch(() => {})
    await (client as any)._eventsStorage.waitForPersist()
    return client
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 200, json: () => Promise.resolve({}) }))
    )
    previous = vi.fn()
    handler = previous
    vi.stubGlobal('ErrorUtils', {
      getGlobalHandler: () => handler,
      setGlobalHandler: (next: typeof handler) => {
        handler = next
      },
    })
    stored = new Map()
    resetMockPlugin()
  })

  afterEach(async () => {
    await posthog?.shutdown().catch(() => {})
    vi.clearAllTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('hands the final exception to native and waits for it before forwarding the handler', async () => {
    posthog = await readyClient()

    let resolveBridge!: () => void
    mockPlugin.captureFatalException.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveBridge = () => resolve()
        })
    )

    handler(new Error('capture-me'), true)
    await vi.advanceTimersByTimeAsync(100)

    expect(previous).not.toHaveBeenCalled()
    expect(mockPlugin.captureFatalException).toHaveBeenCalledTimes(1)
    const [distinctId, timestamp, properties] = mockPlugin.captureFatalException.mock.calls[0]
    expect(typeof distinctId).toBe('string')
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(properties.$exception_list[0].value).toContain('capture-me')
    // Native keys its synchronous-persist path off this exact value.
    expect(properties.$exception_level).toBe('fatal')

    resolveBridge()
    await vi.advanceTimersByTimeAsync(0)
    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('drops the JS queue copy so the exception is not sent twice', async () => {
    posthog = await readyClient()
    const enqueued = observeEnqueuedExceptions(posthog)

    handler(new Error('exactly-once'), true)
    await vi.advanceTimersByTimeAsync(100)

    expect(mockPlugin.captureFatalException).toHaveBeenCalledTimes(1)
    // Native owns delivery. A JS queue copy would be sent again on the relaunch flush,
    // producing two exception events for one crash.
    expect(enqueued).toHaveLength(0)
  })

  it('keeps the exception in the JS queue when the plugin has no native capture', async () => {
    mockPlugin.captureFatalException = undefined as any
    posthog = await readyClient()
    const enqueued = observeEnqueuedExceptions(posthog)

    handler(new Error('old-plugin-fatal'), true)
    await vi.advanceTimersByTimeAsync(0)

    expect(previous).toHaveBeenCalledTimes(1)
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0].properties.$exception_list[0].value).toContain('old-plugin-fatal')
  })

  it('keeps the exception in the JS queue when the native payload cannot be built', async () => {
    posthog = await readyClient()
    const enqueued = observeEnqueuedExceptions(posthog)
    // A payload that fails to build must not leave the exception dropped from both queues.
    const errorTracking = (posthog as any)._errorTracking
    errorTracking.prepareFatalNativeCapture = () => {
      throw new Error('payload too large')
    }

    handler(new Error('fallback-to-js'), true)
    await vi.advanceTimersByTimeAsync(100)

    expect(mockPlugin.captureFatalException).not.toHaveBeenCalled()
    expect(enqueued).toHaveLength(1)
    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('keeps the exception in the JS queue when the native SDK is not set up yet', async () => {
    // Native init is async and lands after the storage preload, so an early-startup crash
    // can beat it. Native would no-op the capture, so the JS copy must not be given up.
    posthog = await readyClient()
    const enqueued = observeEnqueuedExceptions(posthog)
    ;(posthog as any)._sessionReplayNativeInitialized = false
    ;(posthog as any)._nativeErrorTrackingInitialized = false
    ;(posthog as any)._pushNativeInitialized = false
    ;(posthog as any)._fatalJsCaptureNativeInitialized = false

    handler(new Error('native-not-ready'), true)
    await vi.advanceTimersByTimeAsync(100)

    expect(mockPlugin.captureFatalException).not.toHaveBeenCalled()
    expect(enqueued).toHaveLength(1)
    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('forwards the previous handler after the 2s deadline even if the bridge hangs', async () => {
    posthog = await readyClient()
    mockPlugin.captureFatalException.mockImplementation(() => new Promise<void>(() => {}))

    handler(new Error('hangs'), true)
    await vi.advanceTimersByTimeAsync(1999)
    expect(previous).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('still forwards the handler when the native capture rejects', async () => {
    posthog = await readyClient()
    mockPlugin.captureFatalException.mockRejectedValue(new Error('native unavailable'))

    handler(new Error('native-rejects'), true)
    await vi.advanceTimersByTimeAsync(100)

    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('sends the before_send-filtered payload and the identity it was captured with', async () => {
    posthog = await readyClient({
      before_send: (event: any) => {
        if (event?.event !== '$exception') return event
        return {
          ...event,
          properties: { ...event.properties, redacted: true, $exception_steps: undefined },
        }
      },
    })
    posthog.identify('user-42')
    await (posthog as any)._eventsStorage.waitForPersist()

    handler(new Error('filtered'), true)
    await vi.advanceTimersByTimeAsync(100)

    const [distinctId, , properties] = mockPlugin.captureFatalException.mock.calls[0]
    expect(distinctId).toBe('user-42')
    expect(properties.redacted).toBe(true)
  })

  it('does not capture an exception before_send rejected', async () => {
    posthog = await readyClient({ before_send: () => null })

    handler(new Error('rejected'), true)
    await vi.advanceTimersByTimeAsync(100)

    expect(mockPlugin.captureFatalException).not.toHaveBeenCalled()
    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('does not capture while opted out', async () => {
    posthog = await readyClient()
    await posthog.optOut()
    mockPlugin.captureFatalException.mockClear()

    handler(new Error('opted-out-fatal'), true)
    await vi.advanceTimersByTimeAsync(100)

    expect(mockPlugin.captureFatalException).not.toHaveBeenCalled()
    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('does not capture when the client is disabled', async () => {
    posthog = await readyClient({ disabled: true })

    handler(new Error('disabled-fatal'), true)
    await vi.advanceTimersByTimeAsync(100)

    expect(mockPlugin.captureFatalException).not.toHaveBeenCalled()
    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('leaves non-fatal exceptions on the JS queue', async () => {
    posthog = await readyClient()

    const enqueued = observeEnqueuedExceptions(posthog)

    posthog.captureException(new Error('non-fatal'))
    await vi.advanceTimersByTimeAsync(100)

    expect(mockPlugin.captureFatalException).not.toHaveBeenCalled()
    expect(enqueued).toHaveLength(1)
  })

  it('keeps memory-persistence apps off the native disk queue', async () => {
    posthog = await readyClient({ persistence: 'memory' })

    handler(new Error('memory-mode-fatal'), true)
    await vi.advanceTimersByTimeAsync(100)

    // The native queue is disk-backed; routing there would land data the rest of the SDK
    // promises never to touch disk.
    expect(mockPlugin.captureFatalException).not.toHaveBeenCalled()
    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('does not capture an unfiltered fallback when exception capture throws', async () => {
    posthog = await readyClient()
    const original = (posthog as any).captureExceptionInternal
    ;(posthog as any).captureExceptionInternal = () => {
      throw new Error('capture exploded')
    }

    handler(new Error('capture-throws'), true)
    await vi.advanceTimersByTimeAsync(0)

    expect(mockPlugin.captureFatalException).not.toHaveBeenCalled()
    expect(previous).toHaveBeenCalledTimes(1)
    ;(posthog as any).captureExceptionInternal = original
  })

  it('waits for the storage preload before reading opt-out at crash time', async () => {
    // While the preload is pending the in-memory opt-out is the default, so a previously
    // opted-out user must not have their crash captured on the strength of that default.
    let resolvePreload!: () => void
    const pendingPreload = new Promise<void>((resolve) => {
      resolvePreload = resolve
    })
    posthog = new PostHog(TEST_API_KEY, {
      ...clientOptions(),
      customStorage: {
        getItem: (key: string) =>
          key === '.posthog-rn.json'
            ? (pendingPreload.then(() => JSON.stringify({ version: 'v1', content: { opted_out: true } })) as any)
            : (null as any),
        setItem: (key: string, value: string) => {
          stored.set(key, value)
        },
      },
    } as any)

    const readyPromise = posthog.ready()
    handler(new Error('slow-preload-fatal'), true)
    await vi.advanceTimersByTimeAsync(0)
    expect(mockPlugin.captureFatalException).not.toHaveBeenCalled()

    resolvePreload()
    await readyPromise
  })

  it('initializes the native SDK for an app that only enabled JS uncaught-exception capture', async () => {
    // Without native setup there is no native queue to capture into, so JS-only error
    // tracking has to be reason enough to initialize it.
    posthog = await readyClient()
    await vi.advanceTimersByTimeAsync(100)
    expect(mockPlugin.setup).toHaveBeenCalled()
  })

  it('initializes the native SDK for the shorthand `autocapture: true` form', async () => {
    // The gate resolves through ErrorTracking rather than re-reading raw options, so the
    // boolean shorthand has to reach it too.
    posthog = await readyClient({ errorTracking: { autocapture: true } })
    await vi.advanceTimersByTimeAsync(100)

    expect(mockPlugin.setup).toHaveBeenCalled()
  })

  it('does not initialize the native SDK for an app with no error tracking at all', async () => {
    posthog = await readyClient({
      errorTracking: { autocapture: { uncaughtExceptions: false } },
      capturePushNotificationSubscriptions: false,
      capturePushNotificationOpened: false,
    })
    await vi.advanceTimersByTimeAsync(100)

    expect(mockPlugin.setup).not.toHaveBeenCalled()
  })
})
