import { PostHog, PostHogCustomStorage, PostHogPersistedProperty } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { Linking, AppState } from 'react-native'
import { waitForExpect, wait } from './test-utils'

vi.mock('../src/optional/OptionalPlugin', () => ({
  OptionalReactNativePluginVersion: '2.9.0',
  OptionalReactNativePlugin: {
    setup: vi.fn(async () => {}),
    setOptOut: vi.fn(async () => {}),
    startSession: vi.fn(async () => {}),
    endSession: vi.fn(async () => {}),
    isEnabled: vi.fn(async () => false),
    identify: vi.fn(async () => {}),
    startRecording: vi.fn(async () => {}),
    stopRecording: vi.fn(async () => {}),
    registerPushNotificationToken: vi.fn(async () => {}),
  },
}))

const native = OptionalReactNativePlugin as unknown as Record<
  | 'setup'
  | 'startSession'
  | 'endSession'
  | 'isEnabled'
  | 'stopRecording'
  | 'identify'
  | 'setOptOut'
  | 'registerPushNotificationToken',
  vi.Mock
>

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
const appStateListeners: Array<(state: string) => void> = []
AppState.addEventListener = vi.fn((_event: string, listener: (state: string) => void) => {
  appStateListeners.push(listener)
  return { remove: () => {} }
}) as any

