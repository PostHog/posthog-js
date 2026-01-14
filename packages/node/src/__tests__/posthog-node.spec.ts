import { PostHog, PostHogOptions } from '@/entrypoints/index.node'
import { anyFlagsCall, anyLocalEvalCall, apiImplementation, isPending, wait, waitForPromises } from './utils'
import { randomUUID } from 'crypto'

jest.mock('../version', () => ({ version: '1.2.3' }))

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

const posthogImmediateResolveOptions: PostHogOptions = {
  fetchRetryCount: 0,
}

const waitForFlushTimer = async (): Promise<void> => {
  await waitForPromises()
  // To trigger the flush via the timer
  jest.runOnlyPendingTimers()
  // Then wait for the flush promise
  await waitForPromises()
}

const getLastBatchEvents = (): any[] | undefined => {
  expect(mockedFetch).toHaveBeenCalledWith('http://example.com/batch/', expect.objectContaining({ method: 'POST' }))

  // reverse mock calls array to get the last call
  const call = mockedFetch.mock.calls.reverse().find((x) => (x[0] as string).includes('/batch/'))
  if (!call) {
    return undefined
  }
  return JSON.parse((call[1] as any).body as any).batch
}

jest.retryTimes(3)

describe('PostHog Node.js', () => {
  let posthog: PostHog

  let warnSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance
  let infoSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  jest.useFakeTimers()

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      fetchRetryCount: 0,
      disableCompression: true,
    })

    mockedFetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('ok'),
      json: () =>
        Promise.resolve({
          status: 'ok',
        }),
    } as any)
  })

  afterEach(async () => {
    mockedFetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('ok'),
      json: () =>
        Promise.resolve({
          status: 'ok',
        }),
    } as any)

    // ensure clean shutdown & no test interdependencies
    await posthog.shutdown()
    warnSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  describe('core methods', () => {
    it('should capture an event to shared queue', async () => {
      expect(mockedFetch).toHaveBeenCalledTimes(0)
      posthog.capture({ distinctId: '123', event: 'test-event', properties: { foo: 'bar' }, groups: { org: 123 } })

      await waitForFlushTimer()

      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toEqual([
        {
          distinct_id: '123',
          event: 'test-event',
          properties: {
            $groups: { org: 123 },
            foo: 'bar',
            $geoip_disable: true,
            $lib: 'posthog-node',
            $lib_version: '1.2.3',
          },
          uuid: expect.any(String),
          timestamp: expect.any(String),
          type: 'capture',
          library: 'posthog-node',
          library_version: '1.2.3',
        },
      ])
    })

    it('shouldnt muddy subsequent capture calls', async () => {
      expect(mockedFetch).toHaveBeenCalledTimes(0)
      posthog.capture({ distinctId: '123', event: 'test-event', properties: { foo: 'bar' }, groups: { org: 123 } })

      await waitForFlushTimer()
      expect(getLastBatchEvents()?.[0]).toEqual(
        expect.objectContaining({
          distinct_id: '123',
          event: 'test-event',
          properties: expect.objectContaining({
            $groups: { org: 123 },
            foo: 'bar',
          }),
          library: 'posthog-node',
          library_version: '1.2.3',
        })
      )
      mockedFetch.mockClear()

      posthog.capture({
        distinctId: '123',
        event: 'test-event',
        properties: { foo: 'bar' },
        groups: { other_group: 'x' },
      })

      await waitForFlushTimer()
      expect(getLastBatchEvents()?.[0]).toEqual(
        expect.objectContaining({
          distinct_id: '123',
          event: 'test-event',
          properties: expect.objectContaining({
            $groups: { other_group: 'x' },
            foo: 'bar',
            $geoip_disable: true,
          }),
          library: 'posthog-node',
          library_version: '1.2.3',
        })
      )
    })

    it('should capture identify events on shared queue', async () => {
      expect(mockedFetch).toHaveBeenCalledTimes(0)
      posthog.identify({ distinctId: '123', properties: { foo: 'bar' } })
      jest.runOnlyPendingTimers()
      await waitForPromises()

      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toMatchObject([
        {
          distinct_id: '123',
          event: '$identify',
          properties: {
            $set: {
              foo: 'bar',
            },
            $geoip_disable: true,
          },
        },
      ])
    })

    it('should handle identify using $set and $set_once', async () => {
      expect(mockedFetch).toHaveBeenCalledTimes(0)
      posthog.identify({ distinctId: '123', properties: { $set: { foo: 'bar' }, $set_once: { vip: true } } })
      jest.runOnlyPendingTimers()
      await waitForPromises()
      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toMatchObject([
        {
          distinct_id: '123',
          event: '$identify',
          properties: {
            $set: {
              foo: 'bar',
            },
            $set_once: {
              vip: true,
            },
            $geoip_disable: true,
          },
        },
      ])
    })

    it('should handle identify using $set_once', async () => {
      expect(mockedFetch).toHaveBeenCalledTimes(0)
      posthog.identify({ distinctId: '123', properties: { foo: 'bar', $set_once: { vip: true } } })
      jest.runOnlyPendingTimers()
      await waitForPromises()
      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toMatchObject([
        {
          distinct_id: '123',
          event: '$identify',
          properties: {
            $set: {
              foo: 'bar',
            },
            $set_once: {
              vip: true,
            },
            $geoip_disable: true,
          },
        },
      ])
    })

    it('should capture alias events on shared queue', async () => {
      expect(mockedFetch).toHaveBeenCalledTimes(0)
      posthog.alias({ distinctId: '123', alias: '1234' })
      jest.runOnlyPendingTimers()
      await waitForPromises()
      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toMatchObject([
        {
          distinct_id: '123',
          event: '$create_alias',
          properties: {
            distinct_id: '123',
            alias: '1234',
            $geoip_disable: true,
          },
        },
      ])
    })

    it('should allow overriding timestamp', async () => {
      expect(mockedFetch).toHaveBeenCalledTimes(0)
      posthog.capture({ event: 'custom-time', distinctId: '123', timestamp: new Date('2021-02-03') })
      await waitForFlushTimer()
      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toMatchObject([
        {
          distinct_id: '123',
          timestamp: '2021-02-03T00:00:00.000Z',
          event: 'custom-time',
          uuid: expect.any(String),
        },
      ])
    })

    it('should allow overriding uuid', async () => {
      expect(mockedFetch).toHaveBeenCalledTimes(0)
      const uuid = randomUUID()
      posthog.capture({ event: 'custom-time', distinctId: '123', uuid })
      await waitForFlushTimer()
      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toMatchObject([
        {
          distinct_id: '123',
          timestamp: expect.any(String),
          event: 'custom-time',
          uuid: uuid,
        },
      ])
    })

    it('should respect disableGeoip setting if passed in', async () => {
      expect(mockedFetch).toHaveBeenCalledTimes(0)
      posthog.capture({
        distinctId: '123',
        event: 'test-event',
        properties: { foo: 'bar' },
        groups: { org: 123 },
        disableGeoip: false,
      })

      await waitForFlushTimer()
      const batchEvents = getLastBatchEvents()
      expect(batchEvents?.[0].properties).toEqual({
        $groups: { org: 123 },
        foo: 'bar',
        $lib: 'posthog-node',
        $lib_version: '1.2.3',
      })
    })

    it('should use default is set, and override on specific disableGeoip calls', async () => {
      expect(mockedFetch).toHaveBeenCalledTimes(0)
      const client = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        disableGeoip: false,
        disableCompression: true,
      })
      client.capture({ distinctId: '123', event: 'test-event', properties: { foo: 'bar' }, groups: { org: 123 } })

      await waitForFlushTimer()

      let batchEvents = getLastBatchEvents()
      expect(batchEvents?.[0].properties).toEqual({
        $groups: { org: 123 },
        foo: 'bar',
        $lib: 'posthog-node',
        $lib_version: '1.2.3',
      })

      client.capture({
        distinctId: '123',
        event: 'test-event',
        properties: { foo: 'bar' },
        groups: { org: 123 },
        disableGeoip: true,
      })

      await waitForFlushTimer()

      batchEvents = getLastBatchEvents()
      expect(batchEvents?.[0].properties).toEqual({
        $groups: { org: 123 },
        foo: 'bar',
        $lib: 'posthog-node',
        $lib_version: '1.2.3',
        $geoip_disable: true,
      })

      client.capture({
        distinctId: '123',
        event: 'test-event',
        properties: { foo: 'bar' },
        groups: { org: 123 },
        disableGeoip: false,
      })

      await waitForFlushTimer()
      await waitForPromises()

      batchEvents = getLastBatchEvents()
      expect(batchEvents?.[0].properties).toEqual({
        $groups: { org: 123 },
        foo: 'bar',
        $lib: 'posthog-node',
        $lib_version: '1.2.3',
      })

      await client.shutdown()
    })

    it('should warn if capture is called with a string', () => {
      posthog.debug(true)
      // @ts-expect-error - Testing the warning when passing a string instead of an object
      posthog.capture('test-event')
      expect(warnSpy).toHaveBeenCalledWith(
        '[PostHog]',
        'Called capture() with a string as the first argument when an object was expected.'
      )
      warnSpy.mockRestore()
    })
  })

  describe('before_send', () => {
    it('should allow events through when before_send returns the event', async () => {
      const beforeSendFn = jest.fn((event) => event)
      const ph = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        disableCompression: true,
        before_send: beforeSendFn,
      })

      ph.capture({ distinctId: '123', event: 'test-event', properties: { foo: 'bar' } })
      await waitForFlushTimer()

      expect(beforeSendFn).toHaveBeenCalledTimes(1)
      expect(beforeSendFn).toHaveBeenCalledWith({
        distinctId: '123',
        event: 'test-event',
        properties: { foo: 'bar' },
        groups: undefined,
        sendFeatureFlags: undefined,
        timestamp: undefined,
        disableGeoip: undefined,
        uuid: undefined,
      })

      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toHaveLength(1)
      expect(batchEvents![0]).toMatchObject({
        distinct_id: '123',
        event: 'test-event',
        properties: expect.objectContaining({ foo: 'bar' }),
      })
    })

    it('should drop events when before_send returns null', async () => {
      const beforeSendFn = jest.fn(() => null)
      const ph = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        disableCompression: true,
        before_send: beforeSendFn,
      })

      ph.capture({ distinctId: '123', event: 'test-event', properties: { foo: 'bar' } })
      await waitForFlushTimer()

      expect(beforeSendFn).toHaveBeenCalledTimes(1)
      expect(mockedFetch).not.toHaveBeenCalledWith('http://example.com/batch/', expect.anything())
    })

    it('should support array of before_send functions', async () => {
      const beforeSend1 = jest.fn((event) => ({ ...event, properties: { ...event.properties, added1: true } }))
      const beforeSend2 = jest.fn((event) => ({ ...event, properties: { ...event.properties, added2: true } }))

      const ph = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        disableCompression: true,
        before_send: [beforeSend1, beforeSend2],
      })

      ph.capture({ distinctId: '123', event: 'test-event', properties: { foo: 'bar' } })
      await waitForFlushTimer()

      expect(beforeSend1).toHaveBeenCalledTimes(1)
      expect(beforeSend2).toHaveBeenCalledTimes(1)

      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toHaveLength(1)
      expect(batchEvents![0]).toMatchObject({
        distinct_id: '123',
        event: 'test-event',
        properties: expect.objectContaining({ foo: 'bar', added1: true, added2: true }),
      })
    })

    it('should stop processing if any before_send returns null', async () => {
      const beforeSend1 = jest.fn((event) => event)
      const beforeSend2 = jest.fn(() => null)
      const beforeSend3 = jest.fn((event) => event)

      const ph = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        disableCompression: true,
        before_send: [beforeSend1, beforeSend2, beforeSend3],
      })

      ph.capture({ distinctId: '123', event: 'test-event', properties: { foo: 'bar' } })
      await waitForFlushTimer()

      expect(beforeSend1).toHaveBeenCalledTimes(1)
      expect(beforeSend2).toHaveBeenCalledTimes(1)
      expect(beforeSend3).not.toHaveBeenCalled()
      expect(mockedFetch).not.toHaveBeenCalledWith('http://example.com/batch/', expect.anything())
    })

    it('should work with captureImmediate', async () => {
      const beforeSendFn = jest.fn((event) => ({ ...event, event: 'modified-event' }))
      const ph = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        disableCompression: true,
        before_send: beforeSendFn,
      })

      await ph.captureImmediate({ distinctId: '123', event: 'test-event', properties: { foo: 'bar' } })

      expect(beforeSendFn).toHaveBeenCalledTimes(1)
      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toHaveLength(1)
      expect(batchEvents![0]).toMatchObject({
        distinct_id: '123',
        event: 'modified-event',
        properties: expect.objectContaining({ foo: 'bar' }),
      })
    })

    it('should log when event is dropped in debug mode', async () => {
      const beforeSendFn = jest.fn(() => null)
      const ph = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        disableCompression: true,
        before_send: beforeSendFn,
      })
      ph.debug(true)

      ph.capture({ distinctId: '123', event: 'test-event' })
      await waitForFlushTimer()

      expect(logSpy).toHaveBeenCalledWith('[PostHog]', "Event 'test-event' was rejected in beforeSend function")
      logSpy.mockRestore()
    })
  })

  describe('shutdown', () => {
    beforeEach(() => {
      mockedFetch.mockImplementation(async () => {
        // simulate network delay
        await wait(500)

        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () =>
            Promise.resolve({
              status: 'ok',
            }),
        } as any)
      })

      jest.useRealTimers()
    })

    afterEach(() => {
      jest.useFakeTimers()
    })

    it('should shutdown cleanly', async () => {
      const ph = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        flushAt: 1,
        disableCompression: true,
      })
      ph.debug(true)

      ph.capture({ event: 'test-event-1', distinctId: '123' })

      // start flushing, but don't wait for promise to resolve before resuming events
      const flushPromise = ph.flush()
      expect(isPending(flushPromise)).toEqual(true)

      ph.capture({ event: 'test-event-2', distinctId: '123' })

      // start shutdown, but don't wait for promise to resolve before resuming events
      const shutdownPromise = ph.shutdown()

      ph.capture({ event: 'test-event-3', distinctId: '123' })

      // wait for shutdown to finish
      await shutdownPromise
      expect(isPending(flushPromise)).toEqual(false)

      expect(3).toEqual(logSpy.mock.calls.filter((call) => call[1].includes('capture')).length)
      const flushedEvents = logSpy.mock.calls.filter((call) => call[1].includes('flush')).flatMap((flush) => flush[2])
      expect(flushedEvents).toMatchObject([
        { event: 'test-event-1' },
        { event: 'test-event-2' },
        { event: 'test-event-3' },
      ])
    })

    it('should shutdown cleanly with pending capture flag promises', async () => {
      const ph = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        flushAt: 4,
        disableCompression: true,
      })
      ph.debug(true)

      for (let i = 0; i < 10; i++) {
        ph.capture({ event: 'test-event', distinctId: `${i}`, sendFeatureFlags: true })
      }

      await ph.shutdown()
      // all capture calls happen during shutdown
      const batchEvents = getLastBatchEvents()
      expect(batchEvents?.length).toEqual(6)
      expect(batchEvents?.[batchEvents?.length - 1]).toMatchObject({
        // last event in batch
        distinct_id: '9',
        event: 'test-event',
        library: 'posthog-node',
        library_version: '1.2.3',
        properties: {
          $lib: 'posthog-node',
          $lib_version: '1.2.3',
          $geoip_disable: true,
        },
        timestamp: expect.any(String),
        type: 'capture',
      })
      expect(10).toEqual(logSpy.mock.calls.filter((call) => call[1].includes('capture')).length)
      // 1 for the captured events, 1 for the final flush of feature flag called events
      expect(2).toEqual(logSpy.mock.calls.filter((call) => call[1].includes('flush')).length)
    })
  })

  describe('groupIdentify', () => {
    it('should identify group with unique id', async () => {
      posthog.groupIdentify({ groupType: 'posthog', groupKey: 'team-1', properties: { analytics: true } })
      jest.runOnlyPendingTimers()
      await posthog.flush()
      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toMatchObject([
        {
          distinct_id: '$posthog_team-1',
          event: '$groupidentify',
          properties: {
            $group_type: 'posthog',
            $group_key: 'team-1',
            $group_set: { analytics: true },
            $lib: 'posthog-node',
            $geoip_disable: true,
          },
        },
      ])
    })

    it('should allow passing optional distinctID to identify group', async () => {
      posthog.groupIdentify({
        groupType: 'posthog',
        groupKey: 'team-1',
        properties: { analytics: true },
        distinctId: '123',
      })
      jest.runOnlyPendingTimers()
      await posthog.flush()
      const batchEvents = getLastBatchEvents()
      expect(batchEvents).toMatchObject([
        {
          distinct_id: '123',
          event: '$groupidentify',
          properties: {
            $group_type: 'posthog',
            $group_key: 'team-1',
            $group_set: { analytics: true },
            $lib: 'posthog-node',
            $geoip_disable: true,
          },
        },
      ])
    })
  })

  describe('feature flags', () => {
    beforeEach(() => {
      const mockFeatureFlags = {
        'feature-1': true,
        'feature-2': true,
        'feature-variant': 'variant',
        'disabled-flag': false,
        'feature-array': true,
      }

      // these are stringified in apiImplementation
      const mockFeatureFlagPayloads = {
        'feature-1': { color: 'blue' },
        'feature-variant': 2,
        'feature-array': [1],
      }

      const multivariateFlag = {
        id: 1,
        name: 'Beta Feature',
        key: 'beta-feature-local',
        active: true,
        rollout_percentage: 100,
        filters: {
          groups: [
            {
              properties: [{ key: 'email', type: 'person', value: 'test@posthog.com', operator: 'exact' }],
              rollout_percentage: 100,
            },
            {
              rollout_percentage: 50,
            },
          ],
          multivariate: {
            variants: [
              { key: 'first-variant', name: 'First Variant', rollout_percentage: 50 },
              { key: 'second-variant', name: 'Second Variant', rollout_percentage: 25 },
              { key: 'third-variant', name: 'Third Variant', rollout_percentage: 25 },
            ],
          },
          payloads: { 'first-variant': 'some-payload', 'third-variant': JSON.stringify({ a: 'json' }) },
        },
      }
      const basicFlag = {
        id: 1,
        name: 'Beta Feature',
        key: 'person-flag',
        active: true,
        filters: {
          groups: [
            {
              properties: [
                {
                  key: 'region',
                  operator: 'exact',
                  value: ['USA'],
                  type: 'person',
                },
              ],
              rollout_percentage: 100,
            },
          ],
          payloads: { true: '300' },
        },
      }
      const falseFlag = {
        id: 1,
        name: 'Beta Feature',
        key: 'false-flag',
        active: true,
        filters: {
          groups: [
            {
              properties: [],
              rollout_percentage: 0,
            },
          ],
          payloads: { true: '300' },
        },
      }

      const arrayFlag = {
        id: 5,
        name: 'Beta Feature',
        key: 'feature-array',
        active: true,
        filters: {
          groups: [
            {
              properties: [],
              rollout_percentage: 100,
            },
          ],
          payloads: { true: JSON.stringify([1]) },
        },
      }

      mockedFetch.mockImplementation(
        apiImplementation({
          decideFlags: mockFeatureFlags,
          flagsPayloads: mockFeatureFlagPayloads,
          localFlags: { flags: [multivariateFlag, basicFlag, falseFlag, arrayFlag] },
        })
      )

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        disableCompression: true,
      })
    })

    it('should do getFeatureFlag', async () => {
      expect(mockedFetch).toHaveBeenCalledTimes(0)
      await expect(posthog.getFeatureFlag('feature-variant', '123', { groups: { org: '123' } })).resolves.toEqual(
        'variant'
      )
      expect(mockedFetch).toHaveBeenCalledTimes(1)
      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('"geoip_disable":true') })
      )
    })

    it('should do isFeatureEnabled', async () => {
      expect(mockedFetch).toHaveBeenCalledTimes(0)
      await expect(posthog.isFeatureEnabled('feature-1', '123', { groups: { org: '123' } })).resolves.toEqual(true)
      await expect(posthog.isFeatureEnabled('feature-4', '123', { groups: { org: '123' } })).resolves.toEqual(undefined)
      expect(mockedFetch).toHaveBeenCalledTimes(2)
    })

    it('captures feature flags when no personal API key is present', async () => {
      mockedFetch.mockClear()
      mockedFetch.mockClear()
      expect(mockedFetch).toHaveBeenCalledTimes(0)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        flushAt: 1,
        fetchRetryCount: 0,
        disableCompression: true,
      })

      posthog.capture({
        distinctId: 'distinct_id',
        event: 'node test event',
        sendFeatureFlags: true,
      })

      jest.runOnlyPendingTimers()
      await waitForPromises()

      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({ method: 'POST' })
      )

      expect(getLastBatchEvents()?.[0]).toEqual(
        expect.objectContaining({
          distinct_id: 'distinct_id',
          event: 'node test event',
          properties: expect.objectContaining({
            $active_feature_flags: ['feature-1', 'feature-2', 'feature-array', 'feature-variant'],
            '$feature/feature-1': true,
            '$feature/feature-2': true,
            '$feature/feature-array': true,
            '$feature/feature-variant': 'variant',
            $lib: 'posthog-node',
            $lib_version: '1.2.3',
            $geoip_disable: true,
          }),
        })
      )

      // no calls to `/local_evaluation`

      expect(mockedFetch).not.toHaveBeenCalledWith(...anyLocalEvalCall)
      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('"geoip_disable":true') })
      )
    })

    it('should use minimum featureFlagsPollingInterval of 100ms if set less to less than 100', async () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        featureFlagsPollingInterval: 98,
        disableCompression: true,
      })

      expect(posthog.options.featureFlagsPollingInterval).toEqual(100)
    })

    it('should use default featureFlagsPollingInterval of 30000ms if none provided', async () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        disableCompression: true,
      })

      expect(posthog.options.featureFlagsPollingInterval).toEqual(30000)
    })

    it('should throw an error when creating SDK if a project key is passed in as personalApiKey', async () => {
      expect(() => {
        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          fetchRetryCount: 0,
          personalApiKey: 'phc_abc123',
          featureFlagsPollingInterval: 100,
          disableCompression: true,
        })
      }).toThrow(Error)
    })

    it('does not automatically enrich capture events with flags unless sendFeatureFlags=true', async () => {
      mockedFetch.mockClear()
      expect(mockedFetch).toHaveBeenCalledTimes(0)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        flushAt: 1,
        fetchRetryCount: 0,
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        disableCompression: true,
      })

      jest.runOnlyPendingTimers()
      await waitForPromises()

      posthog.capture({
        distinctId: 'distinct_id',
        event: 'node test event',
      })

      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
      // no flags call
      expect(mockedFetch).not.toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({ method: 'POST' })
      )

      jest.runOnlyPendingTimers()

      await waitForPromises()

      expect(getLastBatchEvents()?.[0]).toEqual(
        expect.objectContaining({
          distinct_id: 'distinct_id',
          event: 'node test event',
          properties: expect.objectContaining({
            $lib: 'posthog-node',
            $lib_version: '1.2.3',
            $geoip_disable: true,
          }),
        })
      )
      // Should NOT have automatic flag enrichment
      expect(
        Object.prototype.hasOwnProperty.call(getLastBatchEvents()?.[0].properties, '$feature/beta-feature-local')
      ).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(getLastBatchEvents()?.[0].properties, '$feature/beta-feature')).toBe(
        false
      )
      expect(Object.prototype.hasOwnProperty.call(getLastBatchEvents()?.[0].properties, '$active_feature_flags')).toBe(
        false
      )

      await posthog.shutdown()
    })

    it('doesnt add flag properties when locally evaluated flags are empty', async () => {
      mockedFetch.mockClear()
      expect(mockedFetch).toHaveBeenCalledTimes(0)
      mockedFetch.mockImplementation(
        apiImplementation({ decideFlags: { a: false, b: 'true' }, flagsPayloads: {}, localFlags: { flags: [] } })
      )

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        flushAt: 1,
        fetchRetryCount: 0,
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        disableCompression: true,
      })

      posthog.capture({
        distinctId: 'distinct_id',
        event: 'node test event',
      })

      jest.runOnlyPendingTimers()
      await waitForPromises()

      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
      // no flags call
      expect(mockedFetch).not.toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({ method: 'POST' })
      )

      jest.runOnlyPendingTimers()

      await waitForPromises()

      expect(getLastBatchEvents()?.[0]).toEqual(
        expect.objectContaining({
          distinct_id: 'distinct_id',
          event: 'node test event',
          properties: expect.objectContaining({
            $lib: 'posthog-node',
            $lib_version: '1.2.3',
            $geoip_disable: true,
          }),
        })
      )
      expect(
        Object.prototype.hasOwnProperty.call(getLastBatchEvents()?.[0].properties, '$feature/beta-feature-local')
      ).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(getLastBatchEvents()?.[0].properties, '$feature/beta-feature')).toBe(
        false
      )
    })

    it('captures feature flags with same geoip setting as capture', async () => {
      mockedFetch.mockClear()
      mockedFetch.mockClear()
      expect(mockedFetch).toHaveBeenCalledTimes(0)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        flushAt: 1,
        fetchRetryCount: 0,
        disableCompression: true,
      })

      posthog.capture({
        distinctId: 'distinct_id',
        event: 'node test event',
        sendFeatureFlags: true,
        disableGeoip: false,
      })

      await waitForFlushTimer()

      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({ method: 'POST', body: expect.not.stringContaining('geoip_disable') })
      )

      expect(getLastBatchEvents()?.[0].properties).toEqual({
        $active_feature_flags: ['feature-1', 'feature-2', 'feature-array', 'feature-variant'],
        '$feature/feature-1': true,
        '$feature/feature-2': true,
        '$feature/feature-array': true,
        '$feature/disabled-flag': false,
        '$feature/feature-variant': 'variant',
        $lib: 'posthog-node',
        $lib_version: '1.2.3',
      })

      // no calls to `/local_evaluation`

      expect(mockedFetch).not.toHaveBeenCalledWith(...anyLocalEvalCall)
    })

    describe('sendFeatureFlags with property overrides', () => {
      beforeEach(() => {
        const mockDecideFlags = {
          'basic-flag': true,
          'person-property-flag': false,
          'group-property-flag': false,
        }

        const basicFlag = {
          id: 1,
          name: 'Basic Flag',
          key: 'basic-flag',
          active: true,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 100,
              },
            ],
          },
        }

        const personPropertyFlag = {
          id: 2,
          name: 'Person Property Flag',
          key: 'person-property-flag',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: 'plan',
                    operator: 'exact',
                    value: 'premium',
                    type: 'person',
                  },
                ],
                rollout_percentage: 100,
              },
            ],
          },
        }

        const groupPropertyFlag = {
          id: 3,
          name: 'Group Property Flag',
          key: 'group-property-flag',
          active: true,
          filters: {
            aggregation_group_type_index: 0,
            groups: [
              {
                properties: [
                  {
                    key: 'size',
                    operator: 'exact',
                    value: 'large',
                    type: 'group',
                  },
                ],
                rollout_percentage: 100,
              },
            ],
          },
        }

        const inconclusiveFlag = {
          id: 4,
          name: 'Inconclusive Flag',
          key: 'inconclusive-flag',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: 'missing_property',
                    operator: 'exact',
                    value: 'value',
                    type: 'person',
                  },
                ],
                rollout_percentage: 100,
              },
            ],
          },
        }

        mockedFetch.mockImplementation(
          apiImplementation({
            decideFlags: mockDecideFlags,
            flagsPayloads: {},
            localFlags: {
              flags: [basicFlag, personPropertyFlag, groupPropertyFlag, inconclusiveFlag],
              group_type_mapping: { 0: 'organization' },
            },
          })
        )
      })

      it('should fallback to remote evaluation when no local evaluation is available and onlyEvaluateLocally is not specified', async () => {
        mockedFetch.mockClear()

        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          flushAt: 1,
          fetchRetryCount: 0,
          disableCompression: true,
        })

        posthog.capture({
          distinctId: 'user123',
          event: 'test event',
          sendFeatureFlags: {
            personProperties: {
              plan: 'premium',
            },
            groupProperties: {
              organization: { size: 'large' },
            },
          },
        })

        await waitForFlushTimer()

        // Should make remote flags call
        expect(mockedFetch).toHaveBeenCalledWith(
          'http://example.com/flags/?v=2&config=true',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"plan":"premium"'),
          })
        )

        // Should not make local evaluation call
        expect(mockedFetch).not.toHaveBeenCalledWith(...anyLocalEvalCall)

        const batchEvents = getLastBatchEvents()
        expect(batchEvents?.[0]).toEqual(
          expect.objectContaining({
            distinct_id: 'user123',
            event: 'test event',
            properties: expect.objectContaining({
              '$feature/basic-flag': true,
              '$feature/person-property-flag': false,
              '$feature/group-property-flag': false,
            }),
          })
        )
      })

      it('should use local evaluation when available and include property overrides', async () => {
        mockedFetch.mockClear()

        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          flushAt: 1,
          fetchRetryCount: 0,
          personalApiKey: 'TEST_PERSONAL_API_KEY',
          disableCompression: true,
        })

        jest.runOnlyPendingTimers()
        await waitForPromises()

        posthog.capture({
          distinctId: 'user123',
          event: 'test event',
          sendFeatureFlags: {
            onlyEvaluateLocally: true,
            personProperties: {
              plan: 'premium',
            },
            groupProperties: {
              organization: { size: 'large' },
            },
          },
          groups: { organization: 'org123' },
        })

        await waitForFlushTimer()

        // Should make local evaluation call during initialization
        expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)

        // Should not make remote flags call
        expect(mockedFetch).not.toHaveBeenCalledWith(
          'http://example.com/flags/?v=2&config=true',
          expect.objectContaining({ method: 'POST' })
        )

        const batchEvents = getLastBatchEvents()
        expect(batchEvents?.[0]).toEqual(
          expect.objectContaining({
            distinct_id: 'user123',
            event: 'test event',
            properties: expect.objectContaining({
              // Should include locally evaluated flags that matched based on property overrides
              '$feature/basic-flag': true,
              '$feature/person-property-flag': true, // Should be true because plan=premium override
            }),
          })
        )
      })

      it('should work with explicit person properties and preserve event properties', async () => {
        mockedFetch.mockClear()

        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          flushAt: 1,
          fetchRetryCount: 0,
          personalApiKey: 'TEST_PERSONAL_API_KEY',
          disableCompression: true,
        })

        jest.runOnlyPendingTimers()
        await waitForPromises()

        posthog.capture({
          distinctId: 'user123',
          event: 'test event',
          sendFeatureFlags: {
            onlyEvaluateLocally: true,
            personProperties: {
              plan: 'premium',
            },
          },
          properties: {
            plan: 'premium',
            tier: 'gold',
            '$feature/existing_flag': 'value', // Should be passed through
            $lib: 'posthog-node', // Should be passed through
            numericValue: 123,
            booleanValue: true,
          },
        })

        await waitForFlushTimer()

        const batchEvents = getLastBatchEvents()
        expect(batchEvents?.[0]).toEqual(
          expect.objectContaining({
            properties: expect.objectContaining({
              plan: 'premium',
              tier: 'gold',
              '$feature/existing_flag': 'value',
              $lib: 'posthog-node',
              numericValue: 123,
              booleanValue: true,
              '$feature/person-property-flag': true, // Should match due to explicit plan=premium
            }),
          })
        )
      })

      it('should work with explicit group properties', async () => {
        mockedFetch.mockClear()

        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          flushAt: 1,
          fetchRetryCount: 0,
          personalApiKey: 'TEST_PERSONAL_API_KEY',
          disableCompression: true,
        })

        jest.runOnlyPendingTimers()
        await waitForPromises()

        posthog.capture({
          distinctId: 'user123',
          event: 'test event',
          sendFeatureFlags: {
            onlyEvaluateLocally: true,
            personProperties: {
              plan: 'basic',
            },
            groupProperties: {
              organization: {
                size: 'large',
                employees: 50,
                region: 'US',
              },
            },
          },
          groups: { organization: 'org123' },
        })

        await waitForFlushTimer()

        const batchEvents = getLastBatchEvents()
        expect(batchEvents?.[0]).toEqual(
          expect.objectContaining({
            properties: expect.objectContaining({
              '$feature/group-property-flag': true, // Should match due to explicit organization.size=large
              '$feature/person-property-flag': false, // Should not match because plan=basic
            }),
          })
        )
      })

      it('should not call _getFlags for $feature_flag_called events even with sendFeatureFlags=true', async () => {
        mockedFetch.mockClear()

        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          flushAt: 1,
          fetchRetryCount: 0,
          personalApiKey: 'TEST_PERSONAL_API_KEY',
          disableCompression: true,
        })

        jest.runOnlyPendingTimers()
        await waitForPromises()

        posthog.capture({
          distinctId: 'user123',
          event: '$feature_flag_called',
          sendFeatureFlags: true,
          properties: {
            plan: 'premium',
            $feature_flag: 'test-flag',
            $feature_flag_response: true,
          },
        })

        await waitForFlushTimer()

        const batchEvents = getLastBatchEvents()
        expect(batchEvents?.[0]).toEqual(
          expect.objectContaining({
            distinct_id: 'user123',
            event: '$feature_flag_called',
            properties: expect.objectContaining({
              plan: 'premium',
              $feature_flag: 'test-flag',
              $feature_flag_response: true,
            }),
          })
        )
      })

      it('should not call _getFlags when sendFeatureFlags is false', async () => {
        mockedFetch.mockClear()

        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          flushAt: 1,
          fetchRetryCount: 0,
          personalApiKey: 'TEST_PERSONAL_API_KEY',
          disableCompression: true,
        })

        jest.runOnlyPendingTimers()
        await waitForPromises()

        posthog.capture({
          distinctId: 'user123',
          event: 'test event',
          sendFeatureFlags: false,
          properties: {
            plan: 'premium',
          },
        })

        await waitForFlushTimer()

        // Should only make local evaluation call during initialization, not for capture
        expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)

        // Should not make remote flags call
        expect(mockedFetch).not.toHaveBeenCalledWith(
          'http://example.com/flags/?v=2&config=true',
          expect.objectContaining({ method: 'POST' })
        )

        const batchEvents = getLastBatchEvents()
        expect(batchEvents?.[0]).toEqual(
          expect.objectContaining({
            distinct_id: 'user123',
            event: 'test event',
            properties: expect.objectContaining({
              plan: 'premium',
              // No additional enrichment since sendFeatureFlags is false
            }),
          })
        )
      })

      it('should work with captureImmediate', async () => {
        mockedFetch.mockClear()

        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          fetchRetryCount: 0,
          personalApiKey: 'TEST_PERSONAL_API_KEY',
          disableCompression: true,
        })

        jest.runOnlyPendingTimers()
        await waitForPromises()

        await posthog.captureImmediate({
          distinctId: 'user123',
          event: 'test event',
          sendFeatureFlags: {
            onlyEvaluateLocally: true,
            personProperties: {
              plan: 'premium',
            },
            groupProperties: {
              organization: { size: 'large' },
            },
          },
          groups: { organization: 'org123' },
        })

        // Should make local evaluation call
        expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)

        // Should make immediate batch call
        expect(mockedFetch).toHaveBeenCalledWith(
          'http://example.com/batch/',
          expect.objectContaining({ method: 'POST' })
        )

        const lastCall = mockedFetch.mock.calls.find((call) => (call[0] as string).includes('/batch/'))
        const body = JSON.parse(lastCall?.[1]?.body as string)

        expect(body.batch[0]).toEqual(
          expect.objectContaining({
            distinct_id: 'user123',
            event: 'test event',
            properties: expect.objectContaining({
              '$feature/person-property-flag': true,
              '$feature/group-property-flag': true,
            }),
          })
        )
      })

      it('should fallback to remote evaluation when local evaluation has no flags defined and onlyEvaluateLocally is not specified', async () => {
        mockedFetch.mockClear()

        // Set up a client with no local flags but remote flags available
        mockedFetch.mockImplementation(
          apiImplementation({
            decideFlags: { 'remote-flag': true },
            flagsPayloads: {},
            localFlags: { flags: [] }, // No local flags available
          })
        )

        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          flushAt: 1,
          fetchRetryCount: 0,
          personalApiKey: 'TEST_PERSONAL_API_KEY',
          disableCompression: true,
        })

        jest.runOnlyPendingTimers()
        await waitForPromises()

        posthog.capture({
          distinctId: 'user123',
          event: 'test event',
          sendFeatureFlags: {
            personProperties: {
              plan: 'premium',
            },
          },
        })

        await waitForFlushTimer()

        // Should make local evaluation call during initialization
        expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)

        // Should make remote flags call since local evaluation has no flags
        expect(mockedFetch).toHaveBeenCalledWith(
          'http://example.com/flags/?v=2&config=true',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"plan":"premium"'),
          })
        )

        const batchEvents = getLastBatchEvents()
        expect(batchEvents?.[0]).toEqual(
          expect.objectContaining({
            distinct_id: 'user123',
            event: 'test event',
            properties: expect.objectContaining({
              '$feature/remote-flag': true,
            }),
          })
        )
      })
    })

    describe('sendFeatureFlags with enhanced API', () => {
      beforeEach(() => {
        const mockDecideFlags = {
          'basic-flag': true,
          'person-property-flag': false,
          'group-property-flag': false,
        }

        const basicFlag = {
          id: 1,
          name: 'Basic Flag',
          key: 'basic-flag',
          active: true,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 100,
              },
            ],
          },
        }

        const personPropertyFlag = {
          id: 2,
          name: 'Person Property Flag',
          key: 'person-property-flag',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: 'plan',
                    operator: 'exact',
                    value: 'premium',
                    type: 'person',
                  },
                ],
                rollout_percentage: 100,
              },
            ],
          },
        }

        const groupPropertyFlag = {
          id: 3,
          name: 'Group Property Flag',
          key: 'group-property-flag',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: 'tier',
                    operator: 'exact',
                    value: 'enterprise',
                    type: 'group',
                    group_type_index: 0,
                  },
                ],
                rollout_percentage: 100,
              },
            ],
          },
        }

        mockedFetch.mockImplementation(
          apiImplementation({
            decideFlags: mockDecideFlags,
            localFlags: {
              flags: [basicFlag, personPropertyFlag, groupPropertyFlag],
            },
          })
        )
      })

      it('should work with explicit personProperties in sendFeatureFlags options', async () => {
        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          flushAt: 1,
          fetchRetryCount: 0,
          personalApiKey: 'TEST_PERSONAL_API_KEY',
          disableCompression: true,
        })

        jest.runOnlyPendingTimers()
        await waitForPromises()

        posthog.capture({
          distinctId: 'user123',
          event: 'test event',
          sendFeatureFlags: {
            onlyEvaluateLocally: true,
            personProperties: {
              plan: 'premium',
            },
          },
          properties: {
            foo: 'bar',
          },
        })

        await waitForFlushTimer()

        const batchEvents = getLastBatchEvents()
        expect(batchEvents?.[0]).toEqual(
          expect.objectContaining({
            distinct_id: 'user123',
            event: 'test event',
            properties: expect.objectContaining({
              foo: 'bar',
              '$feature/basic-flag': true,
              '$feature/person-property-flag': true, // Should be true due to explicit personProperties
              $active_feature_flags: ['basic-flag', 'person-property-flag'],
            }),
          })
        )
      })

      it('should work with explicit groupProperties in sendFeatureFlags options', async () => {
        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          flushAt: 1,
          fetchRetryCount: 0,
          personalApiKey: 'TEST_PERSONAL_API_KEY',
          disableCompression: true,
        })

        jest.runOnlyPendingTimers()
        await waitForPromises()

        posthog.capture({
          distinctId: 'user123',
          event: 'test event',
          groups: { organization: 'org123' },
          sendFeatureFlags: {
            onlyEvaluateLocally: true,
            groupProperties: {
              organization: {
                tier: 'enterprise',
              },
            },
          },
          properties: {
            foo: 'bar',
          },
        })

        await waitForFlushTimer()

        const batchEvents = getLastBatchEvents()
        expect(batchEvents?.[0]).toEqual(
          expect.objectContaining({
            distinct_id: 'user123',
            event: 'test event',
            properties: expect.objectContaining({
              foo: 'bar',
              '$feature/basic-flag': true,
              $active_feature_flags: ['basic-flag'],
            }),
          })
        )
      })

      it('should work with onlyEvaluateLocally=true', async () => {
        // Setup with no local flags to test the fallback behavior
        mockedFetch.mockImplementation(
          apiImplementation({
            decideFlags: { 'remote-flag': true },
            localFlags: { flags: [] }, // No local flags
          })
        )

        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          flushAt: 1,
          fetchRetryCount: 0,
          personalApiKey: 'TEST_PERSONAL_API_KEY',
          disableCompression: true,
        })

        jest.runOnlyPendingTimers()
        await waitForPromises()

        mockedFetch.mockClear()

        posthog.capture({
          distinctId: 'user123',
          event: 'test event',
          sendFeatureFlags: {
            onlyEvaluateLocally: true,
          },
          properties: {
            foo: 'bar',
          },
        })

        await waitForFlushTimer()

        // Should not make any remote calls for flags
        expect(mockedFetch).not.toHaveBeenCalledWith(
          'http://example.com/flags/?v=2&config=true',
          expect.objectContaining({ method: 'POST' })
        )

        const batchEvents = getLastBatchEvents()
        expect(batchEvents?.[0]).toEqual(
          expect.objectContaining({
            distinct_id: 'user123',
            event: 'test event',
            properties: expect.objectContaining({
              foo: 'bar',
              // No feature flags should be added since onlyEvaluateLocally=true and no local flags
            }),
          })
        )
      })

      it('should work with onlyEvaluateLocally=false (default behavior)', async () => {
        // Setup with no local flags to test remote fallback
        mockedFetch.mockImplementation(
          apiImplementation({
            decideFlags: { 'remote-flag': true },
            localFlags: { flags: [] }, // No local flags
          })
        )

        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          flushAt: 1,
          fetchRetryCount: 0,
          personalApiKey: 'TEST_PERSONAL_API_KEY',
          disableCompression: true,
        })

        jest.runOnlyPendingTimers()
        await waitForPromises()

        mockedFetch.mockClear()

        posthog.capture({
          distinctId: 'user123',
          event: 'test event',
          sendFeatureFlags: {
            onlyEvaluateLocally: false,
          },
          properties: {
            foo: 'bar',
          },
        })

        await waitForFlushTimer()

        // Should make remote calls for flags
        expect(mockedFetch).toHaveBeenCalledWith(
          'http://example.com/flags/?v=2&config=true',
          expect.objectContaining({ method: 'POST' })
        )

        const batchEvents = getLastBatchEvents()
        expect(batchEvents?.[0]).toEqual(
          expect.objectContaining({
            distinct_id: 'user123',
            event: 'test event',
            properties: expect.objectContaining({
              foo: 'bar',
              '$feature/remote-flag': true,
            }),
          })
        )
      })

      it('should maintain backward compatibility with boolean sendFeatureFlags', async () => {
        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          flushAt: 1,
          fetchRetryCount: 0,
          personalApiKey: 'TEST_PERSONAL_API_KEY',
          disableCompression: true,
        })

        jest.runOnlyPendingTimers()
        await waitForPromises()

        posthog.capture({
          distinctId: 'user123',
          event: 'test event',
          sendFeatureFlags: true, // Boolean value should still work
          properties: {
            foo: 'bar',
          },
        })

        await waitForFlushTimer()

        const batchEvents = getLastBatchEvents()
        expect(batchEvents?.[0]).toEqual(
          expect.objectContaining({
            distinct_id: 'user123',
            event: 'test event',
            properties: expect.objectContaining({
              foo: 'bar',
              '$feature/basic-flag': true,
              $active_feature_flags: ['basic-flag'],
            }),
          })
        )
      })

      it('should work with captureImmediate', async () => {
        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          fetchRetryCount: 0,
          personalApiKey: 'TEST_PERSONAL_API_KEY',
          disableCompression: true,
        })

        jest.runOnlyPendingTimers()
        await waitForPromises()

        await posthog.captureImmediate({
          distinctId: 'user123',
          event: 'test event',
          sendFeatureFlags: {
            onlyEvaluateLocally: true,
            personProperties: {
              plan: 'premium',
            },
          },
          properties: {
            foo: 'bar',
          },
        })

        const batchEvents = getLastBatchEvents()
        expect(batchEvents?.[0]).toEqual(
          expect.objectContaining({
            distinct_id: 'user123',
            event: 'test event',
            properties: expect.objectContaining({
              foo: 'bar',
              '$feature/basic-flag': true,
              '$feature/person-property-flag': true, // Should be true due to explicit personProperties
              $active_feature_flags: ['basic-flag', 'person-property-flag'],
            }),
          })
        )
      })

      it('should only evaluate specified flags when flagKeys is provided', async () => {
        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          flushAt: 1,
          fetchRetryCount: 0,
          personalApiKey: 'TEST_PERSONAL_API_KEY',
          disableCompression: true,
        })

        jest.runOnlyPendingTimers()
        await waitForPromises()

        posthog.capture({
          distinctId: 'user123',
          event: 'test event',
          sendFeatureFlags: {
            onlyEvaluateLocally: true,
            flagKeys: ['basic-flag'], // Only evaluate basic-flag, not person-property-flag
            personProperties: {
              plan: 'premium', // This would make person-property-flag true, but it shouldn't be evaluated
            },
          },
          properties: {
            foo: 'bar',
          },
        })

        await waitForFlushTimer()

        const batchEvents = getLastBatchEvents()
        expect(batchEvents?.[0]).toEqual(
          expect.objectContaining({
            distinct_id: 'user123',
            event: 'test event',
            properties: expect.objectContaining({
              foo: 'bar',
              '$feature/basic-flag': true, // Should be included
              $active_feature_flags: ['basic-flag'], // Only basic-flag should be active
              // person-property-flag should NOT be included even though personProperties would match
            }),
          })
        )

        // Verify person-property-flag is not in the properties
        expect(batchEvents?.[0].properties).not.toHaveProperty('$feature/person-property-flag')
      })
    })

    it('manages memory well when sending feature flags', async () => {
      const flags = {
        flags: [
          {
            id: 1,
            name: 'Beta Feature',
            key: 'beta-feature',
            active: true,
            filters: {
              groups: [
                {
                  properties: [],
                  rollout_percentage: 100,
                },
              ],
            },
          },
        ],
      }

      mockedFetch.mockImplementation(
        apiImplementation({ localFlags: flags, decideFlags: { 'beta-feature': 'flags-fallback-value' } })
      )

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        maxCacheSize: 10,
        fetchRetryCount: 0,
        flushAt: 1,
        disableCompression: true,
      })

      expect(Object.keys(posthog.distinctIdHasSentFlagCalls).length).toEqual(0)

      for (let i = 0; i < 100; i++) {
        const distinctId = `some-distinct-id${i}`
        await posthog.getFeatureFlag('beta-feature', distinctId)

        await waitForPromises()
        jest.runOnlyPendingTimers()

        const batchEvents = getLastBatchEvents()
        expect(batchEvents).toMatchObject([
          {
            distinct_id: distinctId,
            event: '$feature_flag_called',
            properties: expect.objectContaining({
              $feature_flag: 'beta-feature',
              $feature_flag_response: true,
              $lib: 'posthog-node',
              $lib_version: '1.2.3',
              locally_evaluated: true,
              '$feature/beta-feature': true,
            }),
          },
        ])
        mockedFetch.mockClear()

        expect(Object.keys(posthog.distinctIdHasSentFlagCalls).length <= 10).toEqual(true)
      }
    })

    it('$feature_flag_called is called appropriately when querying flags', async () => {
      mockedFetch.mockClear()

      const flags = {
        flags: [
          {
            id: 1,
            name: 'Beta Feature',
            key: 'beta-feature',
            active: true,
            filters: {
              groups: [
                {
                  properties: [{ key: 'region', value: 'USA' }],
                  rollout_percentage: 100,
                },
              ],
            },
          },
        ],
      }

      mockedFetch.mockImplementation(
        apiImplementation({ localFlags: flags, decideFlags: { 'flags-flag': 'flags-value' } })
      )

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        maxCacheSize: 10,
        fetchRetryCount: 0,
        disableCompression: true,
      })

      jest.runOnlyPendingTimers()

      expect(
        await posthog.getFeatureFlag('beta-feature', 'some-distinct-id', {
          personProperties: { region: 'USA', name: 'Aloha' },
        })
      ).toEqual(true)

      // TRICKY: There's now an extra step before events are queued, so need to wait for that to resolve
      jest.runOnlyPendingTimers()
      await waitForPromises()
      await posthog.flush()

      expect(mockedFetch).toHaveBeenCalledWith('http://example.com/batch/', expect.any(Object))

      expect(getLastBatchEvents()?.[0]).toEqual(
        expect.objectContaining({
          distinct_id: 'some-distinct-id',
          event: '$feature_flag_called',
          properties: expect.objectContaining({
            $feature_flag: 'beta-feature',
            $feature_flag_response: true,
            '$feature/beta-feature': true,
            $lib: 'posthog-node',
            $lib_version: '1.2.3',
            locally_evaluated: true,
            $geoip_disable: true,
          }),
        })
      )
      mockedFetch.mockClear()

      // # called again for same user, shouldn't call capture again
      expect(
        await posthog.getFeatureFlag('beta-feature', 'some-distinct-id', {
          personProperties: { region: 'USA', name: 'Aloha' },
        })
      ).toEqual(true)
      jest.runOnlyPendingTimers()
      await waitForPromises()
      await posthog.flush()

      expect(mockedFetch).not.toHaveBeenCalledWith('http://example.com/batch/', expect.any(Object))

      // # called for different user, should call capture again
      expect(
        await posthog.getFeatureFlag('beta-feature', 'some-distinct-id2', {
          groups: { x: 'y' },
          personProperties: { region: 'USA', name: 'Aloha' },
          disableGeoip: false,
        })
      ).toEqual(true)
      jest.runOnlyPendingTimers()
      await waitForPromises()
      await posthog.flush()
      expect(mockedFetch).toHaveBeenCalledWith('http://example.com/batch/', expect.any(Object))

      expect(getLastBatchEvents()?.[0]).toEqual(
        expect.objectContaining({
          distinct_id: 'some-distinct-id2',
          event: '$feature_flag_called',
        })
      )
      expect(getLastBatchEvents()?.[0].properties).toEqual({
        $feature_flag: 'beta-feature',
        $feature_flag_response: true,
        $lib: 'posthog-node',
        $lib_version: '1.2.3',
        locally_evaluated: true,
        '$feature/beta-feature': true,
        $groups: { x: 'y' },
      })
      mockedFetch.mockClear()

      // # called for different user, but send configuration is false, so should NOT call capture again
      expect(
        await posthog.getFeatureFlag('beta-feature', 'some-distinct-id23', {
          personProperties: { region: 'USA', name: 'Aloha' },
          sendFeatureFlagEvents: false,
        })
      ).toEqual(true)
      jest.runOnlyPendingTimers()
      await waitForPromises()
      await posthog.flush()
      expect(mockedFetch).not.toHaveBeenCalledWith('http://example.com/batch/', expect.any(Object))

      // # called for different flag, falls back to flags, should call capture again
      expect(
        await posthog.getFeatureFlag('flags-flag', 'some-distinct-id2345', {
          groups: { organization: 'org1' },
          personProperties: { region: 'USA', name: 'Aloha' },
        })
      ).toEqual('flags-value')
      jest.runOnlyPendingTimers()
      await waitForPromises()
      await posthog.flush()
      // one to flags, one to batch
      expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)
      expect(mockedFetch).toHaveBeenCalledWith('http://example.com/batch/', expect.any(Object))

      expect(getLastBatchEvents()?.[0]).toEqual(
        expect.objectContaining({
          distinct_id: 'some-distinct-id2345',
          event: '$feature_flag_called',
          properties: expect.objectContaining({
            $feature_flag: 'flags-flag',
            $feature_flag_response: 'flags-value',
            $lib: 'posthog-node',
            $lib_version: '1.2.3',
            locally_evaluated: false,
            '$feature/flags-flag': 'flags-value',
            $groups: { organization: 'org1' },
          }),
        })
      )
      mockedFetch.mockClear()

      expect(
        await posthog.isFeatureEnabled('flags-flag', 'some-distinct-id2345', {
          groups: { organization: 'org1' },
          personProperties: { region: 'USA', name: 'Aloha' },
        })
      ).toEqual(true)
      jest.runOnlyPendingTimers()
      await waitForPromises()
      await posthog.flush()
      // call flags, but not batch
      expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)
      expect(mockedFetch).not.toHaveBeenCalledWith('http://example.com/batch/', expect.any(Object))
    })

    describe('`sendFeatureFlagEvent` client option', () => {
      beforeEach(() => {
        mockedFetch.mockClear()
        const flags = {
          flags: [
            {
              id: 1,
              name: 'Beta Feature',
              key: 'beta-feature',
              active: true,
              filters: {
                groups: [
                  {
                    properties: [],
                    rollout_percentage: 100,
                  },
                ],
              },
            },
          ],
        }
        mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))
      })

      afterAll(() => {
        mockedFetch.mockClear()
      })

      const methods = [
        { name: 'getFeatureFlag', expectedValue: true },
        { name: 'isFeatureEnabled', expectedValue: true },
      ] as const

      describe.each(methods)('$name', ({ name: methodName, expectedValue }) => {
        it('respects client sendFeatureFlagEvent option when method-level option is not provided', async () => {
          posthog = new PostHog('TEST_API_KEY', {
            host: 'http://example.com',
            personalApiKey: 'TEST_PERSONAL_API_KEY',
            sendFeatureFlagEvent: false, // We expect this to be respected
          })

          jest.runOnlyPendingTimers()

          // Call method WITHOUT specifying sendFeatureFlagEvents option
          // This should respect the global sendFeatureFlagEvent: false setting
          const result = await posthog[methodName]('beta-feature', 'some-distinct-id')
          expect(result).toEqual(expectedValue)

          await waitForPromises()
          await posthog.flush()

          // Should NOT send $feature_flag_called event because global setting is false
          expect(mockedFetch).not.toHaveBeenCalledWith('http://example.com/batch/', expect.anything())
        })

        it('overrides client sendFeatureFlagEvent option when method-level option is provided', async () => {
          posthog = new PostHog('TEST_API_KEY', {
            host: 'http://example.com',
            personalApiKey: 'TEST_PERSONAL_API_KEY',
            sendFeatureFlagEvent: false,
          })

          jest.runOnlyPendingTimers()

          // Call method WITH sendFeatureFlagEvents: true to override global setting
          const result = await posthog[methodName]('beta-feature', 'some-distinct-id', { sendFeatureFlagEvents: true })
          expect(result).toEqual(expectedValue)

          jest.runOnlyPendingTimers()
          await waitForPromises()
          await posthog.flush()

          // The client option should have been overridden, allowing the event to be sent
          expect(mockedFetch).toHaveBeenCalledWith('http://example.com/batch/', expect.anything())
        })
      })
    })

    it('should do getFeatureFlagPayloads', async () => {
      expect(mockedFetch).toHaveBeenCalledTimes(0)
      await expect(
        posthog.getFeatureFlagPayload('feature-variant', '123', 'variant', { groups: { org: '123' } })
      ).resolves.toEqual(2)
      expect(mockedFetch).toHaveBeenCalledTimes(1)
      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('"geoip_disable":true') })
      )
    })

    it('should not double parse json with getFeatureFlagPayloads and local eval', async () => {
      expect(mockedFetch).toHaveBeenCalledTimes(0)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        flushAt: 1,
        fetchRetryCount: 0,
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        disableCompression: true,
      })

      expect(mockedFetch).toHaveBeenCalledTimes(1)
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
      mockedFetch.mockClear()

      await expect(
        posthog.getFeatureFlagPayload('feature-array', '123', true, { onlyEvaluateLocally: true })
      ).resolves.toEqual([1])
      expect(mockedFetch).toHaveBeenCalledTimes(0)

      await expect(posthog.getFeatureFlagPayload('feature-array', '123')).resolves.toEqual([1])
      expect(mockedFetch).toHaveBeenCalledTimes(0)

      await expect(posthog.getFeatureFlagPayload('false-flag', '123', true)).resolves.toEqual(300)
      // Check no non-batch API calls were made
      const additionalNonBatchCalls = mockedFetch.mock.calls.filter((call) => !(call[0] as string).includes('/batch'))
      expect(additionalNonBatchCalls.length).toBe(0)
    })

    it('should not double parse json with getFeatureFlagPayloads and server eval', async () => {
      expect(mockedFetch).toHaveBeenCalledTimes(0)
      await expect(
        posthog.getFeatureFlagPayload('feature-array', '123', undefined, { groups: { org: '123' } })
      ).resolves.toEqual([1])
      expect(mockedFetch).toHaveBeenCalledTimes(1)
      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('"geoip_disable":true') })
      )
    })

    it('should do getFeatureFlagPayloads without matchValue', async () => {
      expect(mockedFetch).toHaveBeenCalledTimes(0)
      await expect(
        posthog.getFeatureFlagPayload('feature-variant', '123', undefined, { groups: { org: '123' } })
      ).resolves.toEqual(2)
      expect(mockedFetch).toHaveBeenCalledTimes(1)
    })

    it('should do getFeatureFlags with geoip disabled and enabled', async () => {
      expect(mockedFetch).toHaveBeenCalledTimes(0)
      await expect(
        posthog.getFeatureFlagPayload('feature-variant', '123', 'variant', { groups: { org: '123' } })
      ).resolves.toEqual(2)
      expect(mockedFetch).toHaveBeenCalledTimes(1)
      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('"geoip_disable":true') })
      )

      mockedFetch.mockClear()

      await expect(posthog.isFeatureEnabled('feature-variant', '123', { disableGeoip: false })).resolves.toEqual(true)
      expect(mockedFetch).toHaveBeenCalledTimes(1)
      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({ method: 'POST', body: expect.not.stringContaining('geoip_disable') })
      )
    })

    it('should add default person & group properties for feature flags', async () => {
      await posthog.getFeatureFlag('random_key', 'some_id', {
        groups: { company: 'id:5', instance: 'app.posthog.com' },
        personProperties: { x1: 'y1' },
        groupProperties: { company: { x: 'y' } },
      })
      jest.runOnlyPendingTimers()

      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({
          body: JSON.stringify({
            token: 'TEST_API_KEY',
            distinct_id: 'some_id',
            groups: { company: 'id:5', instance: 'app.posthog.com' },
            person_properties: {
              distinct_id: 'some_id',
              x1: 'y1',
            },
            group_properties: {
              company: { $group_key: 'id:5', x: 'y' },
              instance: { $group_key: 'app.posthog.com' },
            },
            geoip_disable: true,
            flag_keys_to_evaluate: ['random_key'],
          }),
        })
      )

      mockedFetch.mockClear()

      await posthog.getFeatureFlag('random_key', 'some_id', {
        groups: { company: 'id:5', instance: 'app.posthog.com' },
        personProperties: { distinct_id: 'override' },
        groupProperties: { company: { $group_key: 'group_override' } },
      })
      jest.runOnlyPendingTimers()

      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({
          body: JSON.stringify({
            token: 'TEST_API_KEY',
            distinct_id: 'some_id',
            groups: { company: 'id:5', instance: 'app.posthog.com' },
            person_properties: {
              distinct_id: 'override',
            },
            group_properties: {
              company: { $group_key: 'group_override' },
              instance: { $group_key: 'app.posthog.com' },
            },
            geoip_disable: true,
            flag_keys_to_evaluate: ['random_key'],
          }),
        })
      )

      mockedFetch.mockClear()

      // test nones
      await posthog.getAllFlagsAndPayloads('some_id', {
        groups: undefined,
        personProperties: undefined,
        groupProperties: undefined,
      })

      jest.runOnlyPendingTimers()

      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({
          body: JSON.stringify({
            token: 'TEST_API_KEY',
            distinct_id: 'some_id',
            groups: {},
            person_properties: {
              distinct_id: 'some_id',
            },
            group_properties: {},
            geoip_disable: true,
          }),
        })
      )

      mockedFetch.mockClear()
      await posthog.getAllFlags('some_id', {
        groups: { company: 'id:5' },
        personProperties: undefined,
        groupProperties: undefined,
      })
      jest.runOnlyPendingTimers()

      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({
          body: JSON.stringify({
            token: 'TEST_API_KEY',
            distinct_id: 'some_id',
            groups: { company: 'id:5' },
            person_properties: {
              distinct_id: 'some_id',
            },
            group_properties: { company: { $group_key: 'id:5' } },
            geoip_disable: true,
          }),
        })
      )

      mockedFetch.mockClear()
      await posthog.getFeatureFlagPayload('random_key', 'some_id', undefined)
      jest.runOnlyPendingTimers()

      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({
          body: JSON.stringify({
            token: 'TEST_API_KEY',
            distinct_id: 'some_id',
            groups: {},
            person_properties: {
              distinct_id: 'some_id',
            },
            group_properties: {},
            geoip_disable: true,
            flag_keys_to_evaluate: ['random_key'],
          }),
        })
      )

      mockedFetch.mockClear()

      await posthog.isFeatureEnabled('random_key', 'some_id')
      jest.runOnlyPendingTimers()

      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({
          body: JSON.stringify({
            token: 'TEST_API_KEY',
            distinct_id: 'some_id',
            groups: {},
            person_properties: {
              distinct_id: 'some_id',
            },
            group_properties: {},
            geoip_disable: true,
            flag_keys_to_evaluate: ['random_key'],
          }),
        })
      )
    })

    it('should log error when flags response has errors', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

      mockedFetch.mockImplementation(
        apiImplementation({
          decideFlags: { 'feature-1': true },
          flagsPayloads: {},
          errorsWhileComputingFlags: true,
        })
      )

      await posthog.getFeatureFlag('feature-1', '123')

      expect(errorSpy).toHaveBeenCalledWith(
        '[FEATURE FLAGS] Error while computing feature flags, some flags may be missing or incorrect. Learn more at https://posthog.com/docs/feature-flags/best-practices'
      )

      errorSpy.mockRestore()
    })
  })

  describe('evaluation contexts', () => {
    beforeEach(() => {
      mockedFetch.mockClear()
    })

    it('should send evaluation contexts when configured', async () => {
      mockedFetch.mockImplementation(
        apiImplementation({
          decideFlags: { 'test-flag': true },
          flagsPayloads: {},
        })
      )

      const posthogWithEnvs = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        evaluationContexts: ['production', 'backend'],
        ...posthogImmediateResolveOptions,
      })

      await posthogWithEnvs.getAllFlags('some-distinct-id')

      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"evaluation_contexts":["production","backend"]'),
        })
      )

      await posthogWithEnvs.shutdown()
    })

    it('should not send evaluation contexts when not configured', async () => {
      mockedFetch.mockImplementation(
        apiImplementation({
          decideFlags: { 'test-flag': true },
          flagsPayloads: {},
        })
      )

      const posthogWithoutEnvs = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })

      await posthogWithoutEnvs.getAllFlags('some-distinct-id')

      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({
          method: 'POST',
          body: expect.not.stringContaining('evaluation_contexts'),
        })
      )

      await posthogWithoutEnvs.shutdown()
    })

    it('should not send evaluation contexts when configured as empty array', async () => {
      mockedFetch.mockImplementation(
        apiImplementation({
          decideFlags: { 'test-flag': true },
          flagsPayloads: {},
        })
      )

      const posthogWithEmptyEnvs = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        evaluationContexts: [],
        ...posthogImmediateResolveOptions,
      })

      await posthogWithEmptyEnvs.getAllFlags('some-distinct-id')

      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({
          method: 'POST',
          body: expect.not.stringContaining('evaluation_contexts'),
        })
      )

      await posthogWithEmptyEnvs.shutdown()
    })

    it('should support deprecated evaluationEnvironments field', async () => {
      mockedFetch.mockImplementation(
        apiImplementation({
          decideFlags: { 'test-flag': true },
          flagsPayloads: {},
        })
      )

      const posthogWithDeprecated = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        evaluationEnvironments: ['production', 'backend'],
        ...posthogImmediateResolveOptions,
      })

      await posthogWithDeprecated.getAllFlags('some-distinct-id')

      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/flags/?v=2&config=true',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"evaluation_contexts":["production","backend"]'),
        })
      )

      await posthogWithDeprecated.shutdown()
    })
  })

  describe('getRemoteConfigPayload', () => {
    let requestRemoteConfigPayloadSpy: jest.SpyInstance

    beforeEach(() => {
      // Reset the mock for each test
      mockedFetch.mockClear()

      // Initialize posthog with personalApiKey
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        disableCompression: true,
        personalApiKey: 'TEST_PERSONAL_API_KEY',
      })

      // Mock the private method using jest.spyOn (now on the client, not the poller)
      requestRemoteConfigPayloadSpy = jest.spyOn(posthog as any, '_requestRemoteConfigPayload')
    })

    it('should throw error when personalApiKey is not provided', async () => {
      const posthogWithoutKey = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        disableCompression: true,
      })

      await expect(posthogWithoutKey.getRemoteConfigPayload('test-flag')).rejects.toThrow(
        'Personal API key is required for remote config payload decryption'
      )
    })

    it('should return empty object when no payload is available', async () => {
      requestRemoteConfigPayloadSpy.mockResolvedValue({
        json: () => Promise.resolve({}),
      })

      const payload = await posthog.getRemoteConfigPayload('test-flag')
      expect(payload).toEqual({})
      expect(requestRemoteConfigPayloadSpy).toHaveBeenCalledWith('test-flag')
    })

    it('should handle double-encoded JSON payload', async () => {
      const doubleEncodedPayload = '{ "foo":["bar","baz"]}'
      requestRemoteConfigPayloadSpy.mockResolvedValue({
        json: () => Promise.resolve(doubleEncodedPayload),
      })

      const payload = await posthog.getRemoteConfigPayload('test-flag')
      expect(payload).toEqual({
        foo: ['bar', 'baz'],
      })
      expect(requestRemoteConfigPayloadSpy).toHaveBeenCalledWith('test-flag')
    })

    it('should handle simple JSON payload', async () => {
      const simplePayload = { foo: ['bar', 'baz'] }
      requestRemoteConfigPayloadSpy.mockResolvedValue({
        json: () => Promise.resolve(simplePayload),
      })

      const payload = await posthog.getRemoteConfigPayload('test-flag')
      expect(payload).toEqual(simplePayload)
      expect(requestRemoteConfigPayloadSpy).toHaveBeenCalledWith('test-flag')
    })

    it('should work without local evaluation enabled', async () => {
      // Create a client with personalApiKey but local evaluation disabled
      const posthogWithoutLocalEval = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        disableCompression: true,
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        enableLocalEvaluation: false,
      })

      // Spy on the method for this instance
      const spy = jest.spyOn(posthogWithoutLocalEval as any, '_requestRemoteConfigPayload')
      spy.mockResolvedValue({
        json: () => Promise.resolve({ test: 'payload' }),
      })

      const payload = await posthogWithoutLocalEval.getRemoteConfigPayload('test-flag')
      expect(payload).toEqual({ test: 'payload' })
      expect(spy).toHaveBeenCalledWith('test-flag')

      // Verify that no poller was created
      expect(posthogWithoutLocalEval['featureFlagsPoller']).toBeUndefined()
    })

    it('should include project API key in the remote config URL', async () => {
      mockedFetch.mockResolvedValue({
        status: 200,
        json: () => Promise.resolve({ test: 'payload' }),
      } as any)

      await posthog.getRemoteConfigPayload('test-flag')

      expect(mockedFetch).toHaveBeenCalledWith(
        'http://example.com/api/projects/@current/feature_flags/test-flag/remote_config?token=TEST_API_KEY',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer TEST_PERSONAL_API_KEY',
          }),
        })
      )
    })
  })
})
