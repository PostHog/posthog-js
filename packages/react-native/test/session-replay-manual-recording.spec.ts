import { PostHog, PostHogCustomStorage } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { Linking, AppState } from 'react-native'
import { waitForExpect, wait } from './test-utils'

// Mock the native plugin bridge. No `setup` key, so the SDK takes the legacy start()
// path (same surface as the standalone posthog-react-native-session-replay package).
// The mock models the native recorder state: isEnabled() answers what start()/startRecording()
// actually did, which is how a real native SDK reports a start it refused.
let nativeAccepts = true
let nativeRecording = false

vi.mock('../src/optional/OptionalPlugin', () => ({
  OptionalReactNativePluginVersion: '1.4.0',
  OptionalReactNativePlugin: {
    start: vi.fn(async () => {}),
    startSession: vi.fn(async () => {}),
    endSession: vi.fn(async () => {}),
    isEnabled: vi.fn(async () => false),
    identify: vi.fn(async () => {}),
    startRecording: vi.fn(async () => {}),
    stopRecording: vi.fn(async () => {}),
  },
}))

const replay = OptionalReactNativePlugin as unknown as {
  start: vi.Mock
  startSession: vi.Mock
  endSession: vi.Mock
  isEnabled: vi.Mock
  identify: vi.Mock
  startRecording: vi.Mock
  stopRecording: vi.Mock
}

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()

