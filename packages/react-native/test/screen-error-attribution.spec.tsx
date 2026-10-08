/** @vitest-environment jsdom */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { AppState, Linking } from 'react-native'
import { PostHog, PostHogErrorBoundary, PostHogProvider } from '../src'
import type { PostHogOptions } from '../src'

// Screen context does not depend on Expo or a navigation integration being installed.
vi.mock('../src/optional/OptionalReactNativeNavigation', () => ({ OptionalReactNativeNavigation: undefined }))
vi.mock('../src/optional/OptionalExpoApplication', () => ({ OptionalExpoApplication: undefined }))
vi.mock('../src/optional/OptionalExpoDevice', () => ({ OptionalExpoDevice: undefined }))
vi.mock('../src/optional/OptionalExpoLocalization', () => ({ OptionalExpoLocalization: undefined }))

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()
vi.useRealTimers()

const clients: PostHog[] = []
function createClient(options: PostHogOptions = {}): { client: PostHog; events: any[] } {
  const events: any[] = []
  const client = new PostHog('test-token', {
    persistence: 'memory',
    flushInterval: 0,
    captureAppLifecycleEvents: false,
    preloadFeatureFlags: false,
    before_send: (event) => {
      events.push(event)
      return event
    },
    ...options,
  })
  clients.push(client)
  return { client, events }
}

const exceptions = (events: any[]): any[] => events.filter((event) => event.event === '$exception')

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ status: 200, json: async () => ({}) })) as any
})

afterEach(async () => {
  cleanup()
  await Promise.all(clients.splice(0).map((client) => client.shutdown()))
  vi.restoreAllMocks()
})

