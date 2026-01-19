import { PostHog } from '@/entrypoints/index.node'
import { PostHogOptions } from '@/types'
import { apiImplementation, apiImplementationV4, waitForPromises } from './utils'
import { PostHogV2FlagsResponse, FeatureFlagError } from '@posthog/core'

jest.spyOn(console, 'debug').mockImplementation()

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

const posthogImmediateResolveOptions: PostHogOptions = {
  fetchRetryCount: 0,
}

describe('flags v2', () => {
  describe('getFeatureFlag v2', () => {
    it('returns undefined if the flag is not found', async () => {
      const flagsResponse: PostHogV2FlagsResponse = {
        flags: {},
        errorsWhileComputingFlags: false,
        requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
        evaluatedAt: 1640995200000,
      }
      mockedFetch.mockImplementation(apiImplementationV4(flagsResponse))

      const posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })
      let capturedMessage: any
      posthog.on('capture', (message) => {
        capturedMessage = message
      })

      const result = await posthog.getFeatureFlag('non-existent-flag', 'some-distinct-id')

      expect(result).toBe(undefined)
      expect(mockedFetch).toHaveBeenCalledWith('http://example.com/flags/?v=2&config=true', expect.any(Object))

      await waitForPromises()
      expect(capturedMessage).toMatchObject({
        distinct_id: 'some-distinct-id',
        event: '$feature_flag_called',
        library: posthog.getLibraryId(),
        library_version: posthog.getLibraryVersion(),
        properties: {
          '$feature/non-existent-flag': undefined,
          $feature_flag: 'non-existent-flag',
          $feature_flag_response: undefined,
          $feature_flag_request_id: '0152a345-295f-4fba-adac-2e6ea9c91082',
          $feature_flag_evaluated_at: expect.any(Number),
          $groups: undefined,
          $lib: posthog.getLibraryId(),
          $lib_version: posthog.getLibraryVersion(),
          locally_evaluated: false,
        },
      })
    })

    it.each([
      {
        key: 'variant-flag',
        expectedResponse: 'variant-value',
        expectedReason: 'Matched condition set 3',
        expectedId: 2,
        expectedVersion: 23,
      },
      {
        key: 'boolean-flag',
        expectedResponse: true,
        expectedReason: 'Matched condition set 1',
        expectedId: 1,
        expectedVersion: 12,
      },
      {
        key: 'non-matching-flag',
        expectedResponse: false,
        expectedReason: 'Did not match any condition',
        expectedId: 3,
        expectedVersion: 2,
      },
    ])(
      'captures a feature flag called event with extra metadata when the flag is found',
      async ({ key, expectedResponse, expectedReason, expectedId, expectedVersion }) => {
        const flagsResponse: PostHogV2FlagsResponse = {
          flags: {
            'variant-flag': {
              key: 'variant-flag',
              enabled: true,
              variant: 'variant-value',
              reason: {
                code: 'variant',
                condition_index: 2,
                description: 'Matched condition set 3',
              },
              metadata: {
                id: 2,
                version: 23,
                payload: '{"key": "value"}',
                description: 'description',
              },
            },
            'boolean-flag': {
              key: 'boolean-flag',
              enabled: true,
              variant: undefined,
              reason: {
                code: 'boolean',
                condition_index: 1,
                description: 'Matched condition set 1',
              },
              metadata: {
                id: 1,
                version: 12,
                payload: undefined,
                description: 'description',
              },
            },
            'non-matching-flag': {
              key: 'non-matching-flag',
              enabled: false,
              variant: undefined,
              reason: {
                code: 'boolean',
                condition_index: 1,
                description: 'Did not match any condition',
              },
              metadata: {
                id: 3,
                version: 2,
                payload: undefined,
                description: 'description',
              },
            },
          },
          errorsWhileComputingFlags: false,
          requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
          evaluatedAt: 1640995200000,
        }
        mockedFetch.mockImplementation(apiImplementationV4(flagsResponse))

        const posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          ...posthogImmediateResolveOptions,
        })
        let capturedMessage: any
        posthog.on('capture', (message) => {
          capturedMessage = message
        })

        const result = await posthog.getFeatureFlag(key, 'some-distinct-id')

        expect(result).toBe(expectedResponse)
        expect(mockedFetch).toHaveBeenCalledWith('http://example.com/flags/?v=2&config=true', expect.any(Object))

        await waitForPromises()
        expect(capturedMessage).toMatchObject({
          distinct_id: 'some-distinct-id',
          event: '$feature_flag_called',
          library: posthog.getLibraryId(),
          library_version: posthog.getLibraryVersion(),
          properties: {
            [`$feature/${key}`]: expectedResponse,
            $feature_flag: key,
            $feature_flag_response: expectedResponse,
            $feature_flag_id: expectedId,
            $feature_flag_version: expectedVersion,
            $feature_flag_reason: expectedReason,
            $feature_flag_request_id: '0152a345-295f-4fba-adac-2e6ea9c91082',
            $feature_flag_evaluated_at: expect.any(Number),
            $groups: undefined,
            $lib: posthog.getLibraryId(),
            $lib_version: posthog.getLibraryVersion(),
            locally_evaluated: false,
          },
        })
      }
    )

    describe('getFeatureFlagPayload v2', () => {
      it('returns payload', async () => {
        mockedFetch.mockImplementation(
          apiImplementationV4({
            flags: {
              'flag-with-payload': {
                key: 'flag-with-payload',
                enabled: true,
                variant: undefined,
                reason: {
                  code: 'boolean',
                  condition_index: 1,
                  description: 'Matched condition set 2',
                },
                metadata: {
                  id: 1,
                  version: 12,
                  payload: '[0, 1, 2]',
                  description: 'description',
                },
              },
            },
            errorsWhileComputingFlags: false,
          })
        )

        const posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          ...posthogImmediateResolveOptions,
        })
        let capturedMessage: any
        posthog.on('capture', (message) => {
          capturedMessage = message
        })

        const result = await posthog.getFeatureFlagPayload('flag-with-payload', 'some-distinct-id')

        expect(result).toEqual([0, 1, 2])
        expect(mockedFetch).toHaveBeenCalledWith('http://example.com/flags/?v=2&config=true', expect.any(Object))

        await waitForPromises()
        expect(capturedMessage).toBeUndefined()
      })
    })
  })

  describe('error handling', () => {
    let posthog: PostHog
    describe.each([
      {
        case: 'JSON error response',
        mock: apiImplementationV4({
          status: 400,
          json: () => Promise.resolve({ error: 'error response' }),
        }),
      },
      {
        case: 'undefined response',
        mock: apiImplementationV4({
          status: 400,
          json: () => Promise.resolve(undefined),
        }),
      },
      {
        case: 'null response',
        mock: apiImplementationV4({
          status: 400,
          json: () => Promise.resolve(null),
        }),
      },
      {
        case: 'empty response',
        mock: apiImplementationV4({
          status: 400,
          json: () => Promise.resolve({}),
        }),
      },
      {
        case: 'network error',
        mock: () => Promise.reject(new Error('Network error')),
      },
      {
        case: 'invalid JSON',
        mock: apiImplementationV4({
          status: 500,
          json: () => Promise.reject(new Error('Invalid JSON')),
        }),
      },
    ])('when $case', ({ mock }) => {
      beforeEach(() => {
        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          ...posthogImmediateResolveOptions,
        })
        mockedFetch.mockImplementation(mock)
      })

      it('getFeatureFlag returns undefined', async () => {
        expect(await posthog.getFeatureFlag('error-flag', 'some-distinct-id')).toBe(undefined)
      })

      it('isFeatureEnabled returns undefined', async () => {
        expect(await posthog.isFeatureEnabled('error-flag', 'some-distinct-id')).toBe(undefined)
      })

      it('getFeatureFlagPayload returns undefined', async () => {
        expect(await posthog.getFeatureFlagPayload('error-flag', 'some-distinct-id')).toBe(undefined)
      })

      it('getAllFlags returns empty object', async () => {
        expect(await posthog.getAllFlags('some-distinct-id')).toEqual({})
      })

      it('getAllFlagsAndPayloads returns object with empty flags and payloads', async () => {
        expect(await posthog.getAllFlagsAndPayloads('some-distinct-id')).toEqual({
          featureFlags: {},
          featureFlagPayloads: {},
        })
      })

      it('captures event with $feature_flag_error=unknown_error', async () => {
        let capturedMessage: any
        posthog.on('capture', (message) => {
          capturedMessage = message
        })

        await posthog.getFeatureFlag('error-flag', 'some-distinct-id')
        await waitForPromises()
        expect(capturedMessage).toBeDefined()
        expect(capturedMessage.event).toBe('$feature_flag_called')
        expect(capturedMessage.properties.$feature_flag_error).toBe('unknown_error')
      })
    })
  })
})

