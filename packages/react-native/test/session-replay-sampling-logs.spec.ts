import { PostHog, PostHogCustomStorage } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { Linking, AppState } from 'react-native'
import { wait } from './test-utils'

// Mock the native plugin bridge. No `setup` key, so the SDK takes the legacy start()
// path (same surface as the standalone posthog-react-native-session-replay package).
jest.mock('../src/optional/OptionalPlugin', () => ({
  OptionalReactNativePlugin: {
    start: jest.fn(async () => {}),
    startSession: jest.fn(async () => {}),
    endSession: jest.fn(async () => {}),
    isEnabled: jest.fn(async () => false),
    identify: jest.fn(async () => {}),
    startRecording: jest.fn(async () => {}),
    stopRecording: jest.fn(async () => {}),
  },
  OptionalReactNativePluginVersion: '1.4.0',
}))

const replay = OptionalReactNativePlugin as unknown as { start: jest.Mock; isEnabled: jest.Mock }

Linking.getInitialURL = jest.fn(() => Promise.resolve(null))
AppState.addEventListener = jest.fn()

describe('PostHog RN session replay sampleRate logging', () => {
  jest.useRealTimers()

  let posthog: PostHog
  let cache: any = {}
  let mockStorage: PostHogCustomStorage
  let currentSessionRecording: any = {}
  let warnSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance

  const warnings = (): string[] => warnSpy.mock.calls.map((args) => args.join(' '))
  const infos = (): string[] => logSpy.mock.calls.map((args) => args.join(' '))

  beforeEach(() => {
    replay.start.mockClear()
    replay.isEnabled.mockImplementation(async () => false)
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    currentSessionRecording = { endpoint: '/s/' } // no linkedFlag => recording active
    // Attach sessionRecording to every response: the remote config endpoint feeds the cached
    // RemoteConfig that startSessionReplay reads for the remote sampleRate, and /flags re-arms it.
    ;(globalThis as any).window.fetch = jest.fn(async (url: string) => {
      const res: any = { status: 'ok', sessionRecording: currentSessionRecording }
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
    warnSpy.mockRestore()
    logSpy.mockRestore()
  })

  const newPostHog = (sampleRate?: number): PostHog => {
    const client = new PostHog('test-token', {
      customStorage: mockStorage,
      enableSessionReplay: true,
      flushInterval: 0,
      sessionReplayConfig: sampleRate === undefined ? {} : { sampleRate },
    })
    // Enable debug synchronously (before the async init runs startSessionReplay) so the
    // replay-config log lines reach the console.
    client.debug(true)
    return client
  }

  it('logs the resolved native plugin version next to the replay config', async () => {
    posthog = newPostHog()
    await posthog.ready()
    await wait(50)

    expect(infos().some((line) => line.includes('Native PostHog plugin (version 1.4.0) replay config:'))).toBe(true)
  })

  it('warns that recording starts with no sampleRate when no remote config is cached', async () => {
    posthog = newPostHog()
    await posthog.ready()
    await wait(50)

    expect(warnings().some((line) => line.includes('no sampleRate because no remote config is cached'))).toBe(true)
  })

  it('warns and names both values when a local sampleRate overrides the remote one', async () => {
    // Warm-up launch caches the remote config, including a 5% project sampleRate.
    currentSessionRecording = { endpoint: '/s/', sampleRate: 0.05 }
    const warmup = newPostHog()
    await warmup.ready()
    await warmup.reloadFeatureFlagsAsync()
    await wait(50)
    await warmup.shutdown()
    warnSpy.mockClear()

    // Next launch sets a local 50% sampleRate, which must win over the cached 5% remote rate.
    posthog = newPostHog(0.5)
    await posthog.ready()
    await wait(50)

    expect(
      warnings().some(
        (line) => line.includes('overrides the remote sampleRate') && line.includes('0.5') && line.includes('0.05')
      )
    ).toBe(true)
  })
})
