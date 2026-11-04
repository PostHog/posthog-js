import { normalizeFlagsResponse } from '@/featureFlagUtils'
import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from '@/testing'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  let mocks: PostHogCoreTestClientMocks

  vi.useFakeTimers()
  vi.setSystemTime(new Date('2022-01-01'))

  const errorAPIResponse = Promise.resolve({
    status: 400,
    text: () => Promise.resolve('error'),
    json: () =>
      Promise.resolve({
        status: 'error',
      }),
  })

  // Only posthog-node opts in to the v4 /flags response. The shared core, and the React Native
  // and web SDKs built on it, keep requesting v=2 and reading it with the shared v2 reader.
  describe('flags response version', () => {
    const respondWith = (body: unknown) => (): Promise<any> =>
      Promise.resolve({ status: 200, text: () => Promise.resolve('ok'), json: () => Promise.resolve(body) })

    beforeEach(() => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 })
    })

    it('requests v=2', async () => {
      mocks.fetch.mockImplementation(respondWith({ flags: {} }))

      await posthog.getFlags('test-distinct-id')

      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      expect(mocks.fetch.mock.calls[0][0]).toBe('https://us.i.posthog.com/flags/?v=2')
    })

    it('requests v=2 with the config parameter when the stateful client loads flags and config', async () => {
      mocks.fetch.mockImplementation(respondWith({ flags: {} }))

      await (posthog as any).flagsAsync({ fetchConfig: true })

      const flagsUrls = mocks.fetch.mock.calls.map(([url]) => url).filter((url) => url.includes('/flags/'))
      expect(flagsUrls).toEqual(['https://us.i.posthog.com/flags/?v=2&config=true'])
    })

    it.each([
      [
        'v2',
        {
          flags: {
            'garden-layout': {
              key: 'garden-layout',
              enabled: true,
              variant: 'compact',
              reason: { code: 'condition_match', condition_index: 0, description: 'Matched condition set 1' },
              metadata: { id: 202, version: 9, payload: '{"columns":2}' },
            },
          },
          requestId: 'request-1',
        },
      ],
      ['v1', { featureFlags: { 'garden-layout': 'compact' }, featureFlagPayloads: { 'garden-layout': '[1]' } }],
      [
        // A v4 record has no `enabled` or `variant`. The shared reader does not read `value`,
        // as before this seam existed.
        'v4-shaped',
        {
          flags: {
            'garden-layout': {
              key: 'garden-layout',
              value: 'compact',
              reason: { code: 'condition_match', condition_index: 0 },
              metadata: { id: 202, version: 9, config_version: 1, payload: '{"columns":2}' },
            },
          },
        },
      ],
    ])('reads a %s response body with the shared reader', async (_shape, body) => {
      mocks.fetch.mockImplementation(respondWith(structuredClone(body)))

      const result = await posthog.getFlags('test-distinct-id')

      expect(result).toEqual({ success: true, response: normalizeFlagsResponse(structuredClone(body) as any) })
    })

    it('does not read a v4 value as the flag value', async () => {
      mocks.fetch.mockImplementation(
        respondWith({
          flags: {
            'number-flag': { key: 'number-flag', value: 12.5, reason: { code: 'no_rule_match' }, metadata: {} },
          },
        })
      )

      const result = await posthog.getFlags('test-distinct-id')

      expect(result.success && result.response.featureFlags).toEqual({})
      expect(result.success && result.response.featureFlagPayloads).toEqual({})
    })
  })

  describe('getFlags', () => {
    beforeEach(() => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 })
    })

    it('should handle successful v1 response and return normalized response', async () => {
      const mockV1Response = {
        featureFlags: { 'test-flag': true },
        featureFlagPayloads: { 'test-flag': { a: 'payload' } },
      }

      const expectedResponse = {
        ...mockV1Response,
        flags: {
          'test-flag': {
            key: 'test-flag',
            enabled: true,
            variant: undefined,
            reason: undefined,
            metadata: {
              id: undefined,
              version: undefined,
              description: undefined,
              payload: '{"a":"payload"}',
            },
          },
        },
      }

      mocks.fetch.mockImplementation((url) => {
        if (url.includes('/flags/?v=2')) {
          expect(url).not.toContain('config=true')
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve('ok'),
            json: () => Promise.resolve(mockV1Response),
          })
        }
        return errorAPIResponse
      })

      const result = await posthog.getFlags('test-distinct-id')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.response).toEqual(expectedResponse)
      }
    })

    it('should handle successful v4 response and return normalized response', async () => {
      const mockV4Response = {
        flags: {
          'test-flag': {
            key: 'test-flag',
            enabled: true,
            variant: 'test-payload',
            reason: {
              code: 'matched_condition',
              description: 'matched condition set 1',
              condition_index: 0,
            },
            metadata: {
              id: 1,
              version: 1,
              description: 'test-flag',
              payload: '{"a":"payload"}',
            },
          },
        },
      }

      const expectedResponse = {
        ...mockV4Response,
        featureFlags: { 'test-flag': 'test-payload' },
        featureFlagPayloads: { 'test-flag': { a: 'payload' } },
      }
      mocks.fetch.mockImplementation((url) => {
        if (url.includes('/flags/?v=2')) {
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve('ok'),
            json: () => Promise.resolve(mockV4Response),
          })
        }
        return errorAPIResponse
      })

      const result = await posthog.getFlags('test-distinct-id')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.response).toEqual(expectedResponse)
      }
    })

    it('should handle error response', async () => {
      mocks.fetch.mockImplementation((url) => {
        if (url.includes('/flags/?v=2')) {
          return Promise.resolve({
            status: 400,
            text: () => Promise.resolve('error'),
            json: () => Promise.resolve({ error: 'went wrong' }),
          })
        }
        return errorAPIResponse
      })

      const result = await posthog.getFlags('test-distinct-id')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('api_error')
        expect(result.error.statusCode).toBe(400)
      }
    })

    it.each([
      [{ $device_id: 'device-123', email: 'test@example.com' }, 'device-123'],
      [{ email: 'test@example.com' }, undefined],
    ])('should handle $device_id top-level field correctly (props=%o)', async (personProperties, expectedDeviceId) => {
      mocks.fetch.mockImplementation((url) => {
        if (url.includes('/flags/?v=2')) {
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve('ok'),
            json: () => Promise.resolve({ featureFlags: {}, featureFlagPayloads: {} }),
          })
        }
        return errorAPIResponse
      })

      await posthog.getFlags('test-distinct-id', {}, personProperties)

      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      const requestBody = JSON.parse(mocks.fetch.mock.calls[0][1].body)
      expect(requestBody.$device_id).toBe(expectedDeviceId)
      if (expectedDeviceId) {
        expect(requestBody.person_properties.$device_id).toBe(expectedDeviceId)
      }
    })

    it('should handle network errors', async () => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1, featureFlagsRequestMaxRetries: 0 })
      const emitSpy = vi.spyOn(posthog['_events'], 'emit')
      mocks.fetch.mockImplementation((url) => {
        if (url.includes('/flags/?v=2')) {
          return Promise.reject(new Error('Network error'))
        }
        return errorAPIResponse
      })

      const result = await posthog.getFlags('test-distinct-id')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('connection_error')
      }
      expect(emitSpy).toHaveBeenCalledWith('error', expect.any(Error))
    })
  })
})