describe('flags v1', () => {
  describe('getFeatureFlag v1', () => {
    it('returns undefined if the flag is not found', async () => {
      mockedFetch.mockImplementation(apiImplementation({ decideFlags: {} }))

      const posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })
      let capturedMessage: any
      posthog.on('capture', (message) => {
        capturedMessage = message
      })

      const result = await posthog.getFeatureFlag('non-existent-flag', 'some-distinct-id')

      expect(result).toBe(undefined)
      expect(mockedFetch).toHaveBeenCalledWith('http://example.com/flags/?v=2&config=true', expect.any(Object))

      await waitForPromises()
      expect(capturedMessage).toMatchObject({
        distinct_id: 'some-distinct-id',
        event: '$feature_flag_called',
        library: posthog.getLibraryId(),
        library_version: posthog.getLibraryVersion(),
        properties: {
          '$feature/non-existent-flag': undefined,
          $feature_flag: 'non-existent-flag',
          $feature_flag_response: undefined,
          $groups: undefined,
          $lib: posthog.getLibraryId(),
          $lib_version: posthog.getLibraryVersion(),
          locally_evaluated: false,
        },
      })
    })
  })

  describe('getFeatureFlagPayload v1', () => {
    it('returns payload', async () => {
      mockedFetch.mockImplementation(
        apiImplementation({
          decideFlags: {
            'flag-with-payload': true,
          },
          flagsPayloads: {
            'flag-with-payload': [0, 1, 2],
          },
        })
      )

      const posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })
      let capturedMessage: any = undefined
      posthog.on('capture', (message) => {
        capturedMessage = message
      })

      const result = await posthog.getFeatureFlagPayload('flag-with-payload', 'some-distinct-id')

      expect(result).toEqual([0, 1, 2])
      expect(mockedFetch).toHaveBeenCalledWith('http://example.com/flags/?v=2&config=true', expect.any(Object))

      await waitForPromises()
      expect(capturedMessage).toBeUndefined()
    })
  })
})