describe('PostHog RN native session with multiple clients', () => {
  vi.useRealTimers()

  let clients: PostHog[] = []
  let cache: any = {}
  let storage: PostHogCustomStorage
  // The process-wide native session id. Like the iOS and Android plugins, setup() sets it
  // even when the native SDK is already set up and ignores the rest of the call.
  let nativeSessionId: string | undefined

  const newClient = async (apiKey: string = 'test-token'): Promise<PostHog> => {
    const client = new PostHog(apiKey, { customStorage: storage, enableSessionReplay: true, flushInterval: 0 })
    clients.push(client)
    await client.ready()
    await wait(50)
    return client
  }

  const expireSessions = (): void => {
    for (const client of clients) {
      client.setPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp, Date.now() - 31 * 60 * 1000)
    }
  }

  beforeEach(() => {
    Object.values(native).forEach((fn) => fn.mockClear())
    nativeSessionId = undefined
    native.setup.mockImplementation(async (sessionId: string) => {
      nativeSessionId = sessionId
    })
    native.startSession.mockImplementation(async (sessionId: string) => {
      nativeSessionId = sessionId
    })
    native.isEnabled.mockImplementation(async () => nativeSessionId !== undefined)
    appStateListeners.length = 0
    ;(globalThis as any).window.fetch = vi.fn(async (url: string) => {
      const res = url.includes('flags') ? { featureFlags: {}, sessionRecording: { endpoint: '/s/' } } : { status: 'ok' }
      return { status: 200, json: () => Promise.resolve(res) }
    })
    cache = {}
    storage = {
      getItem: async (key) => cache[key] || null,
      setItem: async (key, value) => {
        cache[key] = value
      },
    }
  })

  afterEach(async () => {
    await Promise.all(clients.map((c) => c.shutdown()))
    clients = []
  })

  it('keeps the native session on the first client when a client for another project starts', async () => {
    const first = await newClient()
    await waitForExpect(2000, () => expect(nativeSessionId).toBe(first.getSessionId()))
    native.startSession.mockClear()
    native.endSession.mockClear()

    const second = await newClient('other-project-token')

    expect(second.getSessionId()).not.toBe(first.getSessionId())
    expect(native.setup).toHaveBeenCalledTimes(1)
    expect(native.startSession).not.toHaveBeenCalled()
    expect(native.endSession).not.toHaveBeenCalled()
    expect(nativeSessionId).toBe(first.getSessionId())
  })

  it("keeps another project's identify, push and opt-out calls off the native SDK", async () => {
    const first = await newClient()
    await waitForExpect(2000, () => expect(nativeSessionId).toBe(first.getSessionId()))
    const second = await newClient('other-project-token')
    native.identify.mockClear()
    native.setOptOut.mockClear()

    second.identify('second-user')
    await second.registerPushNotificationToken('second-token')
    await second.optOut()
    await wait(50)

    expect(native.identify).not.toHaveBeenCalled()
    expect(native.registerPushNotificationToken).not.toHaveBeenCalled()
    expect(native.setOptOut).not.toHaveBeenCalled()
    expect(native.stopRecording).not.toHaveBeenCalled()

    first.identify('first-user')
    await first.registerPushNotificationToken('first-token')
    await first.optOut()

    await waitForExpect(2000, () => {
      expect(native.identify).toHaveBeenCalled()
      expect(native.registerPushNotificationToken).toHaveBeenCalled()
      expect(native.setOptOut).toHaveBeenCalledWith(true)
      expect(native.stopRecording).toHaveBeenCalled()
    })
  })

  it('rotates the native session once, to the first client, on foreground after expiry', async () => {
    const first = await newClient()
    await waitForExpect(2000, () => expect(nativeSessionId).toBe(first.getSessionId()))
    const second = await newClient('other-project-token')
    const expiredSessionId = first.getSessionId()
    expireSessions()
    native.startSession.mockClear()
    native.endSession.mockClear()

    appStateListeners.forEach((listener) => listener('active'))

    expect(first.getSessionId()).not.toBe(expiredSessionId)
    expect(second.getSessionId()).not.toBe(first.getSessionId())
    expect(native.endSession).toHaveBeenCalledTimes(1)
    expect(native.startSession).toHaveBeenCalledTimes(1)
    expect(nativeSessionId).toBe(first.getSessionId())
  })

  it('moves the native session to a newer client for the same project, and only that client rotates it', async () => {
    const first = await newClient()
    await waitForExpect(2000, () => expect(nativeSessionId).toBe(first.getSessionId()))

    const second = await newClient()
    await waitForExpect(2000, () => expect(nativeSessionId).toBe(second.getSessionId()))
    expireSessions()
    native.startSession.mockClear()
    native.endSession.mockClear()

    appStateListeners.forEach((listener) => listener('active'))

    expect(native.endSession).toHaveBeenCalledTimes(1)
    expect(native.startSession).toHaveBeenCalledTimes(1)
    expect(nativeSessionId).toBe(second.getSessionId())
  })

  it('moves the native session to a newer client for the same project while the first setup is in flight', async () => {
    let finishFirstSetup!: () => void
    native.setup.mockImplementationOnce(async (sessionId: string) => {
      nativeSessionId = sessionId
      await new Promise<void>((resolve) => (finishFirstSetup = resolve))
    })
    await newClient()
    await waitForExpect(2000, () => expect(finishFirstSetup).toBeDefined())

    const second = await newClient()
    finishFirstSetup()
    await waitForExpect(2000, () => expect(nativeSessionId).toBe(second.getSessionId()))
    expireSessions()
    native.startSession.mockClear()

    appStateListeners.forEach((listener) => listener('active'))

    expect(native.startSession).toHaveBeenCalledTimes(1)
    expect(nativeSessionId).toBe(second.getSessionId())
  })

  it('leaves the native session alone when another client resets its session', async () => {
    const first = await newClient()
    await waitForExpect(2000, () => expect(nativeSessionId).toBe(first.getSessionId()))
    const second = await newClient('other-project-token')
    native.endSession.mockClear()

    second.resetSessionId()

    expect(native.endSession).not.toHaveBeenCalled()
    expect(nativeSessionId).toBe(first.getSessionId())
  })

  it("does not stop the first client's recording when another client stops its recording", async () => {
    const first = await newClient()
    await waitForExpect(2000, () => expect(nativeSessionId).toBe(first.getSessionId()))
    const second = await newClient('other-project-token')

    expect(await second.isSessionReplayActive()).toBe(false)
    await second.stopSessionRecording()
    expect(native.stopRecording).not.toHaveBeenCalled()
    expect(await second.isSessionReplayActive()).toBe(false)

    await first.stopSessionRecording()
    expect(native.stopRecording).toHaveBeenCalledTimes(1)
  })

  it('lets an older client for the same project stop the recording', async () => {
    const first = await newClient()
    const second = await newClient()
    await waitForExpect(2000, () => expect(nativeSessionId).toBe(second.getSessionId()))

    await first.stopSessionRecording()

    expect(native.stopRecording).toHaveBeenCalledTimes(1)
  })

  it('lets an older client for the same project stop the recording on opt-out', async () => {
    const first = await newClient()
    const second = await newClient()
    await waitForExpect(2000, () => expect(nativeSessionId).toBe(second.getSessionId()))
    native.stopRecording.mockClear()

    await first.optOut()

    await waitForExpect(2000, () => expect(native.stopRecording).toHaveBeenCalled())
  })

  it('releases the native session when its owner shuts down', async () => {
    const first = await newClient()
    await waitForExpect(2000, () => expect(nativeSessionId).toBe(first.getSessionId()))
    await first.shutdown()
    clients = []

    const second = await newClient('other-project-token')

    expect(native.setup).toHaveBeenCalledTimes(2)
    expect(nativeSessionId).toBe(second.getSessionId())
  })

  it('lets another client set up the native session when the first client fails to', async () => {
    const setNativeSession = native.setup.getMockImplementation()
    native.setup.mockImplementation(async () => {
      throw new Error('bridge unavailable')
    })
    await newClient()
    native.setup.mockImplementation(setNativeSession)

    const second = await newClient('other-project-token')

    await waitForExpect(2000, () => expect(nativeSessionId).toBe(second.getSessionId()))
  })
})
