import { PostHog, PostHogCustomStorage, PostHogOptions } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { Linking, AppState } from 'react-native'
import { waitForExpect, wait } from './test-utils'

vi.mock('../src/optional/OptionalPlugin', () => ({
  OptionalReactNativePluginVersion: '3.0.0',
  OptionalReactNativePlugin: {
    setup: vi.fn(async () => {}),
    setOptOut: vi.fn(async () => {}),
    startSession: vi.fn(async () => {}),
    endSession: vi.fn(async () => {}),
    isEnabled: vi.fn(async () => false),
    identify: vi.fn(async () => {}),
    setAppLanguage: vi.fn(async () => {}),
    registerPushNotificationToken: vi.fn(async () => {}),
  },
}))

const native = OptionalReactNativePlugin as unknown as Record<'setup' | 'setAppLanguage', vi.Mock | undefined>

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn(() => ({ remove: () => {} })) as any

describe('setAppLanguage', () => {
  vi.useRealTimers()

  let clients: PostHog[] = []
  let storage: PostHogCustomStorage
  const setAppLanguageMock = native.setAppLanguage!

  const newClient = async (apiKey = 'test-token', options?: PostHogOptions): Promise<PostHog> => {
    const client = new PostHog(apiKey, { customStorage: storage, flushInterval: 0, ...options })
    clients.push(client)
    await client.ready()
    return client
  }

  const captured = async (client: PostHog, properties?: { [key: string]: any }): Promise<any> => {
    const onCapture = vi.fn()
    client.on('capture', onCapture)
    client.capture('event', properties)
    await waitForExpect(200, () => expect(onCapture).toHaveBeenCalled())
    return onCapture.mock.calls[0][0].properties
  }

  beforeEach(() => {
    native.setAppLanguage = setAppLanguageMock
    setAppLanguageMock.mockClear()
    native.setup!.mockClear()
    ;(globalThis as any).window.fetch = vi.fn(async (url: string) => {
      const res = url.includes('flags') ? { featureFlags: {}, sessionRecording: { endpoint: '/s/' } } : { status: 'ok' }
      return { status: 200, json: () => Promise.resolve(res) }
    })
    const cache: { [key: string]: string } = {}
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

  it('sends no $app_language by default', async () => {
    const client = await newClient()

    expect(await captured(client)).not.toHaveProperty('$app_language')
  })

  it.each([
    { input: 'de', expected: 'de' },
    { input: ' pt_BR ', expected: 'pt-BR' },
    { input: 'zh_Hant_TW', expected: 'zh-Hant-TW' },
  ])('stamps $input as $expected', async ({ input, expected }) => {
    const client = await newClient()

    client.setAppLanguage(input)

    expect((await captured(client)).$app_language).toBe(expected)
  })

  it.each([null, '', '   ', 42 as unknown as string])('clears it when given %p', async (input) => {
    const client = await newClient()
    client.setAppLanguage('de')

    client.setAppLanguage(input)

    expect(await captured(client)).not.toHaveProperty('$app_language')
  })

  it('survives reset()', async () => {
    const client = await newClient()
    client.setAppLanguage('de')

    client.reset()

    expect((await captured(client)).$app_language).toBe('de')
  })

  it('loses to a registered or captured $app_language', async () => {
    const client = await newClient()
    client.setAppLanguage('de')
    await client.register({ $app_language: 'fr' })

    expect((await captured(client)).$app_language).toBe('fr')
    expect((await captured(client, { $app_language: 'es' })).$app_language).toBe('es')
  })

  it('loses to a session-registered $app_language', async () => {
    const client = await newClient()
    client.setAppLanguage('de')
    client.registerForSession({ $app_language: 'fr' })

    expect((await captured(client)).$app_language).toBe('fr')
  })

  it('forwards a language set before native setup once setup runs', async () => {
    const client = await newClient('test-token', {
      persistence: 'memory',
      capturePushNotificationSubscriptions: false,
      capturePushNotificationOpened: false,
    })
    client.setAppLanguage('de')
    await wait(50)
    expect(setAppLanguageMock).not.toHaveBeenCalled()

    await client.registerPushNotificationToken('device-token')

    expect(native.setup).toHaveBeenCalled()
    expect(setAppLanguageMock).toHaveBeenCalledWith('de')
  })

  it('clears the native language on setup when none is set', async () => {
    await newClient('test-token', { enableSessionReplay: true })

    await waitForExpect(2000, () => expect(setAppLanguageMock).toHaveBeenCalledWith(null))
  })

  it('forwards changes and clears to native after setup', async () => {
    const client = await newClient('test-token', { enableSessionReplay: true })
    await waitForExpect(2000, () => expect(native.setup).toHaveBeenCalled())

    client.setAppLanguage('pt_BR')
    await waitForExpect(2000, () => expect(setAppLanguageMock).toHaveBeenLastCalledWith('pt-BR'))
    client.setAppLanguage(null)
    await waitForExpect(2000, () => expect(setAppLanguageMock).toHaveBeenLastCalledWith(null))
  })

  it("keeps another project's language off the native SDK", async () => {
    await newClient('test-token', { enableSessionReplay: true })
    await waitForExpect(2000, () => expect(setAppLanguageMock).toHaveBeenCalledWith(null))
    setAppLanguageMock.mockClear()
    const other = await newClient('other-project-token', { enableSessionReplay: true })
    await wait(50)

    other.setAppLanguage('de')
    await wait(50)

    expect(setAppLanguageMock).not.toHaveBeenCalled()
    expect((await captured(other)).$app_language).toBe('de')
  })

  it('still stamps JS events with a plugin that predates setAppLanguage', async () => {
    native.setAppLanguage = undefined
    const client = await newClient('test-token', { enableSessionReplay: true })
    await waitForExpect(2000, () => expect(native.setup).toHaveBeenCalled())

    client.setAppLanguage('de')

    expect((await captured(client)).$app_language).toBe('de')
  })
})