describe('feature flag error tracking', () => {
  it('sets $feature_flag_error to flag_missing when flag is not in response', async () => {
    const flagsResponse: PostHogV2FlagsResponse = {
      flags: {},
      errorsWhileComputingFlags: false,
      requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
      evaluatedAt: 1640995200000,
    }
    mockedFetch.mockImplementation(apiImplementationV4(flagsResponse))

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
    })
    let capturedMessage: any
    posthog.on('capture', (message) => {
      capturedMessage = message
    })

    const result = await posthog.getFeatureFlag('non-existent-flag', 'some-distinct-id')

    expect(result).toBe(undefined)

    await waitForPromises()
    expect(capturedMessage.properties.$feature_flag_error).toBe(FeatureFlagError.FLAG_MISSING)
  })

  it('sets $feature_flag_error to errors_while_computing_flags when errorsWhileComputingFlags is true', async () => {
    const flagsResponse: PostHogV2FlagsResponse = {
      flags: {
        'some-flag': {
          key: 'some-flag',
          enabled: true,
          variant: undefined,
          reason: {
            code: 'boolean',
            condition_index: 1,
            description: 'Matched condition set 1',
          },
          metadata: {
            id: 1,
            version: 1,
            payload: undefined,
            description: 'description',
          },
        },
      },
      errorsWhileComputingFlags: true,
      requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
      evaluatedAt: 1640995200000,
    }
    mockedFetch.mockImplementation(apiImplementationV4(flagsResponse))

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
    })
    let capturedMessage: any
    posthog.on('capture', (message) => {
      capturedMessage = message
    })

    const result = await posthog.getFeatureFlag('some-flag', 'some-distinct-id')

    expect(result).toBe(true)

    await waitForPromises()
    expect(capturedMessage.properties.$feature_flag_error).toBe(FeatureFlagError.ERRORS_WHILE_COMPUTING)
  })

  it('sets $feature_flag_error to quota_limited when quota limited', async () => {
    // When quota limited, the core library returns empty flags but preserves quotaLimited info
    const flagsResponse: PostHogV2FlagsResponse = {
      flags: {},
      errorsWhileComputingFlags: false,
      quotaLimited: ['feature_flags'],
      requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
      evaluatedAt: 1640995200000,
    }
    mockedFetch.mockImplementation(apiImplementationV4(flagsResponse))

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
    })
    let capturedMessage: any
    posthog.on('capture', (message) => {
      capturedMessage = message
    })

    const result = await posthog.getFeatureFlag('some-flag', 'some-distinct-id')

    // Flag is undefined because quota limiting returns empty flags
    expect(result).toBe(undefined)

    await waitForPromises()
    // Both quota_limited and flag_missing are reported since the flag is not in the empty response
    expect(capturedMessage.properties.$feature_flag_error).toBe(
      `${FeatureFlagError.QUOTA_LIMITED},${FeatureFlagError.FLAG_MISSING}`
    )
  })

  it('sets $feature_flag_error to unknown_error when request fails completely', async () => {
    mockedFetch.mockImplementation(() => Promise.reject(new Error('Network error')))

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
    })
    let capturedMessage: any
    posthog.on('capture', (message) => {
      capturedMessage = message
    })

    const result = await posthog.getFeatureFlag('some-flag', 'some-distinct-id')

    expect(result).toBe(undefined)

    await waitForPromises()
    expect(capturedMessage.properties.$feature_flag_error).toBe(FeatureFlagError.UNKNOWN_ERROR)
  })

  it('joins multiple errors with commas', async () => {
    const flagsResponse: PostHogV2FlagsResponse = {
      flags: {},
      errorsWhileComputingFlags: true,
      requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
      evaluatedAt: 1640995200000,
    }
    mockedFetch.mockImplementation(apiImplementationV4(flagsResponse))

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
    })
    let capturedMessage: any
    posthog.on('capture', (message) => {
      capturedMessage = message
    })

    const result = await posthog.getFeatureFlag('missing-flag', 'some-distinct-id')

    expect(result).toBe(undefined)

    await waitForPromises()
    // Should contain both errors joined with commas
    expect(capturedMessage.properties.$feature_flag_error).toBe(
      `${FeatureFlagError.ERRORS_WHILE_COMPUTING},${FeatureFlagError.FLAG_MISSING}`
    )
  })

  it('does not set $feature_flag_error when there are no errors', async () => {
    const flagsResponse: PostHogV2FlagsResponse = {
      flags: {
        'some-flag': {
          key: 'some-flag',
          enabled: true,
          variant: undefined,
          reason: {
            code: 'boolean',
            condition_index: 1,
            description: 'Matched condition set 1',
          },
          metadata: {
            id: 1,
            version: 1,
            payload: undefined,
            description: 'description',
          },
        },
      },
      errorsWhileComputingFlags: false,
      requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
      evaluatedAt: 1640995200000,
    }
    mockedFetch.mockImplementation(apiImplementationV4(flagsResponse))

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
    })
    let capturedMessage: any
    posthog.on('capture', (message) => {
      capturedMessage = message
    })

    const result = await posthog.getFeatureFlag('some-flag', 'some-distinct-id')

    expect(result).toBe(true)

    await waitForPromises()
    expect(capturedMessage.properties.$feature_flag_error).toBeUndefined()
  })

  it('does not capture events when sendFeatureFlagEvents is false', async () => {
    mockedFetch.mockImplementation(() => Promise.reject(new Error('Network error')))

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
    })
    let capturedMessage: any
    posthog.on('capture', (message) => {
      capturedMessage = message
    })

    const result = await posthog.getFeatureFlag('some-flag', 'some-distinct-id', {
      sendFeatureFlagEvents: false,
    })

    expect(result).toBe(undefined)

    await waitForPromises()
    expect(capturedMessage).toBeUndefined()
  })
})

