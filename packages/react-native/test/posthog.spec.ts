import { PostHog, PostHogCustomStorage, PostHogPersistedProperty } from '../src'
import { Linking, AppState, AppStateStatus } from 'react-native'
import { waitForExpect } from './test-utils'
import { PostHogRNStorage, createEventsStorage } from '../src/storage'
import { FeatureFlagError } from '@posthog/core'

Linking.getInitialURL = jest.fn(() => Promise.resolve(null))
AppState.addEventListener = jest.fn()

describe('PostHog React Native', () => {
  describe('evaluation contexts', () => {
    it('should send evaluation contexts when configured', async () => {
      posthog = new PostHog('test-token', {
        evaluationContexts: ['production', 'mobile'],
        flushInterval: 0,
      })
      await posthog.ready()

      await posthog.reloadFeatureFlagsAsync()

      expect((globalThis as any).window.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/flags/?v=2&config=true'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"evaluation_contexts":["production","mobile"]'),
        })
      )
    })

    it('should not send evaluation contexts when not configured', async () => {
      posthog = new PostHog('test-token', {
        flushInterval: 0,
      })
      await posthog.ready()

      await posthog.reloadFeatureFlagsAsync()

      expect((globalThis as any).window.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/flags/?v=2&config=true'),
        expect.objectContaining({
          method: 'POST',
          body: expect.not.stringContaining('evaluation_contexts'),
        })
      )
    })

    it('should not send evaluation contexts when configured as empty array', async () => {
      posthog = new PostHog('test-token', {
        evaluationContexts: [],
        flushInterval: 0,
      })
      await posthog.ready()

      await posthog.reloadFeatureFlagsAsync()

      expect((globalThis as any).window.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/flags/?v=2&config=true'),
        expect.objectContaining({
          method: 'POST',
          body: expect.not.stringContaining('evaluation_contexts'),
        })
      )
    })

    it('should support deprecated evaluationEnvironments field', async () => {
      posthog = new PostHog('test-token', {
        evaluationEnvironments: ['production', 'mobile'],
        flushInterval: 0,
      })
      await posthog.ready()

      await posthog.reloadFeatureFlagsAsync()

      expect((globalThis as any).window.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/flags/?v=2&config=true'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"evaluation_contexts":["production","mobile"]'),
        })
      )
    })
  })

  let mockStorage: PostHogCustomStorage
  let cache: any = {}

  jest.setTimeout(500)
  jest.useRealTimers()

  let posthog: PostHog

  beforeEach(() => {
    ;(globalThis as any).window.fetch = jest.fn(async (url) => {
      let res: any = { status: 'ok' }
      if (url.includes('flags')) {
        res = {
          featureFlags: {},
        }
      }

      return {
        status: 200,
        json: () => Promise.resolve(res),
      }
    })

    cache = {}
    mockStorage = {
      getItem: async (key) => {
        return cache[key] || null
      },
      setItem: async (key, value) => {
        cache[key] = value
      },
    }
  })

  afterEach(async () => {
    // This ensures there are no open promises / timers
    await posthog.shutdown()
  })

  it('should initialize properly with bootstrap', async () => {
    posthog = new PostHog('test-token', {
      bootstrap: { distinctId: 'bar' },
      persistence: 'memory',
      flushInterval: 0,
    })

    await posthog.ready()

    expect(posthog.getAnonymousId()).toEqual('bar')
    expect(posthog.getDistinctId()).toEqual('bar')
  })

  it('should initialize properly with bootstrap using async storage', async () => {
    posthog = new PostHog('test-token', {
      bootstrap: { distinctId: 'bar' },
      persistence: 'file',
      flushInterval: 0,
    })
    await posthog.ready()

    expect(posthog.getAnonymousId()).toEqual('bar')
    expect(posthog.getDistinctId()).toEqual('bar')
  })

  it('should allow customising of native app properties', async () => {
    posthog = new PostHog('test-token', {
      customAppProperties: { $app_name: 'custom' },
      flushInterval: 0,
    })
    // await posthog.ready()

    expect(posthog.getCommonEventProperties()).toEqual({
      $lib: 'posthog-react-native',
      $lib_version: expect.any(String),
      $screen_height: expect.any(Number),
      $screen_width: expect.any(Number),

      $app_name: 'custom',
    })

    const posthog2 = new PostHog('test-token2', {
      flushInterval: 0,
      customAppProperties: (properties) => {
        properties.$app_name = 'customised!'
        delete properties.$device_name
        return properties
      },
    })
    await posthog.ready()

    expect(posthog2.getCommonEventProperties()).toEqual({
      $lib: 'posthog-react-native',
      $lib_version: expect.any(String),
      $screen_height: expect.any(Number),
      $screen_width: expect.any(Number),

      $app_build: 'mock',
      $app_name: 'customised!', // changed
      $app_namespace: 'mock',
      $app_version: 'mock',
      $device_manufacturer: 'mock',
      $device_type: 'Mobile',
      // $device_name: 'mock', (deleted)
      $is_emulator: false,
      $os_name: 'mock',
      $os_version: 'mock',
      $locale: 'mock',
      $timezone: 'mock',
    })

    await posthog2.shutdown()
  })

  describe('screen', () => {
    it('should set a $screen_name property on screen', async () => {
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        flushInterval: 0,
      })

      await posthog.screen('test-screen')

      expect((posthog as any).sessionProps).toMatchObject({
        $screen_name: 'test-screen',
      })

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Props)).toEqual(undefined)
    })
  })

  describe('captureAppLifecycleEvents', () => {
    it('should trigger an Application Installed event', async () => {
      // arrange
      const onCapture = jest.fn()

      // act
      posthog = new PostHog('1', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: true,
        customAppProperties: {
          $app_build: '1',
          $app_version: '1.0.0',
        },
      })
      posthog.on('capture', onCapture)

      await waitForExpect(200, () => {
        expect(onCapture).toHaveBeenCalledTimes(2)
        expect(onCapture.mock.calls[0][0]).toMatchObject({
          event: 'Application Installed',
          properties: {
            $app_build: '1',
            $app_version: '1.0.0',
          },
        })
        expect(onCapture.mock.calls[1][0]).toMatchObject({
          event: 'Application Opened',
          properties: {
            $app_build: '1',
            $app_version: '1.0.0',
          },
        })
      })
    })

    it('should trigger an Application Updated event', async () => {
      // arrange
      const onCapture = jest.fn()
      posthog = new PostHog('1', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: true,
        customAppProperties: {
          $app_build: '1',
          $app_version: '1.0.0',
        },
      })
      posthog.on('capture', onCapture)

      await waitForExpect(200, () => {
        expect(onCapture).toHaveBeenCalledTimes(2)
      })

      onCapture.mockClear()
      // act
      posthog = new PostHog('1', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: true,
        customAppProperties: {
          $app_build: '2',
          $app_version: '2.0.0',
        },
      })
      posthog.on('capture', onCapture)

      await waitForExpect(200, () => {
        // assert
        expect(onCapture).toHaveBeenCalledTimes(2)
        expect(onCapture.mock.calls[0][0]).toMatchObject({
          event: 'Application Updated',
          properties: {
            $app_build: '2',
            $app_version: '2.0.0',
            previous_build: '1',
            previous_version: '1.0.0',
          },
        })
        expect(onCapture.mock.calls[1][0]).toMatchObject({
          event: 'Application Opened',
          properties: {
            $app_build: '2',
            $app_version: '2.0.0',
          },
        })
      })
    })

    it('should include the initial url', async () => {
      // arrange
      Linking.getInitialURL = jest.fn(() => Promise.resolve('https://example.com'))
      const onCapture = jest.fn()

      posthog = new PostHog('1', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: true,
        customAppProperties: {
          $app_build: '1',
          $app_version: '1.0.0',
        },
      })
      posthog.on('capture', onCapture)

      await waitForExpect(200, () => {
        expect(onCapture).toHaveBeenCalledTimes(2)
      })

      onCapture.mockClear()

      posthog = new PostHog('1', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: true,
        customAppProperties: {
          $app_build: '1',
          $app_version: '1.0.0',
        },
      })
      posthog.on('capture', onCapture)

      // assert
      await waitForExpect(200, () => {
        expect(onCapture).toHaveBeenCalledTimes(1)
        expect(onCapture.mock.calls[0][0]).toMatchObject({
          event: 'Application Opened',
          properties: {
            $app_build: '1',
            $app_version: '1.0.0',
            url: 'https://example.com',
          },
        })
      })
    })

    it('should track app background and foreground', async () => {
      // arrange
      const onCapture = jest.fn()
      posthog = new PostHog('1', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: true,
        customAppProperties: {
          $app_build: '1',
          $app_version: '1.0.0',
        },
      })
      posthog.on('capture', onCapture)

      await waitForExpect(200, () => {
        expect(onCapture).toHaveBeenCalledTimes(2)
      })

      const cb: (state: AppStateStatus) => void = (AppState.addEventListener as jest.Mock).mock.calls[1][1]

      // act
      cb('background')
      cb('active')

      // assert
      await waitForExpect(200, () => {
        expect(onCapture).toHaveBeenCalledTimes(4)
        expect(onCapture.mock.calls[2][0]).toMatchObject({
          event: 'Application Backgrounded',
          properties: {
            $app_build: '1',
            $app_version: '1.0.0',
          },
        })
        expect(onCapture.mock.calls[3][0]).toMatchObject({
          event: 'Application Became Active',
          properties: {
            $app_build: '1',
            $app_version: '1.0.0',
          },
        })
      })
    })
  })

  describe('async initialization', () => {
    beforeEach(async () => {
      const semiAsyncStorage = createEventsStorage(mockStorage)
      await semiAsyncStorage.preloadPromise
      semiAsyncStorage.setItem(PostHogPersistedProperty.AnonymousId, 'my-anonymous-id')
    })

    it('should allow immediate calls but delay for the stored values', async () => {
      const onCapture = jest.fn()
      mockStorage.setItem(PostHogPersistedProperty.AnonymousId, 'my-anonymous-id')
      posthog = new PostHog('1', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: false,
      })
      posthog.on('capture', onCapture)
      posthog.on('identify', onCapture)

      // Should all be empty as the storage isn't ready
      expect(posthog.getDistinctId()).toEqual('')
      expect(posthog.getAnonymousId()).toEqual('')
      expect(posthog.getSessionId()).toEqual('')

      // Fire multiple calls that have dependencies on one another
      posthog.capture('anonymous event')
      posthog.identify('identified-id')
      posthog.capture('identified event')

      await waitForExpect(200, () => {
        expect(posthog.getDistinctId()).toEqual('identified-id')
        expect(posthog.getAnonymousId()).toEqual('my-anonymous-id')

        expect(onCapture).toHaveBeenCalledTimes(3)
        expect(onCapture.mock.calls[0][0]).toMatchObject({
          event: 'anonymous event',
          distinct_id: 'my-anonymous-id',
        })

        expect(onCapture.mock.calls[1][0]).toMatchObject({
          event: '$identify',
          distinct_id: 'identified-id',
          properties: {
            $anon_distinct_id: 'my-anonymous-id',
          },
        })
        expect(onCapture.mock.calls[2][0]).toMatchObject({
          event: 'identified event',
          distinct_id: 'identified-id',
          properties: {},
        })
      })
    })
  })

  describe('sync initialization', () => {
    let storage: PostHogCustomStorage
    let cache: { [key: string]: any | undefined }
    let rnStorage: PostHogRNStorage

    beforeEach(async () => {
      cache = {}
      storage = {
        getItem: jest.fn((key: string) => cache[key]),
        setItem: jest.fn((key: string, value: string) => {
          cache[key] = value
        }),
      }
      rnStorage = createEventsStorage(storage)
      await rnStorage.preloadPromise
    })

    it('should allow immediate calls without delay for stored values', async () => {
      posthog = new PostHog('1', {
        customStorage: storage,
      })

      // Sync-storage init: feature flags should be readable immediately without
      // awaiting any preload. Specific storage.getItem call count is an
      // implementation detail and not asserted — only that sync behavior holds.
      expect(posthog.getFeatureFlag('flag')).toEqual(undefined)
      posthog.overrideFeatureFlag({
        flag: true,
      })
      expect(posthog.getFeatureFlag('flag')).toEqual(true)

      // New instance but same sync storage — the override persisted via
      // the first instance is visible to the second without preload.
      posthog = new PostHog('1', {
        customStorage: storage,
      })

      expect(posthog.getFeatureFlag('flag')).toEqual(true)
    })

    it('do not rotate session id on restart', async () => {
      const sessionId = '0192244d-a627-7ae2-b22a-ccd594bed71d'
      rnStorage.setItem(PostHogPersistedProperty.SessionId, sessionId)
      const now = Date.now()
      rnStorage.setItem(PostHogPersistedProperty.SessionLastTimestamp, now)
      rnStorage.setItem(PostHogPersistedProperty.SessionStartTimestamp, now)

      posthog = new PostHog('1', {
        customStorage: storage,
        enablePersistSessionIdAcrossRestart: true,
        captureAppLifecycleEvents: false,
      })

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)).toEqual(sessionId)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp)).toEqual(now)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionStartTimestamp)).toEqual(now)
    })

    it('rotate session id on restart if persist session id across restart is disabled', async () => {
      const sessionId = '0192244d-a627-7ae2-b22a-ccd594bed71d'
      rnStorage.setItem(PostHogPersistedProperty.SessionId, sessionId)
      const now = Date.now()
      rnStorage.setItem(PostHogPersistedProperty.SessionLastTimestamp, now)
      rnStorage.setItem(PostHogPersistedProperty.SessionStartTimestamp, now)

      posthog = new PostHog('1', {
        customStorage: storage,
        enablePersistSessionIdAcrossRestart: false,
        captureAppLifecycleEvents: false,
      })

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)).toEqual(undefined)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp)).toEqual(undefined)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionStartTimestamp)).toEqual(undefined)
    })

    it('rotate session id if expired after 30 minutes', async () => {
      const sessionId = '0192244d-a627-7ae2-b22a-ccd594bed71d'
      rnStorage.setItem(PostHogPersistedProperty.SessionId, sessionId)
      const now = Date.now()
      const nowMinus1Hour = JSON.stringify(now - 60 * 60 * 1000)
      const nowMinus45Minutes = JSON.stringify(now - 45 * 60 * 1000)
      rnStorage.setItem(PostHogPersistedProperty.SessionLastTimestamp, nowMinus45Minutes)
      rnStorage.setItem(PostHogPersistedProperty.SessionStartTimestamp, nowMinus1Hour)

      posthog = new PostHog('1', {
        customStorage: storage,
        enablePersistSessionIdAcrossRestart: true,
      })

      const newSessionId = posthog.getSessionId()

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)).not.toEqual(sessionId)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)).toEqual(newSessionId)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp)).not.toEqual(nowMinus45Minutes)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionStartTimestamp)).not.toEqual(nowMinus1Hour)
    })

    it('do not rotate session id if not expired', async () => {
      const sessionId = '0192244d-a627-7ae2-b22a-ccd594bed71d'
      rnStorage.setItem(PostHogPersistedProperty.SessionId, sessionId)
      const now = Date.now()
      const nowMinus1Hour = JSON.stringify(now - 60 * 60 * 1000)
      const nowMinus15Minutes = JSON.stringify(now - 15 * 60 * 1000)
      rnStorage.setItem(PostHogPersistedProperty.SessionLastTimestamp, nowMinus15Minutes)
      rnStorage.setItem(PostHogPersistedProperty.SessionStartTimestamp, nowMinus1Hour)

      posthog = new PostHog('1', {
        customStorage: storage,
        enablePersistSessionIdAcrossRestart: true,
      })

      const currentSessionId = posthog.getSessionId()

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)).toEqual(currentSessionId)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp)).not.toEqual(nowMinus15Minutes)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionStartTimestamp)).toEqual(nowMinus1Hour)
    })

    it('rotate session id if expired after 24 hours', async () => {
      const sessionId = '0192244d-a627-7ae2-b22a-ccd594bed71d'
      rnStorage.setItem(PostHogPersistedProperty.SessionId, sessionId)
      const now = Date.now()
      const nowMinus25Hour = JSON.stringify(now - 25 * 60 * 60 * 1000)
      const nowMinus15Minutes = JSON.stringify(now - 15 * 60 * 1000)
      rnStorage.setItem(PostHogPersistedProperty.SessionLastTimestamp, nowMinus15Minutes)
      rnStorage.setItem(PostHogPersistedProperty.SessionStartTimestamp, nowMinus25Hour)

      posthog = new PostHog('1', {
        customStorage: storage,
        enablePersistSessionIdAcrossRestart: true,
      })

      const newSessionId = posthog.getSessionId()

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)).not.toEqual(sessionId)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)).toEqual(newSessionId)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp)).not.toEqual(nowMinus15Minutes)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionStartTimestamp)).not.toEqual(nowMinus25Hour)
    })

    it('do not rotate session id if not expired after 24 hours', async () => {
      const sessionId = '0192244d-a627-7ae2-b22a-ccd594bed71d'
      rnStorage.setItem(PostHogPersistedProperty.SessionId, sessionId)
      const now = Date.now()
      const nowMinus23Hour = JSON.stringify(now - 23 * 60 * 60 * 1000)
      const nowMinus15Minutes = JSON.stringify(now - 15 * 60 * 1000)
      rnStorage.setItem(PostHogPersistedProperty.SessionLastTimestamp, nowMinus15Minutes)
      rnStorage.setItem(PostHogPersistedProperty.SessionStartTimestamp, nowMinus23Hour)

      posthog = new PostHog('1', {
        customStorage: storage,
        enablePersistSessionIdAcrossRestart: true,
      })

      const currentSessionID = posthog.getSessionId()

      expect(currentSessionID).toEqual(sessionId)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)).toEqual(sessionId)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionStartTimestamp)).toEqual(nowMinus23Hour)
    })
  })

  describe('person and group properties for flags', () => {
    describe('default person properties', () => {
      afterEach(() => {
        jest.restoreAllMocks()
      })

      it('should set default person properties on initialization when enabled', async () => {
        jest.spyOn(PostHog.prototype, 'getCommonEventProperties').mockReturnValue({
          $lib: 'posthog-react-native',
          $lib_version: '1.2.3',
        })

        posthog = new PostHog('test-api-key', {
          setDefaultPersonProperties: true,
          customAppProperties: {
            $app_version: '1.0.0',
            $app_namespace: 'com.example.app',
            $device_type: 'Mobile',
            $os_name: 'iOS',
          },
        })

        await posthog.ready()

        const cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)

        expect(cachedProps).toHaveProperty('$app_version', '1.0.0')
        expect(cachedProps).toHaveProperty('$app_namespace', 'com.example.app')
        expect(cachedProps).toHaveProperty('$device_type', 'Mobile')
        expect(cachedProps).toHaveProperty('$os_name', 'iOS')
        expect(cachedProps.$lib).toBe('posthog-react-native')
        expect(cachedProps.$lib_version).toBe('1.2.3')
      })

      it('should not set default person properties when disabled', async () => {
        posthog = new PostHog('test-api-key', {
          setDefaultPersonProperties: false,
        })
        await posthog.ready()

        const cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)

        expect(cachedProps === undefined || Object.keys(cachedProps).length === 0).toBe(true)
      })

      it('should set default person properties by default (true)', async () => {
        posthog = new PostHog('test-api-key', {
          customAppProperties: {
            $device_type: 'Mobile',
          },
        })
        await posthog.ready()

        const cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)

        expect(cachedProps).toBeTruthy()
        expect(cachedProps).toHaveProperty('$device_type', 'Mobile')
      })

      it('should only include defined properties', async () => {
        posthog = new PostHog('test-api-key', {
          setDefaultPersonProperties: true,
          customAppProperties: {
            $app_version: '1.0.0',
            $app_namespace: 'com.example.app',
            $device_type: 'Mobile',
            $os_name: null,
          },
        })
        await posthog.ready()

        const cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)

        expect(cachedProps).toHaveProperty('$app_version', '1.0.0')
        expect(cachedProps).toHaveProperty('$app_namespace', 'com.example.app')
        expect(cachedProps).toHaveProperty('$device_type', 'Mobile')
        expect(cachedProps).not.toHaveProperty('$os_name')
      })

      it('should restore default properties after reset()', async () => {
        posthog = new PostHog('test-api-key', {
          setDefaultPersonProperties: true,
          customAppProperties: {
            $device_type: 'Mobile',
          },
        })
        await posthog.ready()

        let cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)
        expect(cachedProps).toBeTruthy()
        expect(cachedProps).toHaveProperty('$device_type', 'Mobile')

        posthog.reset()

        cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)
        expect(cachedProps).toBeTruthy()
        expect(cachedProps).toHaveProperty('$device_type', 'Mobile')
      })

      it('should set default properties synchronously during reset without extra reload', async () => {
        jest.spyOn(PostHog.prototype, 'getCommonEventProperties').mockReturnValue({
          $lib: 'posthog-react-native',
          $lib_version: '1.2.3',
        })
        posthog = new PostHog('test-api-key', {
          setDefaultPersonProperties: true,
          customAppProperties: {
            $device_type: 'Mobile',
            $os_name: 'iOS',
          },
          preloadFeatureFlags: false,
        })
        await posthog.ready()
        ;(globalThis as any).window.fetch.mockClear()

        posthog.reset()

        // `reset` reloads flags asynchronously but does not wait for it
        // we wait for the next tick to allow the event loop to process it
        await new Promise((resolve) => setImmediate(resolve))

        const flagsCalls = (globalThis as any).window.fetch.mock.calls.filter((call: any) =>
          call[0].includes('/flags/')
        )
        expect(flagsCalls.length).toBe(1)

        const flagsCallBody = JSON.parse(flagsCalls[0][1].body)
        expect(flagsCallBody.person_properties).toEqual({
          $device_type: 'Mobile',
          $os_name: 'iOS',
          $lib: 'posthog-react-native',
          $lib_version: '1.2.3',
        })
      })

      it('should merge user properties with default properties', async () => {
        posthog = new PostHog('test-api-key', {
          setDefaultPersonProperties: true,
          customAppProperties: {
            $device_type: 'Mobile',
            $app_version: '1.0.0',
          },
        })
        await posthog.ready()

        let cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)
        expect(cachedProps.$device_type).toBe('Mobile')

        posthog.identify('user-123', { $device_type: 'Tablet', email: 'test@example.com' })

        cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)
        expect(cachedProps.$device_type).toBe('Tablet')
        expect(cachedProps.$app_version).toBe('1.0.0')
        expect(cachedProps.email).toBe('test@example.com')
      })
    })

    describe('person properties auto-caching from identify()', () => {
      beforeEach(async () => {
        posthog = new PostHog('test-api-key', {
          setDefaultPersonProperties: false,
        })
        await posthog.ready()
      })

      it('should cache person properties from identify() call', async () => {
        posthog.identify('user-123', { email: 'test@example.com', name: 'Test User' })

        const cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)
        expect(cachedProps).toEqual({ email: 'test@example.com', name: 'Test User' })
      })

      it('should merge person properties from multiple identify() calls', async () => {
        posthog.identify('user-123', { email: 'test@example.com' })
        posthog.identify('user-123', { name: 'Test User' })

        const cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)
        expect(cachedProps).toEqual({ email: 'test@example.com', name: 'Test User' })
      })

      it('should clear person properties on reset()', async () => {
        posthog.identify('user-123', { email: 'test@example.com' })
        expect(posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)).toBeTruthy()

        posthog.reset()
        const cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)
        expect(cachedProps === undefined || Object.keys(cachedProps).length === 0).toBe(true)
      })

      it('should cache properties from $set when provided', async () => {
        posthog.identify('user-123', {
          $set: { email: 'test@example.com', plan: 'premium' },
        })

        const cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)
        expect(cachedProps).toEqual({ email: 'test@example.com', plan: 'premium' })
      })

      it('should cache $set_once properties with set-once semantics', async () => {
        posthog.identify('user-123', {
          $set: { email: 'test@example.com' },
          $set_once: { created_at: '2024-01-01' },
        })

        const cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)
        expect(cachedProps).toEqual({ email: 'test@example.com', created_at: '2024-01-01' })
      })

      it('should not overwrite existing keys via $set_once on subsequent identify calls', async () => {
        posthog.identify('user-123', {
          $set: { email: 'test@example.com' },
          $set_once: { created_at: '2024-01-01' },
        })

        posthog.identify('user-123', {
          $set: { email: 'new@example.com' },
          $set_once: { created_at: '2025-06-15', new_key: 'hello' },
        })

        const cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)
        expect(cachedProps).toEqual({
          email: 'new@example.com',
          created_at: '2024-01-01',
          new_key: 'hello',
        })
      })

      it('should merge properties from multiple identify() calls with $set', async () => {
        posthog.identify('user-123', { $set: { email: 'test@example.com' } })
        posthog.identify('user-123', { $set: { plan: 'premium' } })

        const cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)
        expect(cachedProps).toEqual({ email: 'test@example.com', plan: 'premium' })
      })

      it('should reload flags once when identify() is called with same distinctId and new properties', async () => {
        ;(globalThis as any).window.fetch = jest.fn().mockResolvedValue({ status: 200 })
        posthog = new PostHog('test-api-key', {
          setDefaultPersonProperties: false,
          flushInterval: 0,
          preloadFeatureFlags: false,
        })
        const distinctId = 'user-123'
        jest.spyOn(posthog, 'getDistinctId').mockReturnValue(distinctId)
        await posthog.ready()
        ;(globalThis as any).window.fetch.mockClear()

        posthog.identify(distinctId, { email: 'test@example.com' })

        await new Promise((resolve) => setImmediate(resolve))

        const flagsCalls = (globalThis as any).window.fetch.mock.calls.filter((call: any) =>
          call[0].includes('/flags/')
        )
        expect(flagsCalls.length).toBe(1)
      })

      it('should reload flags once when identify() is called with different distinctId', async () => {
        ;(globalThis as any).window.fetch = jest.fn().mockResolvedValue({ status: 200 })
        posthog = new PostHog('test-api-key', {
          setDefaultPersonProperties: false,
          flushInterval: 0,
          preloadFeatureFlags: false,
        })
        await posthog.ready()
        jest.spyOn(posthog, 'getDistinctId').mockReturnValue('user-123')
        ;(globalThis as any).window.fetch.mockClear()

        posthog.identify('some-new-distinct-id', { email: 'different@example.com' })

        await new Promise((resolve) => setImmediate(resolve))

        const flagsCalls = (globalThis as any).window.fetch.mock.calls.filter((call: any) =>
          call[0].includes('/flags/')
        )
        expect(flagsCalls.length).toBe(1)
      })
    })

    describe('group properties auto-caching from group()', () => {
      beforeEach(async () => {
        posthog = new PostHog('test-api-key', {
          setDefaultPersonProperties: false,
        })
        await posthog.ready()
      })

      it('should cache group properties from group() call', async () => {
        posthog.group('company', 'acme-inc', { name: 'Acme Inc', employees: 50 })

        const cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.GroupProperties)
        expect(cachedProps).toEqual({ company: { name: 'Acme Inc', employees: '50' } })
      })

      it('should merge group properties from multiple group() calls', async () => {
        posthog.group('company', 'acme-inc', { name: 'Acme Inc' })
        posthog.group('company', 'acme-inc', { employees: 50 })

        const cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.GroupProperties)
        expect(cachedProps).toEqual({ company: { name: 'Acme Inc', employees: '50' } })
      })

      it('should handle multiple group types', async () => {
        posthog.group('company', 'acme-inc', { name: 'Acme Inc' })
        posthog.group('project', 'proj-1', { name: 'Project 1' })

        const cachedProps = posthog.getPersistedProperty(PostHogPersistedProperty.GroupProperties)
        expect(cachedProps).toEqual({
          company: { name: 'Acme Inc' },
          project: { name: 'Project 1' },
        })
      })

      it('should clear group properties on reset()', async () => {
        posthog.group('company', 'acme-inc', { name: 'Acme Inc' })
        expect(posthog.getPersistedProperty(PostHogPersistedProperty.GroupProperties)).toBeTruthy()

        posthog.reset()
        expect(posthog.getPersistedProperty(PostHogPersistedProperty.GroupProperties)).toBeUndefined()
      })
    })

    describe('reloadFeatureFlags parameter', () => {
      beforeEach(async () => {
        ;(globalThis as any).window.fetch = jest.fn(async (url) => {
          let res: any = { status: 'ok' }
          if (url.includes('flags')) {
            res = {
              featureFlags: { 'test-flag': true },
            }
          }

          return {
            status: 200,
            json: () => Promise.resolve(res),
          }
        })

        posthog = new PostHog('test-api-key', {
          setDefaultPersonProperties: false,
          flushInterval: 0,
          preloadFeatureFlags: false,
        })
        await posthog.ready()
        ;(globalThis as any).window.fetch.mockClear()
      })

      it('should reload feature flags by default when calling setPersonPropertiesForFlags', async () => {
        posthog.setPersonPropertiesForFlags({ email: 'test@example.com' })

        await waitForExpect(200, () => {
          expect((globalThis as any).window.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/flags/'),
            expect.any(Object)
          )
        })
      })

      it('should not reload feature flags when reloadFeatureFlags is false for setPersonPropertiesForFlags', async () => {
        posthog.setPersonPropertiesForFlags({ email: 'test@example.com' }, false)

        await new Promise((resolve) => setTimeout(resolve, 100))

        expect((globalThis as any).window.fetch).not.toHaveBeenCalled()
      })

      it('should reload feature flags by default when calling setGroupPropertiesForFlags', async () => {
        posthog.setGroupPropertiesForFlags({ company: { name: 'Acme Inc' } })

        await waitForExpect(200, () => {
          expect((globalThis as any).window.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/flags/'),
            expect.any(Object)
          )
        })
      })

      it('should not reload feature flags when reloadFeatureFlags is false for setGroupPropertiesForFlags', async () => {
        posthog.setGroupPropertiesForFlags({ company: { name: 'Acme Inc' } }, false)

        await new Promise((resolve) => setTimeout(resolve, 100))

        expect((globalThis as any).window.fetch).not.toHaveBeenCalled()
      })

      it('should reload feature flags by default when calling resetPersonPropertiesForFlags', async () => {
        posthog.setPersonPropertiesForFlags({ email: 'test@example.com' }, false)
        ;(globalThis as any).window.fetch.mockClear()

        posthog.resetPersonPropertiesForFlags()

        await waitForExpect(200, () => {
          expect((globalThis as any).window.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/flags/'),
            expect.any(Object)
          )
        })
      })

      it('should not reload feature flags when reloadFeatureFlags is false for resetPersonPropertiesForFlags', async () => {
        posthog.setPersonPropertiesForFlags({ email: 'test@example.com' }, false)
        ;(globalThis as any).window.fetch.mockClear()

        posthog.resetPersonPropertiesForFlags(false)

        await new Promise((resolve) => setTimeout(resolve, 100))

        expect((globalThis as any).window.fetch).not.toHaveBeenCalled()
      })

      it('should reload feature flags by default when calling setPersonProperties', async () => {
        posthog.setPersonProperties({ email: 'test@example.com' })

        await waitForExpect(200, () => {
          expect((globalThis as any).window.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/flags/'),
            expect.any(Object)
          )
        })
      })

      it('should not reload feature flags when reloadFeatureFlags is false for setPersonProperties', async () => {
        // Clear any previous calls
        ;(globalThis as any).window.fetch.mockClear()

        posthog.setPersonProperties({ email: 'test@example.com' }, undefined, false)

        // Wait for any async operations
        await new Promise((resolve) => setTimeout(resolve, 100))

        // Should have the batch call for $set event, but not a flags call
        const allCalls = (globalThis as any).window.fetch.mock.calls
        const flagsCalls = allCalls.filter((call: any) => call[0].includes('/flags/'))
        expect(flagsCalls.length).toBe(0)
      })

      it('should reload feature flags by default when calling resetGroupPropertiesForFlags', async () => {
        posthog.setGroupPropertiesForFlags({ company: { name: 'Acme Inc' } }, false)
        ;(globalThis as any).window.fetch.mockClear()

        posthog.resetGroupPropertiesForFlags()

        await waitForExpect(200, () => {
          expect((globalThis as any).window.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/flags/'),
            expect.any(Object)
          )
        })
      })

      it('should not reload feature flags when reloadFeatureFlags is false for resetGroupPropertiesForFlags', async () => {
        posthog.setGroupPropertiesForFlags({ company: { name: 'Acme Inc' } }, false)
        ;(globalThis as any).window.fetch.mockClear()

        posthog.resetGroupPropertiesForFlags(false)

        await new Promise((resolve) => setTimeout(resolve, 100))

        expect((globalThis as any).window.fetch).not.toHaveBeenCalled()
      })
    })

    describe('reset with propertiesToKeep', () => {
      let storage: PostHogCustomStorage
      let cache: Record<string, string>

      beforeEach(async () => {
        cache = {}
        storage = {
          getItem: jest.fn((key: string) => cache[key]),
          setItem: jest.fn((key: string, value: string) => {
            cache[key] = value
          }),
        }
      })

      it('should preserve specified properties when reset is called with propertiesToKeep', async () => {
        posthog = new PostHog('test-api-key', {
          customStorage: storage,
          flushInterval: 0,
          setDefaultPersonProperties: false,
        })
        await posthog.ready()

        posthog.overrideFeatureFlag({ testFlag: true })
        posthog.register({ customProp: 'value' })

        expect(posthog.getPersistedProperty(PostHogPersistedProperty.OverrideFeatureFlags)).toEqual({ testFlag: true })
        expect(posthog.getPersistedProperty(PostHogPersistedProperty.Props)).toEqual({ customProp: 'value' })

        posthog.reset([PostHogPersistedProperty.OverrideFeatureFlags])

        expect(posthog.getPersistedProperty(PostHogPersistedProperty.OverrideFeatureFlags)).toEqual({ testFlag: true })
        expect(posthog.getPersistedProperty(PostHogPersistedProperty.Props)).toEqual(undefined)
      })

      it.each([
        {
          label: 'default (no arg) preserves lifecycle properties',
          resetArg: undefined as PostHogPersistedProperty[] | undefined,
          expectBuild: '1',
          expectVersion: '1.0.0',
        },
        {
          label: 'explicit empty array clears lifecycle properties',
          resetArg: [] as PostHogPersistedProperty[],
          expectBuild: undefined,
          expectVersion: undefined,
        },
      ])('reset with $label', async ({ resetArg, expectBuild, expectVersion }) => {
        posthog = new PostHog('test-api-key', {
          customStorage: storage,
          flushInterval: 0,
          setDefaultPersonProperties: false,
        })
        await posthog.ready()

        posthog.setPersistedProperty(PostHogPersistedProperty.InstalledAppBuild, '1')
        posthog.setPersistedProperty(PostHogPersistedProperty.InstalledAppVersion, '1.0.0')
        posthog.register({ customProp: 'value' })

        posthog.reset(resetArg)

        expect(posthog.getPersistedProperty(PostHogPersistedProperty.Props)).toBeUndefined()
        expect(posthog.getPersistedProperty(PostHogPersistedProperty.InstalledAppBuild)).toEqual(expectBuild)
        expect(posthog.getPersistedProperty(PostHogPersistedProperty.InstalledAppVersion)).toEqual(expectVersion)
      })

      it('should not trigger duplicate Application Installed after reset', async () => {
        // Simulate that the app was previously installed (build/version persisted)
        posthog = new PostHog('test-api-key', {
          customStorage: storage,
          flushInterval: 0,
          setDefaultPersonProperties: false,
          captureAppLifecycleEvents: false,
        })
        await posthog.ready()

        posthog.setPersistedProperty(PostHogPersistedProperty.InstalledAppBuild, '1')
        posthog.setPersistedProperty(PostHogPersistedProperty.InstalledAppVersion, '1.0.0')

        // User logs out - reset without explicit propertiesToKeep
        posthog.reset()

        // Lifecycle properties should still be persisted after reset
        expect(posthog.getPersistedProperty(PostHogPersistedProperty.InstalledAppBuild)).toEqual('1')
        expect(posthog.getPersistedProperty(PostHogPersistedProperty.InstalledAppVersion)).toEqual('1.0.0')

        await posthog.shutdown()

        // Second launch - should NOT fire "Application Installed" again
        const onCapture2 = jest.fn()
        posthog = new PostHog('test-api-key', {
          customStorage: storage,
          captureAppLifecycleEvents: true,
          customAppProperties: {
            $app_build: '1',
            $app_version: '1.0.0',
          },
        })
        posthog.on('capture', onCapture2)
        await posthog.ready()

        await waitForExpect(200, () => {
          expect(onCapture2).toHaveBeenCalledWith(expect.objectContaining({ event: 'Application Opened' }))
        })

        // Should NOT have fired "Application Installed" again
        const installedCalls = onCapture2.mock.calls.filter((call: any[]) => call[0]?.event === 'Application Installed')
        expect(installedCalls).toHaveLength(0)
      })
    })
  })

  describe('device bucketing', () => {
    it('should initialize device_id on first init', async () => {
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
      })

      await posthog.ready()

      const deviceId = posthog.getDeviceId()
      expect(deviceId).toBeTruthy()
      expect(deviceId).toEqual(posthog.getAnonymousId())
    })

    it('should persist device_id across SDK restarts', async () => {
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
      })
      await posthog.ready()

      const originalDeviceId = posthog.getDeviceId()
      await posthog.shutdown()

      // Re-init with same storage
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
      })
      await posthog.ready()

      expect(posthog.getDeviceId()).toEqual(originalDeviceId)
    })

    it('should preserve device_id across identify()', async () => {
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
      })
      await posthog.ready()

      const originalDeviceId = posthog.getDeviceId()
      posthog.identify('user-123')

      expect(posthog.getDeviceId()).toEqual(originalDeviceId)
      expect(posthog.getDistinctId()).toEqual('user-123')
    })

    it('should preserve device_id across reset()', async () => {
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
      })
      await posthog.ready()

      const originalDeviceId = posthog.getDeviceId()
      posthog.identify('user-123')
      posthog.reset()

      expect(posthog.getDeviceId()).toEqual(originalDeviceId)
      // distinct_id should have changed
      expect(posthog.getDistinctId()).not.toEqual('user-123')
    })

    it('should regenerate device_id when reset is called with explicit propertiesToKeep omitting DeviceId', async () => {
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
      })
      await posthog.ready()

      const originalDeviceId = posthog.getDeviceId()
      // Passing an explicit list without DeviceId causes it to be cleared
      posthog.reset([])

      await waitForExpect(200, () => {
        const newDeviceId = posthog.getDeviceId()
        expect(newDeviceId).toBeTruthy()
        expect(newDeviceId).not.toEqual(originalDeviceId)
      })
    })

    it('should send $device_id in feature flag requests', async () => {
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
      })
      await posthog.ready()

      const deviceId = posthog.getDeviceId()
      await posthog.reloadFeatureFlagsAsync()

      expect((globalThis as any).window.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/flags/'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining(`"$device_id":"${deviceId}"`),
        })
      )
    })

    it('should send the same $device_id after identify()', async () => {
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
      })
      await posthog.ready()

      const deviceId = posthog.getDeviceId()
      posthog.identify('user-123')
      await posthog.reloadFeatureFlagsAsync()

      expect((globalThis as any).window.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/flags/'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining(`"$device_id":"${deviceId}"`),
        })
      )
    })

    it('should lazy-init device_id for upgrades via getDeviceId()', async () => {
      // Simulate an upgrade: existing install has anonymous_id persisted but no device_id.
      // PostHogRNStorage stores all properties in a single JSON blob under '.posthog-rn.json'.
      const upgradeData = JSON.stringify({
        version: 'v1',
        content: { [PostHogPersistedProperty.AnonymousId]: 'existing-anon-id' },
      })
      cache['.posthog-rn.json'] = upgradeData

      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
      })
      await posthog.ready()

      // device_id should be set to the existing anonymous_id during initAfterStorage
      expect(posthog.getDeviceId()).toEqual('existing-anon-id')
      expect(posthog.getAnonymousId()).toEqual('existing-anon-id')
    })
  })

  // Hybrid storage routing: `PostHogPersistedProperty.LogsQueue` routes to
  // a dedicated `_logsStorage` instance backed by `.posthog-rn-logs.json`,
  // while every other enum key stays in `_eventsStorage` backed by
  // `.posthog-rn.json`. These tests lock in the routing invariants.
  describe('logs storage routing', () => {
    it('routes LogsQueue to _logsStorage and other keys to _eventsStorage (bidirectional)', async () => {
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
      })
      await posthog.ready()

      posthog.setPersistedProperty(PostHogPersistedProperty.Queue, ['event1'])
      posthog.setPersistedProperty(PostHogPersistedProperty.LogsQueue, ['log1'])

      // Reads via the instance API
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Queue)).toEqual(['event1'])
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.LogsQueue)).toEqual(['log1'])

      // Verify each value landed in its expected storage's memoryCache
      const eventsMemoryCache = (posthog as any)._eventsStorage.memoryCache
      const logsMemoryCache = (posthog as any)._logsStorage.memoryCache

      expect(eventsMemoryCache[PostHogPersistedProperty.Queue]).toEqual(['event1'])
      expect(logsMemoryCache[PostHogPersistedProperty.LogsQueue]).toEqual(['log1'])

      // Cross-contamination check
      expect(eventsMemoryCache[PostHogPersistedProperty.LogsQueue]).toBeUndefined()
      expect(logsMemoryCache[PostHogPersistedProperty.Queue]).toBeUndefined()
    })

    it('routes non-LogsQueue keys to _eventsStorage, not _logsStorage', async () => {
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
      })
      await posthog.ready()

      posthog.setPersistedProperty(PostHogPersistedProperty.DistinctId, 'user-abc')
      posthog.setPersistedProperty(PostHogPersistedProperty.SessionId, 'sess-xyz')

      const eventsMemoryCache = (posthog as any)._eventsStorage.memoryCache
      const logsMemoryCache = (posthog as any)._logsStorage.memoryCache

      // Non-queue keys land in events storage
      expect(eventsMemoryCache[PostHogPersistedProperty.DistinctId]).toBe('user-abc')
      expect(eventsMemoryCache[PostHogPersistedProperty.SessionId]).toBe('sess-xyz')

      // Logs storage stays untouched by non-logs keys
      expect(logsMemoryCache[PostHogPersistedProperty.DistinctId]).toBeUndefined()
      expect(logsMemoryCache[PostHogPersistedProperty.SessionId]).toBeUndefined()
    })

    it('writes LogsQueue to .posthog-rn-logs.json and not to .posthog-rn.json', async () => {
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
      })
      await posthog.ready()

      posthog.setPersistedProperty(PostHogPersistedProperty.LogsQueue, [{ record: { body: { stringValue: 'test' } } }])

      // Let async persist complete on the logs storage
      await (posthog as any)._logsStorage.waitForPersist()

      const logsFile = cache['.posthog-rn-logs.json']
      const mainFile = cache['.posthog-rn.json']

      expect(logsFile).toBeDefined()
      const logsParsed = JSON.parse(logsFile)
      expect(logsParsed.content[PostHogPersistedProperty.LogsQueue]).toHaveLength(1)
      expect(logsParsed.content[PostHogPersistedProperty.LogsQueue][0].record.body.stringValue).toBe('test')

      // Main file should not contain the logs queue — either the key isn't there
      // or the main file wasn't written at all (depends on whether init wrote anything else)
      if (mainFile) {
        const mainParsed = JSON.parse(mainFile)
        expect(mainParsed.content[PostHogPersistedProperty.LogsQueue]).toBeUndefined()
      }
    })

    it('reset() preserves both Queue and LogsQueue', async () => {
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
      })
      await posthog.ready()

      posthog.setPersistedProperty(PostHogPersistedProperty.Queue, ['event1'])
      posthog.setPersistedProperty(PostHogPersistedProperty.LogsQueue, ['log1'])
      // Also set something that SHOULD be cleared by reset
      posthog.setPersistedProperty(PostHogPersistedProperty.DistinctId, 'user-123')

      posthog.reset()

      // In-flight events and logs survive reset
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Queue)).toEqual(['event1'])
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.LogsQueue)).toEqual(['log1'])
      // Regular state is cleared
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.DistinctId)).toBeUndefined()
    })

    it('setPersistedProperty(LogsQueue, null) removes from logs storage, not main storage', async () => {
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
      })
      await posthog.ready()

      posthog.setPersistedProperty(PostHogPersistedProperty.LogsQueue, ['log1'])
      posthog.setPersistedProperty(PostHogPersistedProperty.DistinctId, 'user-123')

      // Null routes to removeItem on the correct storage
      posthog.setPersistedProperty(PostHogPersistedProperty.LogsQueue, null)

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.LogsQueue)).toBeUndefined()
      // DistinctId in main storage is untouched
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.DistinctId)).toBe('user-123')
    })

    // End-to-end: real PostHog instance → real _logs module → real routing → real storage.
    // Unit tests use a mock instance; routing tests don't use _logs. This covers the seam.
    it('captureLog via _logs module lands in logs storage through real routing', async () => {
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
      })
      await posthog.ready()
      // Ensure logs storage preload completes before calling captureLog so
      // the capture goes through the direct read-mutate-write path, not the
      // pending-buffer path (which is tested separately in logs.spec.ts).
      await (posthog as any)._logsStorage.preloadPromise
      ;(posthog as any)._logs.captureLog({ body: 'hello' })

      const logsQueue = posthog.getPersistedProperty(PostHogPersistedProperty.LogsQueue) as
        | Array<{ record: { body: { stringValue: string } } }>
        | undefined
      expect(logsQueue).toHaveLength(1)
      expect(logsQueue?.[0].record.body.stringValue).toBe('hello')

      // Main storage's events queue should be untouched by captureLog
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Queue)).toBeUndefined()
    })

    it('AppState change drains both events and logs pipelines in parallel', async () => {
      posthog = new PostHog('test-token', {
        customStorage: mockStorage,
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
      })
      await posthog.ready()

      const flushSpy = jest.spyOn(posthog, 'flush').mockResolvedValue(undefined)
      const flushLogsSpy = jest.spyOn(posthog as any, 'flushLogs').mockResolvedValue(undefined as never)

      // AppState.addEventListener is globally mocked; grab the callback that
      // was passed to it during PostHog construction and invoke it manually.
      const calls = (AppState.addEventListener as jest.Mock).mock.calls
      const changeCall = calls.find((c) => c[0] === 'change')
      expect(changeCall).toBeDefined()
      const callback = changeCall![1]

      callback('background' as AppStateStatus)

      expect(flushSpy).toHaveBeenCalled()
      expect(flushLogsSpy).toHaveBeenCalled()

      flushSpy.mockRestore()
      flushLogsSpy.mockRestore()
    })
  })
})

