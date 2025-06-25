import { PostHog } from '../src/entrypoints/index.node'
import { anyFlagsCall, anyLocalEvalCall, apiImplementation, isPending } from './test-utils'
import { waitForPromises, wait } from '../../posthog-core/test/test-utils/test-utils'
import { randomUUID } from 'crypto'

jest.mock('../package.json', () => ({ version: '1.2.3' }))

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

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

describe('PostHog Node.js', () => {
  let posthog: PostHog

  jest.useFakeTimers()

  beforeEach(() => {
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
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
      posthog.debug(true)
      // @ts-expect-error - Testing the warning when passing a string instead of an object
      posthog.capture('test-event')
      expect(warnSpy).toHaveBeenCalledWith(
        'Called capture() with a string as the first argument when an object was expected.'
      )
      warnSpy.mockRestore()
    })
  })

  describe('shutdown', () => {
    let warnSpy: jest.SpyInstance, logSpy: jest.SpyInstance
    beforeEach(() => {
      const actualLog = console.log
      warnSpy = jest.spyOn(console, 'warn').mockImplementation((...args) => {
        actualLog('spied warn:', ...args)
      })
      logSpy = jest.spyOn(console, 'log').mockImplementation((...args) => {
        actualLog('spied log:', ...args)
      })

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

      logSpy.mockRestore()
      warnSpy.mockRestore()
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
      logSpy.mockRestore()
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

    it('captures feature flags with locally evaluated flags', async () => {
      mockedFetch.mockClear()
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
            $active_feature_flags: ['beta-feature-local', 'feature-array'],
            '$feature/beta-feature-local': 'third-variant',
            '$feature/feature-array': true,
            '$feature/false-flag': false,
            $lib: 'posthog-node',
            $lib_version: '1.2.3',
            $geoip_disable: true,
          }),
        })
      )
      expect(
        Object.prototype.hasOwnProperty.call(getLastBatchEvents()?.[0].properties, '$feature/beta-feature-local')
      ).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(getLastBatchEvents()?.[0].properties, '$feature/beta-feature')).toBe(
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

      mockedFetch.mockClear()
      expect(mockedFetch).toHaveBeenCalledTimes(0)

      await expect(
        posthog.getFeatureFlagPayload('feature-array', '123', true, { onlyEvaluateLocally: true })
      ).resolves.toEqual([1])
      expect(mockedFetch).toHaveBeenCalledTimes(1)
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)

      mockedFetch.mockClear()

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

  describe('getRemoteConfigPayload', () => {
    let requestRemoteConfigPayloadSpy: jest.SpyInstance

    beforeEach(() => {
      // Reset the mock for each test
      mockedFetch.mockClear()

      // Initialize posthog with personalApiKey to enable feature flags poller
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        disableCompression: true,
        personalApiKey: 'TEST_PERSONAL_API_KEY',
      })

      // Mock the private method using jest.spyOn
      requestRemoteConfigPayloadSpy = jest.spyOn(posthog['featureFlagsPoller'] as any, '_requestRemoteConfigPayload')
    })

    it('should return undefined when featureFlagsPoller is not initialized', async () => {
      const posthogWithoutPoller = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        disableCompression: true,
      })
      const payload = await posthogWithoutPoller.getRemoteConfigPayload('test-flag')
      expect(payload).toBeUndefined()
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
  })
})