describe('screen error attribution', () => {
  it('attributes same-turn exceptions to the initial screen and subsequent screen', async () => {
    const { client, events } = createClient()
    await client.ready()

    const initialScreen = client.screen('Home', { privateParam: 'not exception context' })
    client.captureException(new Error('initial'))
    const nextScreen = client.screen('users/[id]')
    client.captureException(new Error('next'))
    await Promise.all([initialScreen, nextScreen])

    expect(exceptions(events).map((event) => event.properties.$screen_name)).toEqual(['Home', 'users/[id]'])
    expect(exceptions(events)[0].properties).not.toHaveProperty('privateParam')
    expect(events.filter((event) => event.event === '$screen').map((event) => event.properties.$screen_name)).toEqual([
      'Home',
      'users/[id]',
    ])
  })

  it('preserves screen call order across asynchronous storage initialization', async () => {
    let resolveStorage!: (value: null) => void
    const storageReady = new Promise<null>((resolve) => {
      resolveStorage = resolve
    })
    const { client, events } = createClient({
      persistence: 'file',
      customStorage: { getItem: () => storageReady, setItem: async () => {} },
    })
    const initialScreen = client.screen('Initial')
    client.captureException(new Error('before ready'))
    resolveStorage(null)
    await client.ready()
    await initialScreen
    expect(exceptions(events)[0].properties.$screen_name).toBe('Initial')

    const nextScreen = client.screen('Next')
    client.captureException(new Error('after ready'))
    await nextScreen
    expect(exceptions(events)[1].properties.$screen_name).toBe('Next')
  })

  it('does not retroactively attribute queued exceptions to later screens during initialization', async () => {
    let resolveStorage!: (value: null) => void
    const storageReady = new Promise<null>((resolve) => {
      resolveStorage = resolve
    })
    const { client, events } = createClient({
      persistence: 'file',
      customStorage: { getItem: () => storageReady, setItem: async () => {} },
    })
    client.captureException(new Error('before any screen'))
    const first = client.screen('First')
    client.captureException(new Error('first'))
    const second = client.screen('Second')
    client.captureException(new Error('second'))
    resolveStorage(null)
    await Promise.all([first, second, client.ready()])

    const captured = exceptions(events)
    expect(captured.map((event) => event.properties.$screen_name)).toEqual([undefined, 'First', 'Second'])
    expect(captured[0].properties).not.toHaveProperty('$screen_name')
  })

  it('preserves persisted, pending registered, and session screen properties during initialization', async () => {
    let resolveStorage!: (value: string) => void
    const storageReady = new Promise<string>((resolve) => {
      resolveStorage = resolve
    })
    const { client, events } = createClient({
      persistence: 'file',
      customStorage: { getItem: () => storageReady, setItem: async () => {} },
    })
    client.captureException(new Error('persisted context'))
    const registration = client.register({ $screen_name: 'Registered' })
    client.captureException(new Error('registered context'))
    const screen = client.screen('Screen')
    client.captureException(new Error('screen context'))
    client.captureException(new Error('caller override'), { $screen_name: 'Caller' })
    client.captureException(new Error('caller undefined'), { $screen_name: undefined })
    client.captureException(new Error('caller null'), { $screen_name: null })
    resolveStorage(JSON.stringify({ version: 'v1', content: { props: { $screen_name: 'Persisted' } } }))
    await Promise.all([registration, screen, client.ready()])
    expect(exceptions(events).map((event) => event.properties.$screen_name)).toEqual([
      'Persisted',
      'Registered',
      'Screen',
      'Caller',
      undefined,
      null,
    ])

    client.registerForSession({ $screen_name: 'Session registered' })
    client.captureException(new Error('explicit session context'))
    expect(exceptions(events)[6].properties.$screen_name).toBe('Session registered')
  })

  it('preserves common screen-property precedence over registered and caller properties', async () => {
    let resolveStorage!: (value: null) => void
    const storageReady = new Promise<null>((resolve) => {
      resolveStorage = resolve
    })
    const { client, events } = createClient({
      persistence: 'file',
      customStorage: { getItem: () => storageReady, setItem: async () => {} },
      customAppProperties: () => ({ $screen_name: 'Common' }),
    })
    const registration = client.register({ $screen_name: 'Registered' })
    client.captureException(new Error('before screen'))
    const screen = client.screen('Screen')
    client.captureException(new Error('caller'), { $screen_name: 'Caller' })
    resolveStorage(null)
    await Promise.all([registration, screen, client.ready()])
    expect(exceptions(events).map((event) => event.properties.$screen_name)).toEqual(['Common', 'Common'])
  })

  it('preserves before_send filtering of exceptions queued during initialization', async () => {
    let resolveStorage!: (value: null) => void
    const storageReady = new Promise<null>((resolve) => {
      resolveStorage = resolve
    })
    const filtered: any[] = []
    const { client } = createClient({
      persistence: 'file',
      customStorage: { getItem: () => storageReady, setItem: async () => {} },
      before_send: (event) => {
        if (event.event === '$exception') {
          delete event.properties.$screen_name
          filtered.push(event)
        }
        return event
      },
    })
    const screen = client.screen('Screen')
    client.captureException(new Error('filtered'))
    resolveStorage(null)
    await Promise.all([screen, client.ready()])
    expect(filtered).toHaveLength(1)
    expect(filtered[0].properties).not.toHaveProperty('$screen_name')
  })

  it('does not restore an older screen when pending screen calls finish initializing', async () => {
    let resolveStorage!: (value: null) => void
    const storageReady = new Promise<null>((resolve) => {
      resolveStorage = resolve
    })
    const { client, events } = createClient({
      persistence: 'file',
      customStorage: { getItem: () => storageReady, setItem: async () => {} },
    })
    const first = client.screen('First')
    const second = client.screen('Second')
    resolveStorage(null)
    await Promise.all([first, second, client.ready()])
    client.captureException(new Error('initialized'))
    expect(exceptions(events)[0].properties.$screen_name).toBe('Second')
  })

  it('preserves caller overrides and isolates clients without a recorded route', async () => {
    const first = createClient()
    const second = createClient()
    await Promise.all([first.client.ready(), second.client.ready()])
    void first.client.screen('Safe name')
    first.client.captureException(new Error('overridden'), { $screen_name: 'Caller name' })
    second.client.captureException(new Error('no navigation or Expo required'))
    expect(exceptions(first.events)[0].properties.$screen_name).toBe('Caller name')
    expect(exceptions(second.events)[0].properties).not.toHaveProperty('$screen_name')
  })

  it('allows before_send to remove the screen name from exceptions', async () => {
    const captured: any[] = []
    const { client } = createClient({
      before_send: (event) => {
        delete event.properties.$screen_name
        captured.push(event)
        return event
      },
    })
    await client.ready()
    void client.screen('Safe name')
    client.captureException(new Error('redacted'))
    expect(exceptions(captured)[0].properties).not.toHaveProperty('$screen_name')
  })

  it('attributes automatically captured uncaught errors through the existing exception path', async () => {
    let handler = vi.fn() as (error: Error, fatal: boolean) => void
    vi.stubGlobal('ErrorUtils', {
      getGlobalHandler: () => handler,
      setGlobalHandler: (next: typeof handler) => {
        handler = next
      },
    })
    const { client, events } = createClient({ errorTracking: { autocapture: { uncaughtExceptions: true } } })
    try {
      await client.ready()
      void client.screen('Uncaught screen')
      handler(new Error('uncaught'), false)
      expect(exceptions(events)[0].properties.$screen_name).toBe('Uncaught screen')
    } finally {
      await client.shutdown()
      vi.unstubAllGlobals()
    }
  })

  it('does not send screen or exception events while opted out', async () => {
    const { client, events } = createClient({ defaultOptIn: false })
    await client.ready()
    await client.screen('Home')
    client.captureException(new Error('not consented'))
    expect(events).toEqual([])
  })

  it('does not infer a failed destination before its tracking effect commits', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client, events } = createClient()
    await client.ready()
    await client.screen('Previous screen')
    const FailedDestination = (): React.ReactElement => {
      React.useEffect(() => {
        void client.screen('Uncommitted destination')
      }, [])
      throw new Error('render failed before effect')
    }
    render(
      <PostHogProvider client={client} autocapture={false}>
        <PostHogErrorBoundary fallback={<div>Fallback</div>}>
          <FailedDestination />
        </PostHogErrorBoundary>
      </PostHogProvider>
    )
    expect(exceptions(events)[0].properties.$screen_name).toBe('Previous screen')
    expect(events.filter((event) => event.event === '$screen')).toHaveLength(1)
  })

  it('attributes a render exception to a screen recorded before rendering', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client, events } = createClient()
    await client.ready()
    const screen = client.screen('Safe render screen')
    const Throw = (): React.ReactElement => {
      throw new Error('render failed')
    }
    render(
      <PostHogProvider client={client} autocapture={false}>
        <PostHogErrorBoundary fallback={<div>Fallback</div>}>
          <Throw />
        </PostHogErrorBoundary>
      </PostHogProvider>
    )
    await screen
    expect(exceptions(events)).toHaveLength(1)
    expect(exceptions(events)[0].properties.$screen_name).toBe('Safe render screen')
  })
})