describe('getFeatureFlagResult', () => {
  it('returns flag result including parsed payload', async () => {
    const flagsResponse: PostHogV2FlagsResponse = {
      flags: {
        'test-flag': {
          key: 'test-flag',
          enabled: true,
          variant: 'variant-a',
          reason: {
            code: 'variant',
            condition_index: 2,
            description: 'Matched condition set 3',
          },
          metadata: {
            id: 42,
            version: 5,
            payload: '{"discount": 20}',
            description: 'Test flag description',
          },
        },
      },
      errorsWhileComputingFlags: false,
      requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
      evaluatedAt: 1640995200000,
    }
    mockedFetch.mockImplementation(apiImplementationV4(flagsResponse))

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
    })

    const result = await posthog.getFeatureFlagResult('test-flag', 'some-distinct-id')

    expect(result).toEqual({
      key: 'test-flag',
      enabled: true,
      variant: 'variant-a',
      payload: { discount: 20 },
    })
  })

  it('returns raw string payload when JSON parsing fails', async () => {
    const flagsResponse: PostHogV2FlagsResponse = {
      flags: {
        'test-flag': {
          key: 'test-flag',
          enabled: true,
          variant: undefined,
          reason: undefined,
          metadata: {
            id: 42,
            version: 1,
            payload: 'not valid json {{{',
            description: undefined,
          },
        },
      },
      errorsWhileComputingFlags: false,
      requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
      evaluatedAt: 1640995200000,
    }
    mockedFetch.mockImplementation(apiImplementationV4(flagsResponse))

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
    })

    const result = await posthog.getFeatureFlagResult('test-flag', 'some-distinct-id')

    expect(result).toEqual({
      key: 'test-flag',
      enabled: true,
      variant: undefined,
      payload: 'not valid json {{{',
    })

    await posthog.shutdown()
  })

  it('returns undefined when flag is not found', async () => {
    const flagsResponse: PostHogV2FlagsResponse = {
      flags: {},
      errorsWhileComputingFlags: false,
      requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
      evaluatedAt: 1640995200000,
    }
    mockedFetch.mockImplementation(apiImplementationV4(flagsResponse))

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
    })

    const result = await posthog.getFeatureFlagResult('non-existent-flag', 'some-distinct-id')

    expect(result).toBeUndefined()
  })

  it('returns result for simple boolean flag without variant or payload', async () => {
    const flagsResponse: PostHogV2FlagsResponse = {
      flags: {
        'boolean-flag': {
          key: 'boolean-flag',
          enabled: true,
          variant: undefined,
          reason: {
            code: 'boolean',
            condition_index: 0,
            description: 'Matched condition set 1',
          },
          metadata: {
            id: 1,
            version: 1,
            payload: undefined,
            description: undefined,
          },
        },
      },
      errorsWhileComputingFlags: false,
      requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
      evaluatedAt: 1640995200000,
    }
    mockedFetch.mockImplementation(apiImplementationV4(flagsResponse))

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
    })

    const result = await posthog.getFeatureFlagResult('boolean-flag', 'some-distinct-id')

    expect(result?.enabled).toBe(true)
    expect(result?.variant).toBeUndefined()
    expect(result?.payload).toBeUndefined()
  })

  it('returns disabled result when conditions do not match', async () => {
    const flagsResponse: PostHogV2FlagsResponse = {
      flags: {
        'disabled-flag': {
          key: 'disabled-flag',
          enabled: false,
          variant: undefined,
          reason: {
            code: 'no_condition_match',
            condition_index: undefined,
            description: 'No conditions matched',
          },
          metadata: {
            id: 5,
            version: 2,
            payload: undefined,
            description: 'A flag that did not match',
          },
        },
      },
      errorsWhileComputingFlags: false,
      requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
      evaluatedAt: 1640995200000,
    }
    mockedFetch.mockImplementation(apiImplementationV4(flagsResponse))

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
    })

    const result = await posthog.getFeatureFlagResult('disabled-flag', 'some-distinct-id')

    expect(result).toEqual({
      key: 'disabled-flag',
      enabled: false,
      variant: undefined,
      payload: undefined,
    })
  })

  it('captures $feature_flag_called event with result', async () => {
    const flagsResponse: PostHogV2FlagsResponse = {
      flags: {
        'test-flag': {
          key: 'test-flag',
          enabled: true,
          variant: 'control',
          reason: {
            code: 'variant',
            condition_index: 1,
            description: 'Matched condition set 2',
          },
          metadata: {
            id: 10,
            version: 3,
            payload: '{"value": 100}',
            description: 'description',
          },
        },
      },
      errorsWhileComputingFlags: false,
      requestId: 'test-request-id',
      evaluatedAt: 1640995200000,
    }
    mockedFetch.mockImplementation(apiImplementationV4(flagsResponse))

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
    })
    let capturedMessage: any
    posthog.on('capture', (message) => {
      capturedMessage = message
    })

    await posthog.getFeatureFlagResult('test-flag', 'some-distinct-id')

    await waitForPromises()
    expect(capturedMessage).toMatchObject({
      distinct_id: 'some-distinct-id',
      event: '$feature_flag_called',
      properties: {
        '$feature/test-flag': 'control',
        $feature_flag: 'test-flag',
        $feature_flag_response: 'control',
        $feature_flag_id: 10,
        $feature_flag_version: 3,
        $feature_flag_reason: 'Matched condition set 2',
        $feature_flag_request_id: 'test-request-id',
        locally_evaluated: false,
      },
    })
  })

  it('does not capture event when sendFeatureFlagEvents is false', async () => {
    const flagsResponse: PostHogV2FlagsResponse = {
      flags: {
        'test-flag': {
          key: 'test-flag',
          enabled: true,
          variant: undefined,
          reason: { code: 'boolean', condition_index: 0, description: 'Matched' },
          metadata: { id: 1, version: 1, payload: undefined, description: undefined },
        },
      },
      errorsWhileComputingFlags: false,
      requestId: 'test-request-id',
      evaluatedAt: 1640995200000,
    }
    mockedFetch.mockImplementation(apiImplementationV4(flagsResponse))

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
    })
    let capturedMessage: any
    posthog.on('capture', (message) => {
      capturedMessage = message
    })

    await posthog.getFeatureFlagResult('test-flag', 'some-distinct-id', {
      sendFeatureFlagEvents: false,
    })

    await waitForPromises()
    expect(capturedMessage).toBeUndefined()
  })

  it('returns override result when flag is overridden', async () => {
    mockedFetch.mockImplementation(apiImplementationV4({ flags: {}, errorsWhileComputingFlags: false }))

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
    })

    posthog.overrideFeatureFlags({
      flags: { 'overridden-flag': 'override-variant' },
      payloads: { 'overridden-flag': { custom: 'payload' } },
    })

    const result = await posthog.getFeatureFlagResult('overridden-flag', 'some-distinct-id')

    expect(result).toEqual({
      key: 'overridden-flag',
      enabled: true,
      variant: 'override-variant',
      payload: { custom: 'payload' },
    })
  })

  it('returns disabled result when flag is overridden to false', async () => {
    mockedFetch.mockImplementation(apiImplementationV4({ flags: {}, errorsWhileComputingFlags: false }))

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
    })

    posthog.overrideFeatureFlags({
      flags: { 'disabled-override-flag': false },
    })

    const result = await posthog.getFeatureFlagResult('disabled-override-flag', 'some-distinct-id')

    expect(result).toEqual({
      key: 'disabled-override-flag',
      enabled: false,
      variant: undefined,
      payload: undefined,
    })
  })

  it('returns undefined when flag is overridden to undefined (simulates missing flag)', async () => {
    mockedFetch.mockImplementation(apiImplementationV4({ flags: {}, errorsWhileComputingFlags: false }))

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
    })

    posthog.overrideFeatureFlags({
      flags: { 'undefined-override-flag': undefined as any },
    })

    const result = await posthog.getFeatureFlagResult('undefined-override-flag', 'some-distinct-id')

    expect(result).toBeUndefined()
  })

  describe('local evaluation', () => {
    it('returns flag result with parsed payload when evaluated locally', async () => {
      const localFlags = {
        flags: [
          {
            id: 42,
            name: 'Local Feature',
            key: 'local-flag',
            active: true,
            filters: {
              groups: [
                {
                  properties: [{ key: 'region', value: ['USA'], type: 'person' }],
                  rollout_percentage: 100,
                },
              ],
              payloads: { true: '{"discount": 15}' },
            },
          },
        ],
      }
      mockedFetch.mockImplementation(apiImplementation({ localFlags }))

      const posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      const result = await posthog.getFeatureFlagResult('local-flag', 'some-distinct-id', {
        personProperties: { region: 'USA' },
      })

      expect(result).toMatchObject({
        key: 'local-flag',
        enabled: true,
        payload: { discount: 15 },
      })

      await posthog.shutdown()
    })

    it('returns variant result when evaluated locally with multivariate flag', async () => {
      const localFlags = {
        flags: [
          {
            id: 99,
            name: 'Multivariate Flag',
            key: 'multivariate-flag',
            active: true,
            filters: {
              groups: [{ rollout_percentage: 100 }],
              multivariate: {
                variants: [
                  { key: 'control', rollout_percentage: 50 },
                  { key: 'test', rollout_percentage: 50 },
                ],
              },
              payloads: {
                control: '{"version": "control"}',
                test: '{"version": "test"}',
              },
            },
          },
        ],
      }
      mockedFetch.mockImplementation(apiImplementation({ localFlags }))

      const posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      const result = await posthog.getFeatureFlagResult('multivariate-flag', 'test-user-id')

      expect(result).toMatchObject({
        key: 'multivariate-flag',
        enabled: true,
      })
      expect(result?.variant).toBeDefined()
      expect(['control', 'test']).toContain(result?.variant)
      expect(result?.payload).toBeDefined()

      await posthog.shutdown()
    })

    it('returns undefined when onlyEvaluateLocally is true and flag cannot be evaluated locally', async () => {
      const localFlags = {
        flags: [
          {
            id: 1,
            name: 'Cohort Flag',
            key: 'cohort-flag',
            active: true,
            filters: {
              groups: [
                {
                  properties: [{ key: 'id', value: 123, operator: undefined, type: 'cohort' }],
                  rollout_percentage: 100,
                },
              ],
            },
          },
        ],
      }
      mockedFetch.mockImplementation(apiImplementation({ localFlags }))

      const posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      const result = await posthog.getFeatureFlagResult('cohort-flag', 'some-distinct-id', {
        onlyEvaluateLocally: true,
      })

      expect(result).toBeUndefined()

      await posthog.shutdown()
    })

    it('captures $feature_flag_called event with locally_evaluated: true', async () => {
      const localFlags = {
        flags: [
          {
            id: 55,
            name: 'Simple Flag',
            key: 'simple-flag',
            active: true,
            filters: {
              groups: [{ rollout_percentage: 100 }],
            },
          },
        ],
      }
      mockedFetch.mockImplementation(apiImplementation({ localFlags }))

      const posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      let capturedMessage: any
      posthog.on('capture', (message) => {
        capturedMessage = message
      })

      await posthog.getFeatureFlagResult('simple-flag', 'some-distinct-id')

      await waitForPromises()
      expect(capturedMessage).toMatchObject({
        event: '$feature_flag_called',
        properties: {
          $feature_flag: 'simple-flag',
          $feature_flag_response: true,
          $feature_flag_id: 55,
          locally_evaluated: true,
        },
      })

      await posthog.shutdown()
    })
  })
})