describe('PostHog RN manual session recording controls', () => {
  vi.useRealTimers()

  let posthog: PostHog
  let cache: any = {}
  let mockStorage: PostHogCustomStorage
  let warnSpy: vi.SpyInstance
  let logSpy: vi.SpyInstance
  let errorSpy: vi.SpyInstance

  const warnings = (): string[] => warnSpy.mock.calls.map((args) => args.join(' '))

  beforeEach(() => {
    nativeAccepts = true
    nativeRecording = false

    replay.start.mockClear()
    replay.startRecording.mockReset()
    replay.stopRecording.mockClear()
    replay.isEnabled.mockClear()
    replay.isEnabled.mockImplementation(async () => nativeRecording)
    replay.startRecording.mockImplementation(async () => {
      nativeRecording = nativeAccepts
    })
    replay.stopRecording.mockImplementation(async () => {
      nativeRecording = false
    })

    // Debug mode is on below, so every log level needs a sink; the test setup turns any
    // unexpected console output into a failure.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(globalThis as any).window.fetch = vi.fn(async (url: string) => {
      const res: any = { status: 'ok', sessionRecording: { endpoint: '/s/' } }
      if (url.includes('flags')) {
        res.featureFlags = {}
      }
      return { status: 200, json: () => Promise.resolve(res) }
    })

    cache = {}
    mockStorage = {
      getItem: async (key) => cache[key] || null,
      setItem: async (key, value) => {
        cache[key] = value
      },
    }
  })

  afterEach(async () => {
    await posthog.shutdown()
    vi.useRealTimers()
    warnSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  // Recording only some sessions: replay stays off at setup, the app drives the recorder.
  const newPostHog = (): PostHog => {
    const client = new PostHog('test-token', {
      customStorage: mockStorage,
      enableSessionReplay: false,
      flushInterval: 0,
    })
    // The logger only reaches the console in debug mode.
    client.debug(true)
    return client
  }

  it('preserves the Promise<void> public recording control contract', async () => {
    posthog = newPostHog()
    await posthog.ready()

    const starting: Promise<void> = posthog.startSessionRecording()
    expect(await starting).toBeUndefined()
    expect(await posthog.isSessionReplayActive()).toBe(true)

    const stopping: Promise<void> = posthog.stopSessionRecording()
    expect(await stopping).toBeUndefined()
    expect(await posthog.isSessionReplayActive()).toBe(false)
  })

  it('starts the native recorder without returning a result', async () => {
    posthog = newPostHog()
    await posthog.ready()

    expect(await posthog.startSessionRecording()).toBeUndefined()
    expect(await posthog.isSessionReplayActive()).toBe(true)
  })

  it('lets a newer queued start supersede an earlier call without rotating the session', async () => {
    posthog = newPostHog()
    await posthog.ready()
    const sessionId = posthog.getSessionId()

    const first = posthog.startSessionRecording(false)
    const second = posthog.startSessionRecording()

    expect(await Promise.all([first, second])).toEqual([undefined, undefined])
    expect(replay.startRecording).toHaveBeenCalledTimes(1)
    expect(replay.startRecording).toHaveBeenCalledWith(true)
    expect(posthog.getSessionId()).toBe(sessionId)
    expect(await posthog.isSessionReplayActive()).toBe(true)
  })

  it('completes a native stop without a result when recording is already inactive', async () => {
    posthog = newPostHog()
    await posthog.ready()
    expect(await posthog.isSessionReplayActive()).toBe(false)

    expect(await posthog.stopSessionRecording()).toBeUndefined()
    expect(replay.stopRecording).toHaveBeenCalledTimes(1)
    expect(await posthog.isSessionReplayActive()).toBe(false)
  })

  it('warns about a flags-driven retry without promising manual backoff on an automatic resume', async () => {
    let linkedFlag = true
    vi.mocked(window.fetch).mockImplementation(async () => ({
      status: 200,
      json: async () => ({
        featureFlags: { 'replay-flag': linkedFlag },
        sessionRecording: { linkedFlag: 'replay-flag', endpoint: '/s/' },
      }),
    }))
    posthog = new PostHog('test-token', {
      customStorage: mockStorage,
      enableSessionReplay: true,
      flushInterval: 0,
    })
    posthog.debug(true)
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))

    linkedFlag = false
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalledTimes(1))

    nativeAccepts = false
    linkedFlag = true
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () =>
      expect(warnings().some((line) => line.includes('native SDK refused to start session recording'))).toBe(true)
    )
    expect(warnings().some((line) => line.includes('PostHog retries on the next feature flags load.'))).toBe(true)
    expect(warnings().some((line) => line.includes('manual start'))).toBe(false)

    nativeAccepts = true
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, async () => expect(await posthog.isSessionReplayActive()).toBe(true))
  })

  it('warns without returning a result when the native SDK refuses the start', async () => {
    nativeAccepts = false
    posthog = newPostHog()
    await posthog.ready()

    expect(await posthog.startSessionRecording()).toBeUndefined()
    expect(await posthog.isSessionReplayActive()).toBe(false)
    expect(
      warnings().some(
        (line) =>
          line.includes('native SDK refused to start session recording') &&
          line.includes('PostHog retries on the next feature flags load.')
      )
    ).toBe(true)
  })

  it('retries a refused start on the next flags load, even with replay disabled at setup', async () => {
    nativeAccepts = false
    posthog = newPostHog()
    await posthog.ready()

    await posthog.startSessionRecording()
    expect(await posthog.isSessionReplayActive()).toBe(false)
    const attempts = replay.startRecording.mock.calls.length

    // Native has loaded its own remote config by the time the next flags load lands.
    nativeAccepts = true
    await posthog.reloadFeatureFlagsAsync()

    await waitForExpect(2000, () => expect(replay.startRecording.mock.calls.length).toBeGreaterThan(attempts))
    await waitForExpect(2000, async () => expect(await posthog.isSessionReplayActive()).toBe(true))
  })

  it('does not retry a refused start once the app stops recording', async () => {
    nativeAccepts = false
    posthog = newPostHog()
    await posthog.ready()

    await posthog.startSessionRecording()
    expect(await posthog.stopSessionRecording()).toBeUndefined()
    const attempts = replay.startRecording.mock.calls.length

    nativeAccepts = true
    await posthog.reloadFeatureFlagsAsync()
    await wait(50)

    expect(replay.startRecording).toHaveBeenCalledTimes(attempts)
    expect(await posthog.isSessionReplayActive()).toBe(false)
  })

  it('does not revive a refused start when the stop lands while a retry is in flight', async () => {
    nativeAccepts = false
    posthog = newPostHog()
    await posthog.ready()

    await posthog.startSessionRecording()

    // Hold the retry inside the native start, so the stop below overlaps it.
    let releaseRetry: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      releaseRetry = resolve
    })
    let retryStarted: () => void = () => {}
    const inFlight = new Promise<void>((resolve) => {
      retryStarted = resolve
    })
    replay.startRecording.mockImplementation(async () => {
      retryStarted()
      await held
      nativeRecording = nativeAccepts
    })

    void posthog.reloadFeatureFlagsAsync()
    await inFlight

    const stopping = posthog.stopSessionRecording()
    // Long enough for an unserialized stop to run to completion ahead of the retry.
    await wait(20)
    releaseRetry()
    expect(await stopping).toBeUndefined()

    // Native accepts now, so a revived pending start would record the flow the app excluded.
    nativeAccepts = true
    replay.startRecording.mockImplementation(async () => {
      nativeRecording = nativeAccepts
    })
    const attempts = replay.startRecording.mock.calls.length

    await posthog.reloadFeatureFlagsAsync()
    await wait(50)

    expect(replay.startRecording).toHaveBeenCalledTimes(attempts)
    expect(await posthog.isSessionReplayActive()).toBe(false)
  })

  it('does not retry a refused start for the next user after reset()', async () => {
    nativeAccepts = false
    posthog = newPostHog()
    await posthog.ready()

    await posthog.startSessionRecording()
    expect(await posthog.isSessionReplayActive()).toBe(false)
    const attempts = replay.startRecording.mock.calls.length

    // Native has had its remote config for a while by logout, so a leaked pending start
    // would succeed here and record a session the new, anonymous user never asked for.
    nativeAccepts = true
    posthog.reset()
    await wait(50)

    expect(replay.startRecording).toHaveBeenCalledTimes(attempts)
    expect(await posthog.isSessionReplayActive()).toBe(false)
  })

  describe('automatic manual-start retries', () => {
    beforeEach(async () => {
      nativeAccepts = false
      posthog = newPostHog()
      await posthog.ready()
      await posthog.reloadFeatureFlagsAsync()
      await wait(20)
      vi.useFakeTimers()
    })

    it('starts after native becomes ready without another flags load', async () => {
      expect(await posthog.startSessionRecording()).toBeUndefined()
      expect(await posthog.isSessionReplayActive()).toBe(false)
      const fetches = vi.mocked(window.fetch).mock.calls.length
      nativeAccepts = true

      await vi.advanceTimersByTimeAsync(1000)

      expect(await posthog.isSessionReplayActive()).toBe(true)
      expect(window.fetch).toHaveBeenCalledTimes(fetches)
      expect(replay.startRecording).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(60000)
      expect(replay.startRecording).toHaveBeenCalledTimes(2)
    })

    it('backs off and stops scheduling after five retries', async () => {
      await posthog.startSessionRecording(false)
      const sessionId = posthog.getSessionId()
      for (const [index, delay] of [1000, 2000, 4000, 8000, 16000].entries()) {
        await vi.advanceTimersByTimeAsync(delay - 1)
        expect(replay.startRecording).toHaveBeenCalledTimes(index + 1)
        await vi.advanceTimersByTimeAsync(1)
        expect(replay.startRecording).toHaveBeenCalledTimes(index + 2)
      }
      expect(replay.startRecording.mock.calls.map(([resume]) => resume)).toEqual([false, true, true, true, true, true])
      expect(posthog.getSessionId()).toBe(sessionId)
      await vi.advanceTimersByTimeAsync(60000)
      expect(replay.startRecording).toHaveBeenCalledTimes(6)

      nativeAccepts = true
      await posthog.reloadFeatureFlagsAsync()
      await vi.advanceTimersByTimeAsync(0)
      expect(await posthog.isSessionReplayActive()).toBe(true)
    })

    it('cancels the timer when a flags-driven retry succeeds', async () => {
      await posthog.startSessionRecording()
      nativeAccepts = true
      await posthog.reloadFeatureFlagsAsync()
      await vi.advanceTimersByTimeAsync(0)
      expect(await posthog.isSessionReplayActive()).toBe(true)
      const attempts = replay.startRecording.mock.calls.length
      await vi.advanceTimersByTimeAsync(60000)
      expect(replay.startRecording).toHaveBeenCalledTimes(attempts)
    })

    const cancel = (action: string): void | Promise<unknown> => {
      switch (action) {
        case 'stop':
          return posthog.stopSessionRecording()
        case 'reset':
          return posthog.reset()
        case 'optOut':
          return posthog.optOut()
        case 'shutdown':
          return posthog.shutdown()
      }
    }

    it.each(['stop', 'reset', 'optOut', 'shutdown'])('cancels pending retries on %s', async (action) => {
      await posthog.startSessionRecording()
      await cancel(action)
      nativeAccepts = true
      await vi.advanceTimersByTimeAsync(60000)
      await posthog.reloadFeatureFlagsAsync()
      await vi.advanceTimersByTimeAsync(0)
      expect(replay.startRecording).toHaveBeenCalledTimes(1)
      expect(await posthog.isSessionReplayActive()).toBe(false)
    })

    it.each(['stop', 'reset', 'optOut', 'shutdown'])(
      'does not revive a queued manual start after %s',
      async (action) => {
        const starting = posthog.startSessionRecording()
        const cancelling = cancel(action)
        await starting
        await cancelling
        nativeAccepts = true
        await vi.advanceTimersByTimeAsync(60000)
        await posthog.reloadFeatureFlagsAsync()
        await vi.advanceTimersByTimeAsync(0)
        expect(replay.startRecording).not.toHaveBeenCalled()
        expect(await posthog.isSessionReplayActive()).toBe(false)
      }
    )

    it.each(['stop', 'reset', 'optOut', 'shutdown'])('does not revive an in-flight retry after %s', async (action) => {
      await posthog.startSessionRecording()
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      replay.startRecording.mockImplementationOnce(async () => {
        await held
        nativeRecording = true
      })
      await vi.advanceTimersByTimeAsync(1000)
      expect(replay.startRecording).toHaveBeenCalledTimes(2)

      const cancelling = cancel(action)
      release()
      await cancelling
      await vi.advanceTimersByTimeAsync(0)
      expect(await posthog.isSessionReplayActive()).toBe(false)
      const attempts = replay.startRecording.mock.calls.length
      nativeAccepts = true
      await vi.advanceTimersByTimeAsync(60000)
      await posthog.reloadFeatureFlagsAsync()
      await vi.advanceTimersByTimeAsync(0)
      expect(replay.startRecording).toHaveBeenCalledTimes(attempts)
    })

    it('gives a new manual request its own retry budget', async () => {
      await posthog.startSessionRecording()
      await vi.advanceTimersByTimeAsync(60000)
      expect(replay.startRecording).toHaveBeenCalledTimes(6)
      await posthog.startSessionRecording()
      nativeAccepts = true
      await vi.advanceTimersByTimeAsync(1000)
      expect(replay.startRecording).toHaveBeenCalledTimes(8)
      expect(await posthog.isSessionReplayActive()).toBe(true)
    })

    it('does not cancel a newer start when stopping an in-flight retry', async () => {
      await posthog.startSessionRecording()
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      replay.startRecording.mockImplementationOnce(async () => {
        await held
        nativeRecording = true
      })
      await vi.advanceTimersByTimeAsync(1000)
      expect(replay.startRecording).toHaveBeenCalledTimes(2)
      const stopping = posthog.stopSessionRecording()
      nativeAccepts = true
      const restarting = posthog.startSessionRecording()
      release()
      await stopping
      expect(await restarting).toBeUndefined()
      expect(await posthog.isSessionReplayActive()).toBe(true)
      await vi.advanceTimersByTimeAsync(60000)
      expect(replay.startRecording).toHaveBeenCalledTimes(3)
    })

    it('does not remember a start requested while opted out', async () => {
      await posthog.optOut()
      expect(await posthog.startSessionRecording()).toBeUndefined()
      await posthog.optIn()
      nativeAccepts = true
      await vi.advanceTimersByTimeAsync(60000)
      expect(replay.startRecording).not.toHaveBeenCalled()
    })
  })

  it('warns without returning a result when the plugin is too old to control recording', async () => {
    const startRecording = replay.startRecording
    delete (replay as any).startRecording
    try {
      posthog = newPostHog()
      await posthog.ready()

      expect(await posthog.startSessionRecording()).toBeUndefined()
      expect(await posthog.isSessionReplayActive()).toBe(false)
      expect(warnings().some((line) => line.includes('startRecording is not available'))).toBe(true)
    } finally {
      ;(replay as any).startRecording = startRecording
    }
  })
})