describe('Feature flag error tracking', () => {
  let posthog: PostHog

  beforeEach(() => {
    ;(globalThis as any).window.fetch = jest.fn()
    posthog = new PostHog('test-api-key', {
      flushAt: 1,
      host: 'https://app.posthog.com',
      fetchRetryCount: 0,
      preloadFeatureFlags: false,
      sendFeatureFlagEvent: true,
      captureAppLifecycleEvents: false,
    })
  })

  afterEach(async () => {
    ;(globalThis as any).window.fetch = undefined
    posthog.setPersistedProperty(PostHogPersistedProperty.FeatureFlagDetails, null)
    posthog.setPersistedProperty(PostHogPersistedProperty.FlagsEndpointWasHit, null)
    await posthog.shutdown()
  })

  it('should set $feature_flag_error to flag_missing when flag is not in response', async () => {
    ;(globalThis as any).window.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/flags/')) {
        return Promise.resolve({
          status: 200,
          json: () =>
            Promise.resolve({
              flags: {
                'other-flag': {
                  key: 'other-flag',
                  enabled: true,
                  variant: undefined,
                  reason: undefined,
                  metadata: { id: 1, version: 1, payload: undefined, description: undefined },
                },
              },
              errorsWhileComputingFlags: false,
              requestId: 'test-request-id',
              evaluatedAt: Date.now(),
            }),
        })
      }
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ status: 'ok' }) })
    })

    await posthog.reloadFeatureFlagsAsync()

    // Access a non-existent flag
    posthog.getFeatureFlag('non-existent-flag')

    await waitForExpect(500, () => {
      const calls = ((globalThis as any).window.fetch as jest.Mock).mock.calls
      const captureCall = calls.find((call: any[]) => call[0].includes('/batch'))
      expect(captureCall).toBeDefined()
      const body = JSON.parse(captureCall[1].body)
      const featureFlagEvent = body.batch.find((e: any) => e.event === '$feature_flag_called')
      expect(featureFlagEvent).toBeDefined()
      expect(featureFlagEvent.properties.$feature_flag_error).toBe(FeatureFlagError.FLAG_MISSING)
    })
  })

  it('should set $feature_flag_error to errors_while_computing_flags when server returns that flag', async () => {
    ;(globalThis as any).window.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/flags/')) {
        return Promise.resolve({
          status: 200,
          json: () =>
            Promise.resolve({
              flags: {
                'some-flag': {
                  key: 'some-flag',
                  enabled: true,
                  variant: undefined,
                  reason: undefined,
                  metadata: { id: 1, version: 1, payload: undefined, description: undefined },
                },
              },
              errorsWhileComputingFlags: true,
              requestId: 'test-request-id',
              evaluatedAt: Date.now(),
            }),
        })
      }
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ status: 'ok' }) })
    })

    await posthog.reloadFeatureFlagsAsync()

    // Access the flag that exists
    posthog.getFeatureFlag('some-flag')

    await waitForExpect(500, () => {
      const calls = ((globalThis as any).window.fetch as jest.Mock).mock.calls
      const captureCall = calls.find((call: any[]) => call[0].includes('/batch'))
      expect(captureCall).toBeDefined()
      const body = JSON.parse(captureCall[1].body)
      const featureFlagEvent = body.batch.find((e: any) => e.event === '$feature_flag_called')
      expect(featureFlagEvent).toBeDefined()
      expect(featureFlagEvent.properties.$feature_flag_error).toBe(FeatureFlagError.ERRORS_WHILE_COMPUTING)
    })
  })

  it('should set $feature_flag_error to quota_limited when quota limited', async () => {
    ;(globalThis as any).window.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/flags/')) {
        return Promise.resolve({
          status: 200,
          json: () =>
            Promise.resolve({
              flags: {},
              errorsWhileComputingFlags: false,
              quotaLimited: ['feature_flags'],
              requestId: 'test-request-id',
              evaluatedAt: Date.now(),
            }),
        })
      }
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ status: 'ok' }) })
    })

    await posthog.reloadFeatureFlagsAsync()

    // Access any flag when quota limited (no cached flags exist)
    const result = posthog.getFeatureFlag('any-flag')
    expect(result).toBeUndefined()

    await waitForExpect(500, () => {
      const calls = ((globalThis as any).window.fetch as jest.Mock).mock.calls
      const captureCall = calls.find((call: any[]) => call[0].includes('/batch'))
      expect(captureCall).toBeDefined()
      const body = JSON.parse(captureCall[1].body)
      const featureFlagEvent = body.batch.find((e: any) => e.event === '$feature_flag_called')
      expect(featureFlagEvent).toBeDefined()
      // FLAG_MISSING is not tracked when quota limited since we cannot determine if the flag is truly missing
      expect(featureFlagEvent.properties.$feature_flag_error).toBe(FeatureFlagError.QUOTA_LIMITED)
    })
  })

  it('should set $feature_flag_error to api_error_500 when request fails with 500', async () => {
    // First, let the initial setup succeed
    ;(globalThis as any).window.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/flags/')) {
        return Promise.resolve({
          status: 500,
          json: () => Promise.reject(new Error('Server error')),
        })
      }
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ status: 'ok' }) })
    })

    await posthog.reloadFeatureFlagsAsync()

    // Access a flag when request failed
    posthog.getFeatureFlag('any-flag')

    await waitForExpect(500, () => {
      const calls = ((globalThis as any).window.fetch as jest.Mock).mock.calls
      const captureCall = calls.find((call: any[]) => call[0].includes('/batch'))
      expect(captureCall).toBeDefined()
      const body = JSON.parse(captureCall[1].body)
      const featureFlagEvent = body.batch.find((e: any) => e.event === '$feature_flag_called')
      expect(featureFlagEvent).toBeDefined()
      expect(featureFlagEvent.properties.$feature_flag_error).toBe(FeatureFlagError.apiError(500))
    })
  })

  it('should join multiple errors with commas', async () => {
    ;(globalThis as any).window.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/flags/')) {
        return Promise.resolve({
          status: 200,
          json: () =>
            Promise.resolve({
              flags: {},
              errorsWhileComputingFlags: true,
              requestId: 'test-request-id',
              evaluatedAt: Date.now(),
            }),
        })
      }
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ status: 'ok' }) })
    })

    await posthog.reloadFeatureFlagsAsync()

    // Access a non-existent flag when errors while computing
    posthog.getFeatureFlag('missing-flag')

    await waitForExpect(500, () => {
      const calls = ((globalThis as any).window.fetch as jest.Mock).mock.calls
      const captureCall = calls.find((call: any[]) => call[0].includes('/batch'))
      expect(captureCall).toBeDefined()
      const body = JSON.parse(captureCall[1].body)
      const featureFlagEvent = body.batch.find((e: any) => e.event === '$feature_flag_called')
      expect(featureFlagEvent).toBeDefined()
      expect(featureFlagEvent.properties.$feature_flag_error).toBe(
        `${FeatureFlagError.ERRORS_WHILE_COMPUTING},${FeatureFlagError.FLAG_MISSING}`
      )
    })
  })

  it('should not set $feature_flag_error when flag is found successfully', async () => {
    ;(globalThis as any).window.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/flags/')) {
        return Promise.resolve({
          status: 200,
          json: () =>
            Promise.resolve({
              flags: {
                'my-flag': {
                  key: 'my-flag',
                  enabled: true,
                  variant: undefined,
                  reason: undefined,
                  metadata: { id: 1, version: 1, payload: undefined, description: undefined },
                },
              },
              errorsWhileComputingFlags: false,
              requestId: 'test-request-id',
              evaluatedAt: Date.now(),
            }),
        })
      }
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ status: 'ok' }) })
    })

    await posthog.reloadFeatureFlagsAsync()

    // Access the existing flag
    const result = posthog.getFeatureFlag('my-flag')
    expect(result).toBe(true)

    await waitForExpect(500, () => {
      const calls = ((globalThis as any).window.fetch as jest.Mock).mock.calls
      const captureCall = calls.find((call: any[]) => call[0].includes('/batch'))
      expect(captureCall).toBeDefined()
      const body = JSON.parse(captureCall[1].body)
      const featureFlagEvent = body.batch.find((e: any) => e.event === '$feature_flag_called')
      expect(featureFlagEvent).toBeDefined()
      // $feature_flag_error should not be present
      expect(featureFlagEvent.properties.$feature_flag_error).toBeUndefined()
    })
  })
})
