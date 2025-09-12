import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from '@/testing'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  let mocks: PostHogCoreTestClientMocks

  jest.useFakeTimers()
  jest.setSystemTime(new Date('2022-01-01'))

  const errorAPIResponse = Promise.resolve({
    status: 400,
    text: () => Promise.resolve('error'),
    json: () =>
      Promise.resolve({
        status: 'error',
      }),
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
        if (url.includes('/flags/?v=2&config=true')) {
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve('ok'),
            json: () => Promise.resolve(mockV1Response),
          })
        }
        return errorAPIResponse
      })

      const response = await posthog.getFlags('test-distinct-id')
      expect(response).toEqual(expectedResponse)
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
        if (url.includes('/flags/?v=2&config=true')) {
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve('ok'),
            json: () => Promise.resolve(mockV4Response),
          })
        }
        return errorAPIResponse
      })

      const response = await posthog.getFlags('test-distinct-id')
      expect(response).toEqual(expectedResponse)
    })

    it('should handle error response', async () => {
      mocks.fetch.mockImplementation((url) => {
        if (url.includes('/flags/?v=2&config=true')) {
          return Promise.resolve({
            status: 400,
            text: () => Promise.resolve('error'),
            json: () => Promise.resolve({ error: 'went wrong' }),
          })
        }
        return errorAPIResponse
      })

      const response = await posthog.getFlags('test-distinct-id')
      expect(response).toBeUndefined()
    })

    it('should handle network errors', async () => {
      const emitSpy = jest.spyOn(posthog['_events'], 'emit')
      mocks.fetch.mockImplementation((url) => {
        if (url.includes('/flags/?v=2&config=true')) {
          return Promise.reject(new Error('Network error'))
        }
        return errorAPIResponse
      })

      const response = await posthog.getFlags('test-distinct-id')
      expect(response).toBeUndefined()
      expect(emitSpy).toHaveBeenCalledWith('error', expect.any(Error))
    })
  })
})
