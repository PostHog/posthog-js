import { PostHogPersistedProperty, PostHogV2FlagsResponse } from '@/types'
import { normalizeFlagsResponse } from '@/featureFlagUtils'
import {
  parseBody,
  waitForPromises,
  createTestClient,
  PostHogCoreTestClient,
  PostHogCoreTestClientMocks,
} from '@/testing'

describe('PostHog Feature Flags v4', () => {
  let posthog: PostHogCoreTestClient
  let mocks: PostHogCoreTestClientMocks

  jest.useFakeTimers()
  jest.setSystemTime(new Date('2022-01-01'))

  const createMockFeatureFlags = (): Partial<PostHogV2FlagsResponse['flags']> => ({
    'feature-1': {
      key: 'feature-1',
      enabled: true,
      variant: undefined,
      reason: {
        code: 'matched_condition',
        description: 'matched condition set 1',
        condition_index: 0,
      },
      metadata: {
        id: 1,
        version: 1,
        description: 'feature-1',
        payload: '{"color":"blue"}',
      },
    },
    'feature-2': {
      key: 'feature-2',
      enabled: true,
      variant: undefined,
      reason: {
        code: 'matched_condition',
        description: 'matched condition set 2',
        condition_index: 1,
      },
      metadata: {
        id: 2,
        version: 42,
        description: 'feature-2',
        payload: undefined,
      },
    },
    'feature-variant': {
      key: 'feature-variant',
      enabled: true,
      variant: 'variant',
      reason: {
        code: 'matched_condition',
        description: 'matched condition set 3',
        condition_index: 2,
      },
      metadata: {
        id: 3,
        version: 1,
        description: 'feature-variant',
        payload: '[5]',
      },
    },
    'json-payload': {
      key: 'json-payload',
      enabled: true,
      variant: undefined,
      reason: {
        code: 'matched_condition',
        description: 'matched condition set 4',
        condition_index: 4,
      },
      metadata: {
        id: 4,
        version: 1,
        description: 'json-payload',
        payload: '{"a":"payload"}',
      },
    },
  })

  const expectedFeatureFlagResponses = {
    'feature-1': true,
    'feature-2': true,
    'feature-variant': 'variant',
    'json-payload': true,
  }

  const errorAPIResponse = Promise.resolve({
    status: 400,
    text: () => Promise.resolve('error'),
    json: () =>
      Promise.resolve({
        status: 'error',
      }),
  })

  beforeEach(() => {
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 }, (_mocks) => {
      _mocks.fetch.mockImplementation((url) => {
        if (url.includes('/flags/?v=2')) {
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve('ok'),
            json: () =>
              Promise.resolve({
                flags: createMockFeatureFlags(),
                requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
                evaluatedAt: 1640995200000,
              }),
          })
        }

        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () =>
            Promise.resolve({
              status: 'ok',
            }),
        })
      })
    })
  })

  describe('featureflags', () => {
    it('getFeatureFlags should return undefined if not loaded', () => {
      expect(posthog.getFeatureFlags()).toEqual(undefined)
    })

    it('getFeatureFlagPayloads should return undefined if not loaded', () => {
      expect(posthog.getFeatureFlagPayloads()).toEqual(undefined)
    })

    it('getFeatureFlag should return undefined if not loaded', () => {
      expect(posthog.getFeatureFlag('my-flag')).toEqual(undefined)
      expect(posthog.getFeatureFlag('feature-1')).toEqual(undefined)
    })

    it('getFeatureFlagPayload should return undefined if not loaded', () => {
      expect(posthog.getFeatureFlagPayload('my-flag')).toEqual(undefined)
    })

    it('isFeatureEnabled should return undefined if not loaded', () => {
      expect(posthog.isFeatureEnabled('my-flag')).toEqual(undefined)
      expect(posthog.isFeatureEnabled('feature-1')).toEqual(undefined)
    })

    it('should load persisted feature flags', () => {
      const flagsResponse = { flags: createMockFeatureFlags() } as PostHogV2FlagsResponse
      const normalizedFeatureFlags = normalizeFlagsResponse(flagsResponse)
      posthog.setPersistedProperty(PostHogPersistedProperty.FeatureFlagDetails, normalizedFeatureFlags)
      expect(posthog.getFeatureFlags()).toEqual(expectedFeatureFlagResponses)
    })

    it('should queue only one pending reload when called multiple times during in-flight request', async () => {
      // Multiple calls during an in-flight request should:
      // 1. Not make multiple immediate calls
      // 2. Queue a pending reload that executes after the first completes
      expect(mocks.fetch).toHaveBeenCalledTimes(0)
      posthog.reloadFeatureFlagsAsync()
      posthog.reloadFeatureFlagsAsync()
      const flags = await posthog.reloadFeatureFlagsAsync()
      await waitForPromises() // Wait for pending reload to complete
      // First call + one pending reload = 2 calls
      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      expect(flags).toEqual(expectedFeatureFlagResponses)
    })

    it('should execute pending reload after current request completes', async () => {
      // This test verifies the fix for the race condition where identify() calls
      // with $anon_distinct_id were dropped when preloadFeatureFlags was in flight.
      // See: https://github.com/PostHog/posthog-ios/issues/456

      let resolveFirstRequest: () => void
      let resolveSecondRequest: () => void
      let fetchCallCount = 0

      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 }, (_mocks) => {
        _mocks.fetch.mockImplementation((url) => {
          if (url.includes('/flags/')) {
            fetchCallCount++
            const currentCall = fetchCallCount

            if (currentCall === 1) {
              // First request - delay to simulate network latency
              return new Promise((resolve) => {
                resolveFirstRequest = () =>
                  resolve({
                    status: 200,
                    text: () => Promise.resolve('ok'),
                    json: () =>
                      Promise.resolve({
                        flags: createMockFeatureFlags(),
                        requestId: 'first-request',
                        evaluatedAt: 1640995200000,
                      }),
                  })
              })
            } else {
              // Second request (pending reload)
              return new Promise((resolve) => {
                resolveSecondRequest = () =>
                  resolve({
                    status: 200,
                    text: () => Promise.resolve('ok'),
                    json: () =>
                      Promise.resolve({
                        flags: createMockFeatureFlags(),
                        requestId: 'second-request',
                        evaluatedAt: 1640995200001,
                      }),
                  })
              })
            }
          }

          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve('ok'),
            json: () => Promise.resolve({ status: 'ok' }),
          })
        })
      })

      // Start first request (simulates preloadFeatureFlags)
      const firstReload = posthog.reloadFeatureFlagsAsync()

      // Wait a tick to ensure first request is in flight
      await waitForPromises()

      // Start second request while first is in flight (simulates identify() -> reloadFeatureFlags())
      const secondReload = posthog.reloadFeatureFlagsAsync()

      // At this point, fetch should have been called once
      expect(fetchCallCount).toBe(1)

      // Complete the first request
      resolveFirstRequest!()
      await firstReload
      await waitForPromises()

      // After first request completes, the pending reload should be triggered
      // and fetch should be called again
      expect(fetchCallCount).toBe(2)

      // Complete the second request
      resolveSecondRequest!()
      await secondReload
      await waitForPromises()

      // Both requests should have completed
      expect(fetchCallCount).toBe(2)
    })

    it('should emit featureflags event when flags are loaded', async () => {
      const receivedFlags: any[] = []
      const unsubscribe = posthog.onFeatureFlags((flags) => {
        receivedFlags.push(flags)
      })

      await posthog.reloadFeatureFlagsAsync()
      unsubscribe()

      expect(receivedFlags).toEqual([expectedFeatureFlagResponses])
    })

    describe('when loaded', () => {
      beforeEach(() => {
        // The core doesn't reload flags by default (this is handled differently by web and RN)
        posthog.reloadFeatureFlags()
      })

      it('should return the value of a flag', async () => {
        expect(posthog.getFeatureFlag('feature-1')).toEqual(true)
        expect(posthog.getFeatureFlag('feature-variant')).toEqual('variant')
        expect(posthog.getFeatureFlag('feature-missing')).toEqual(false)
      })

      it.each([
        ['feature-variant', [5]],
        ['feature-1', { color: 'blue' }],
        ['feature-2', null],
      ])('should return correct payload for flag %s', (flagKey, expectedPayload) => {
        expect(posthog.getFeatureFlagPayload(flagKey)).toEqual(expectedPayload)
      })

      describe('when errored out', () => {
        beforeEach(() => {
          ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 }, (_mocks) => {
            _mocks.fetch.mockImplementation((url) => {
              if (url.includes('/flags/')) {
                return Promise.resolve({
                  status: 400,
                  text: () => Promise.resolve('ok'),
                  json: () =>
                    Promise.resolve({
                      error: 'went wrong',
                    }),
                })
              }

              return errorAPIResponse
            })
          })

          posthog.reloadFeatureFlags()
        })

        it('should return undefined', async () => {
          expect(mocks.fetch).toHaveBeenCalledWith('https://us.i.posthog.com/flags/?v=2', {
            body: JSON.stringify({
              token: 'TEST_API_KEY',
              distinct_id: posthog.getDistinctId(),
              groups: {},
              person_properties: {},
              group_properties: {},
              $anon_distinct_id: posthog.getAnonymousId(),
            }),
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'posthog-core-tests',
            },
            signal: expect.anything(),
          })

          expect(posthog.getFeatureFlag('feature-1')).toEqual(undefined)
          expect(posthog.getFeatureFlag('feature-variant')).toEqual(undefined)
          expect(posthog.getFeatureFlag('feature-missing')).toEqual(undefined)

          expect(posthog.isFeatureEnabled('feature-1')).toEqual(undefined)
          expect(posthog.isFeatureEnabled('feature-variant')).toEqual(undefined)
          expect(posthog.isFeatureEnabled('feature-missing')).toEqual(undefined)

          // When errored out, we return cached values (which are empty in this case)
          expect(posthog.getFeatureFlagPayloads()).toEqual({})
          expect(posthog.getFeatureFlagPayload('feature-1')).toEqual(null)
        })
      })

      describe('when subsequent flags calls return partial results', () => {
        beforeEach(() => {
          ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 }, (_mocks) => {
            _mocks.fetch
              .mockImplementationOnce((url) => {
                if (url.includes('/flags/?v=2')) {
                  return Promise.resolve({
                    status: 200,
                    text: () => Promise.resolve('ok'),
                    json: () =>
                      Promise.resolve({
                        flags: createMockFeatureFlags(),
                      }),
                  })
                }
                return errorAPIResponse
              })
              .mockImplementationOnce((url) => {
                if (url.includes('/flags/?v=2')) {
                  return Promise.resolve({
                    status: 200,
                    text: () => Promise.resolve('ok'),
                    json: () =>
                      Promise.resolve({
                        flags: {
                          'x-flag': {
                            key: 'x-flag',
                            enabled: true,
                            variant: 'x-value',
                            reason: {
                              code: 'matched_condition',
                              description: 'matched condition set 5',
                              condition_index: 0,
                            },
                            metadata: {
                              id: 5,
                              version: 1,
                              description: 'x-flag',
                              payload: '{"x":"value"}',
                            },
                          },
                          'feature-1': {
                            key: 'feature-1',
                            enabled: false,
                            variant: undefined,
                            reason: {
                              code: 'matched_condition',
                              description: 'matched condition set 6',
                              condition_index: 0,
                            },
                            metadata: {
                              id: 6,
                              version: 1,
                              description: 'feature-1',
                              payload: '{"color":"blue"}',
                            },
                          },
                        },
                        errorsWhileComputingFlags: true,
                      }),
                  })
                }

                return errorAPIResponse
              })
              .mockImplementation(() => {
                return errorAPIResponse
              })
          })

          posthog.reloadFeatureFlags()
        })

        it('should return combined results', async () => {
          expect(mocks.fetch).toHaveBeenCalledWith('https://us.i.posthog.com/flags/?v=2', {
            body: JSON.stringify({
              token: 'TEST_API_KEY',
              distinct_id: posthog.getDistinctId(),
              groups: {},
              person_properties: {},
              group_properties: {},
              $anon_distinct_id: posthog.getAnonymousId(),
            }),
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'posthog-core-tests',
            },
            signal: expect.anything(),
          })

          expect(posthog.getFeatureFlags()).toEqual({
            'feature-1': true,
            'feature-2': true,
            'json-payload': true,
            'feature-variant': 'variant',
          })

          // now second call to feature flags
          await posthog.reloadFeatureFlagsAsync()

          expect(mocks.fetch).toHaveBeenCalledWith('https://us.i.posthog.com/flags/?v=2', {
            body: JSON.stringify({
              token: 'TEST_API_KEY',
              distinct_id: posthog.getDistinctId(),
              groups: {},
              person_properties: {},
              group_properties: {},
              $anon_distinct_id: posthog.getAnonymousId(),
            }),
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'posthog-core-tests',
            },
            signal: expect.anything(),
          })

          expect(posthog.getFeatureFlags()).toEqual({
            'feature-1': false,
            'feature-2': true,
            'json-payload': true,
            'feature-variant': 'variant',
            'x-flag': 'x-value',
          })

          expect(posthog.getFeatureFlag('feature-1')).toEqual(false)
          expect(posthog.getFeatureFlag('feature-variant')).toEqual('variant')
          expect(posthog.getFeatureFlag('feature-missing')).toEqual(false)
          expect(posthog.getFeatureFlag('x-flag')).toEqual('x-value')

          expect(posthog.isFeatureEnabled('feature-1')).toEqual(false)
          expect(posthog.isFeatureEnabled('feature-variant')).toEqual(true)
          expect(posthog.isFeatureEnabled('feature-missing')).toEqual(false)
          expect(posthog.isFeatureEnabled('x-flag')).toEqual(true)
        })
      })

      describe('when subsequent flags calls return failed flags with errorsWhileComputingFlags', () => {
        beforeEach(() => {
          ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 }, (_mocks) => {
            _mocks.fetch
              .mockImplementationOnce((url) => {
                if (url.includes('/flags/?v=2')) {
                  return Promise.resolve({
                    status: 200,
                    text: () => Promise.resolve('ok'),
                    json: () =>
                      Promise.resolve({
                        flags: createMockFeatureFlags(),
                      }),
                  })
                }
                return errorAPIResponse
              })
              .mockImplementationOnce((url) => {
                if (url.includes('/flags/?v=2')) {
                  return Promise.resolve({
                    status: 200,
                    text: () => Promise.resolve('ok'),
                    json: () =>
                      Promise.resolve({
                        flags: {
                          'x-flag': {
                            key: 'x-flag',
                            enabled: true,
                            variant: 'x-value',
                            failed: false,
                            reason: {
                              code: 'matched_condition',
                              description: 'matched condition set 5',
                              condition_index: 0,
                            },
                            metadata: {
                              id: 5,
                              version: 1,
                              description: 'x-flag',
                              payload: '{"x":"value"}',
                            },
                          },
                          'feature-1': {
                            key: 'feature-1',
                            enabled: false,
                            variant: undefined,
                            failed: true,
                            reason: {
                              code: 'database_error',
                              description: 'Database connection error during evaluation',
                              condition_index: undefined,
                            },
                            metadata: {
                              id: 1,
                              version: 1,
                              description: 'feature-1',
                              payload: undefined,
                            },
                          },
                        },
                        errorsWhileComputingFlags: true,
                      }),
                  })
                }

                return errorAPIResponse
              })
              .mockImplementation(() => {
                return errorAPIResponse
              })
          })

          posthog.reloadFeatureFlags()
        })

        it('should filter out failed flags and preserve their cached values', async () => {
          expect(posthog.getFeatureFlags()).toEqual({
            'feature-1': true,
            'feature-2': true,
            'json-payload': true,
            'feature-variant': 'variant',
          })

          // second call returns feature-1 as failed (should be filtered out)
          // and x-flag as successful (should be merged in)
          await posthog.reloadFeatureFlagsAsync()

          // feature-1 should retain its cached value (true), not be overwritten with false
          expect(posthog.getFeatureFlags()).toEqual({
            'feature-1': true,
            'feature-2': true,
            'json-payload': true,
            'feature-variant': 'variant',
            'x-flag': 'x-value',
          })

          expect(posthog.getFeatureFlag('feature-1')).toEqual(true)
          expect(posthog.getFeatureFlag('x-flag')).toEqual('x-value')
          expect(posthog.isFeatureEnabled('feature-1')).toEqual(true)
        })
      })

      describe('when subsequent flags calls return results without errors', () => {
        beforeEach(() => {
          ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 }, (_mocks) => {
            _mocks.fetch
              .mockImplementationOnce((url) => {
                if (url.includes('/flags/?v=2')) {
                  return Promise.resolve({
                    status: 200,
                    text: () => Promise.resolve('ok'),
                    json: () =>
                      Promise.resolve({
                        flags: createMockFeatureFlags(),
                        requestId: '18043bf7-9cf6-44cd-b959-9662ee20d371',
                      }),
                  })
                }
                return errorAPIResponse
              })
              .mockImplementationOnce((url) => {
                if (url.includes('/flags/?v=2')) {
                  return Promise.resolve({
                    status: 200,
                    text: () => Promise.resolve('ok'),
                    json: () =>
                      Promise.resolve({
                        flags: {
                          'x-flag': {
                            key: 'x-flag',
                            enabled: true,
                            variant: 'x-value',
                            reason: {
                              code: 'matched_condition',
                              description: 'matched condition set 5',
                              condition_index: 0,
                            },
                            metadata: {
                              id: 5,
                              version: 1,
                              description: 'x-flag',
                              payload: '{"x":"value"}',
                            },
                          },
                          'feature-1': {
                            key: 'feature-1',
                            enabled: false,
                            variant: undefined,
                            reason: {
                              code: 'matched_condition',
                              description: 'matched condition set 6',
                              condition_index: 0,
                            },
                            metadata: {
                              id: 6,
                              version: 1,
                              description: 'feature-1',
                              payload: '{"color":"blue"}',
                            },
                          },
                        },
                        errorsWhileComputingFlags: false,
                        requestId: 'bccd3c21-38e6-4499-a804-89f77ddcd1fc',
                      }),
                  })
                }

                return errorAPIResponse
              })
              .mockImplementation(() => {
                return errorAPIResponse
              })
          })

          posthog.reloadFeatureFlags()
        })

        it('should return only latest results', async () => {
          expect(mocks.fetch).toHaveBeenCalledWith('https://us.i.posthog.com/flags/?v=2', {
            body: JSON.stringify({
              token: 'TEST_API_KEY',
              distinct_id: posthog.getDistinctId(),
              groups: {},
              person_properties: {},
              group_properties: {},
              $anon_distinct_id: posthog.getAnonymousId(),
            }),
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'posthog-core-tests',
            },
            signal: expect.anything(),
          })

          expect(posthog.getFeatureFlags()).toEqual({
            'feature-1': true,
            'feature-2': true,
            'json-payload': true,
            'feature-variant': 'variant',
          })

          // now second call to feature flags
          await posthog.reloadFeatureFlagsAsync()

          expect(mocks.fetch).toHaveBeenCalledWith('https://us.i.posthog.com/flags/?v=2', {
            body: JSON.stringify({
              token: 'TEST_API_KEY',
              distinct_id: posthog.getDistinctId(),
              groups: {},
              person_properties: {},
              group_properties: {},
              $anon_distinct_id: posthog.getAnonymousId(),
            }),
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'posthog-core-tests',
            },
            signal: expect.anything(),
          })

          expect(posthog.getFeatureFlags()).toEqual({
            'feature-1': false,
            'x-flag': 'x-value',
          })

          expect(posthog.getFeatureFlag('feature-1')).toEqual(false)
          expect(posthog.getFeatureFlag('feature-variant')).toEqual(false)
          expect(posthog.getFeatureFlag('feature-missing')).toEqual(false)
          expect(posthog.getFeatureFlag('x-flag')).toEqual('x-value')

          expect(posthog.isFeatureEnabled('feature-1')).toEqual(false)
          expect(posthog.isFeatureEnabled('feature-variant')).toEqual(false)
          expect(posthog.isFeatureEnabled('feature-missing')).toEqual(false)
          expect(posthog.isFeatureEnabled('x-flag')).toEqual(true)
        })
      })

      it('should return the boolean value of a flag', async () => {
        expect(posthog.isFeatureEnabled('feature-1')).toEqual(true)
        expect(posthog.isFeatureEnabled('feature-variant')).toEqual(true)
        expect(posthog.isFeatureEnabled('feature-missing')).toEqual(false)
      })

      it('should reload if groups are set', async () => {
        posthog.group('my-group', 'is-great')
        await waitForPromises()
        // 3 calls: 1 for flags reload, 1 for $groupidentify batch, 1 for flags decide
        expect(mocks.fetch).toHaveBeenCalledTimes(3)
        // The flags reload call contains the group
        const flagsCall = mocks.fetch.mock.calls.find((call) => {
          try {
            const body = JSON.parse((call[1].body as string) || '')
            return body.groups?.['my-group'] === 'is-great'
          } catch {
            return false
          }
        })
        expect(flagsCall).toBeDefined()
        expect(JSON.parse((flagsCall![1].body as string) || '')).toMatchObject({
          groups: { 'my-group': 'is-great' },
        })
      })

      it.each([
        {
          key: 'feature-1',
          expected_response: true,
          expected_id: 1,
          expected_version: 1,
          expected_reason: 'matched condition set 1',
        },
        {
          key: 'feature-2',
          expected_response: true,
          expected_id: 2,
          expected_version: 42,
          expected_reason: 'matched condition set 2',
        },
        {
          key: 'feature-variant',
          expected_response: 'variant',
          expected_id: 3,
          expected_version: 1,
          expected_reason: 'matched condition set 3',
        },
        {
          key: 'json-payload',
          expected_response: true,
          expected_id: 4,
          expected_version: 1,
          expected_reason: 'matched condition set 4',
        },
      ])(
        'should capture feature_flag_called when called for %s',
        async ({ key, expected_response, expected_id, expected_version, expected_reason }) => {
          expect(posthog.getFeatureFlag(key)).toEqual(expected_response)
          await waitForPromises()
          expect(mocks.fetch).toHaveBeenCalledTimes(2)

          expect(parseBody(mocks.fetch.mock.calls[1])).toMatchObject({
            batch: [
              {
                event: '$feature_flag_called',
                distinct_id: posthog.getDistinctId(),
                properties: {
                  $feature_flag: key,
                  $feature_flag_response: expected_response,
                  $feature_flag_id: expected_id,
                  $feature_flag_version: expected_version,
                  $feature_flag_reason: expected_reason,
                  '$feature/feature-1': true,
                  $used_bootstrap_value: false,
                  $feature_flag_request_id: '0152a345-295f-4fba-adac-2e6ea9c91082',
                  $feature_flag_evaluated_at: expect.any(Number),
                },
              },
            ],
          })

          // Only tracked once
          expect(posthog.getFeatureFlag('feature-1')).toEqual(true)
          expect(mocks.fetch).toHaveBeenCalledTimes(2)
        }
      )

      describe('$feature_flag_has_experiment', () => {
        const mockFlagsWithMetadata = (metadata: Record<string, any>): void => {
          mocks.fetch.mockImplementation((url) => {
            if (url.includes('/flags/?v=2')) {
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () =>
                  Promise.resolve({
                    flags: {
                      'feature-1': {
                        key: 'feature-1',
                        enabled: true,
                        variant: undefined,
                        reason: undefined,
                        metadata,
                      },
                    },
                  }),
              })
            }

            return Promise.resolve({
              status: 200,
              text: () => Promise.resolve('ok'),
              json: () => Promise.resolve({ status: 'ok' }),
            })
          })
        }

        const getFlagCalledProperties = async (): Promise<Record<string, any>> => {
          await posthog.reloadFeatureFlagsAsync()
          posthog.getFeatureFlag('feature-1')
          await waitForPromises()
          const event = mocks.fetch.mock.calls
            .flatMap((call) => parseBody(call)?.batch ?? [])
            .find((e: any) => e.event === '$feature_flag_called')
          return event.properties
        }

        it('should send $feature_flag_has_experiment true when the server reports has_experiment true', async () => {
          mockFlagsWithMetadata({ id: 1, version: 1, description: undefined, payload: undefined, has_experiment: true })

          expect(await getFlagCalledProperties()).toMatchObject({ $feature_flag_has_experiment: true })
        })

        it('should send $feature_flag_has_experiment false when the server reports has_experiment false', async () => {
          mockFlagsWithMetadata({
            id: 1,
            version: 1,
            description: undefined,
            payload: undefined,
            has_experiment: false,
          })

          expect(await getFlagCalledProperties()).toMatchObject({ $feature_flag_has_experiment: false })
        })

        it('should send $feature_flag_has_experiment false when the server omits has_experiment', async () => {
          mockFlagsWithMetadata({ id: 1, version: 1, description: undefined, payload: undefined })

          expect(await getFlagCalledProperties()).toMatchObject({ $feature_flag_has_experiment: false })
        })
      })

      it('should not capture $feature_flag_called again if reloaded flags keep the same value', async () => {
        expect(posthog.getFeatureFlag('feature-1')).toEqual(true)
        await waitForPromises()
        expect(mocks.fetch).toHaveBeenCalledTimes(2)

        expect(parseBody(mocks.fetch.mock.calls[1])).toMatchObject({
          batch: [
            {
              event: '$feature_flag_called',
              distinct_id: posthog.getDistinctId(),
              properties: {
                $feature_flag: 'feature-1',
                $feature_flag_response: true,
                '$feature/feature-1': true,
                $used_bootstrap_value: false,
                $feature_flag_request_id: '0152a345-295f-4fba-adac-2e6ea9c91082',
                $feature_flag_evaluated_at: expect.any(Number),
              },
            },
          ],
        })

        await posthog.reloadFeatureFlagsAsync()
        posthog.getFeatureFlag('feature-1')

        await waitForPromises()
        expect(mocks.fetch).toHaveBeenCalledTimes(3)
      })

      it('should capture $feature_flag_called when called, but not add all cached flags', async () => {
        expect(posthog.getFeatureFlag('feature-1')).toEqual(true)
        await waitForPromises()
        expect(mocks.fetch).toHaveBeenCalledTimes(2)

        expect(parseBody(mocks.fetch.mock.calls[1])).toMatchObject({
          batch: [
            {
              event: '$feature_flag_called',
              distinct_id: posthog.getDistinctId(),
              properties: {
                $feature_flag: 'feature-1',
                $feature_flag_response: true,
                '$feature/feature-1': true,
                $used_bootstrap_value: false,
              },
            },
          ],
        })

        // Only tracked once
        expect(posthog.getFeatureFlag('feature-1')).toEqual(true)
        expect(mocks.fetch).toHaveBeenCalledTimes(2)
      })

      it('should persist feature flags', () => {
        const expectedFeatureFlags = {
          flags: createMockFeatureFlags(),
          requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
          evaluatedAt: 1640995200000,
        }
        const normalizedFeatureFlags = normalizeFlagsResponse(expectedFeatureFlags as PostHogV2FlagsResponse)

        expect(posthog.getPersistedProperty(PostHogPersistedProperty.FeatureFlagDetails)).toEqual({
          flags: normalizedFeatureFlags.flags,
          requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
          evaluatedAt: 1640995200000,
          errorsWhileComputingFlags: undefined,
          quotaLimited: undefined,
        })
      })

      it('should include feature flags in subsequent captures', async () => {
        posthog.capture('test-event', { foo: 'bar' })

        await waitForPromises()

        expect(parseBody(mocks.fetch.mock.calls[1])).toMatchObject({
          batch: [
            {
              event: 'test-event',
              distinct_id: posthog.getDistinctId(),
              properties: {
                $active_feature_flags: ['feature-1', 'feature-2', 'feature-variant', 'json-payload'],
                '$feature/feature-1': true,
                '$feature/feature-2': true,
                '$feature/json-payload': true,
                '$feature/feature-variant': 'variant',
              },
            },
          ],
        })
      })

      it.each([
        ['a string variant', 'server-value'],
        ['boolean false (client-side disable)', false],
        ['null', null],
      ])('lets a caller-supplied $feature/* value (%s) override the cached value', async (_case, overrideValue) => {
        posthog.capture('test-event', {
          '$feature/feature-1': overrideValue,
          $active_feature_flags: ['server-flag'],
        })

        await waitForPromises()

        expect(parseBody(mocks.fetch.mock.calls[1])).toMatchObject({
          batch: [
            {
              event: 'test-event',
              properties: {
                '$feature/feature-1': overrideValue,
                $active_feature_flags: ['server-flag'],
                '$feature/feature-2': true,
              },
            },
          ],
        })
      })

      it('should override flags', () => {
        posthog.overrideFeatureFlag({
          'feature-2': false,
          'feature-variant': 'control',
        })

        const received = posthog.getFeatureFlags()

        expect(received).toEqual({
          'json-payload': true,
          'feature-1': true,
          'feature-variant': 'control',
        })
      })

      describe('getAllFeatureFlags', () => {
        it('returns all loaded flags as results', () => {
          const results = posthog.getAllFeatureFlags()
          expect(results).toHaveLength(4)
          expect(results).toEqual(
            expect.arrayContaining([
              { key: 'feature-1', enabled: true, variant: undefined, payload: { color: 'blue' } },
              { key: 'feature-2', enabled: true, variant: undefined, payload: null },
              { key: 'feature-variant', enabled: true, variant: 'variant', payload: [5] },
              { key: 'json-payload', enabled: true, variant: undefined, payload: { a: 'payload' } },
            ])
          )
        })

        it('returns an empty array when flags are not loaded', () => {
          const [freshPosthog] = createTestClient('TEST_API_KEY', { flushAt: 1 })
          expect(freshPosthog.getAllFeatureFlags()).toEqual([])
        })

        it('does not send a $feature_flag_called event', async () => {
          posthog.getAllFeatureFlags()
          await waitForPromises()
          const calledEvents = mocks.fetch.mock.calls.filter((call) =>
            JSON.stringify(call).includes('$feature_flag_called')
          )
          expect(calledEvents).toHaveLength(0)
        })

        it('includes disabled flags loaded from the server as enabled: false', async () => {
          const [client] = createTestClient('TEST_API_KEY', { flushAt: 1 }, (_mocks) => {
            _mocks.fetch.mockImplementation((url) => {
              if (url.includes('/flags/?v=2')) {
                return Promise.resolve({
                  status: 200,
                  text: () => Promise.resolve('ok'),
                  json: () =>
                    Promise.resolve({
                      flags: {
                        'feature-1': createMockFeatureFlags()['feature-1'],
                        'off-flag': {
                          key: 'off-flag',
                          enabled: false,
                          variant: undefined,
                          reason: undefined,
                          metadata: { id: 9, version: 1, description: undefined, payload: undefined },
                        },
                      },
                    }),
                })
              }
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () => Promise.resolve({ status: 'ok' }),
              })
            })
          })

          client.reloadFeatureFlags()
          await waitForPromises()

          expect(client.getAllFeatureFlags()).toEqual(
            expect.arrayContaining([
              { key: 'feature-1', enabled: true, variant: undefined, payload: { color: 'blue' } },
              { key: 'off-flag', enabled: false, variant: undefined, payload: null },
            ])
          )
        })
      })

      describe('getFeatureFlagResult', () => {
        it('should return correct result for a boolean flag', () => {
          const result = posthog.getFeatureFlagResult('feature-1')
          expect(result).toEqual({
            key: 'feature-1',
            enabled: true,
            variant: undefined,
            payload: { color: 'blue' },
          })
        })

        it('should return correct result for a multivariate flag', () => {
          const result = posthog.getFeatureFlagResult('feature-variant')
          expect(result).toEqual({
            key: 'feature-variant',
            enabled: true,
            variant: 'variant',
            payload: [5],
          })
        })

        it('should return undefined for a missing flag', () => {
          expect(posthog.getFeatureFlagResult('nonexistent-flag')).toEqual(undefined)
        })

        it('should return undefined when flags are not loaded at all', () => {
          const [freshPosthog] = createTestClient('TEST_API_KEY', { flushAt: 1 })
          expect(freshPosthog.getFeatureFlagResult('feature-1')).toEqual(undefined)
        })

        it('should return correct results when only legacy v1 persisted data exists', () => {
          const [legacyPosthog] = createTestClient('TEST_API_KEY', { flushAt: 1 }, undefined, {
            [PostHogPersistedProperty.FeatureFlags]: { 'feature-1': true },
            [PostHogPersistedProperty.FeatureFlagPayloads]: { 'feature-1': '{"color":"blue"}' },
          })

          expect(legacyPosthog.getFeatureFlagResult('feature-1')).toEqual({
            key: 'feature-1',
            enabled: true,
            variant: undefined,
            payload: { color: 'blue' },
          })

          // Missing flag when flags are loaded should return null, not undefined
          expect(legacyPosthog.getFeatureFlagPayload('missing-flag')).toEqual(null)
        })

        it('should send $feature_flag_called event on first call', async () => {
          posthog.getFeatureFlagResult('feature-1')
          await waitForPromises()
          expect(mocks.fetch).toHaveBeenCalledTimes(2)

          expect(parseBody(mocks.fetch.mock.calls[1])).toMatchObject({
            batch: [
              {
                event: '$feature_flag_called',
                distinct_id: posthog.getDistinctId(),
                properties: {
                  $feature_flag: 'feature-1',
                  $feature_flag_response: true,
                  $feature_flag_id: 1,
                  $feature_flag_version: 1,
                  $feature_flag_reason: 'matched condition set 1',
                  $used_bootstrap_value: false,
                  $feature_flag_request_id: '0152a345-295f-4fba-adac-2e6ea9c91082',
                  $feature_flag_evaluated_at: 1640995200000,
                },
              },
            ],
          })
        })

        it('should NOT send event when sendEvent: false', async () => {
          posthog.getFeatureFlagResult('feature-1', { sendEvent: false })
          await waitForPromises()
          // Only the flags fetch call, no event capture
          expect(mocks.fetch).toHaveBeenCalledTimes(1)
        })

        it.each([
          ['getFeatureFlag', () => posthog.getFeatureFlag('feature-1', { sendEvent: false })],
          ['isFeatureEnabled', () => posthog.isFeatureEnabled('feature-1', { sendEvent: false })],
        ] as const)('should NOT send event from %s when sendEvent: false', async (_, callFn) => {
          expect(callFn()).toEqual(true)
          await waitForPromises()
          // Only the flags fetch call, no event capture
          expect(mocks.fetch).toHaveBeenCalledTimes(1)
        })

        it('should NOT send duplicate events for the same flag key', async () => {
          posthog.getFeatureFlagResult('feature-1')
          await waitForPromises()
          expect(mocks.fetch).toHaveBeenCalledTimes(2)

          posthog.getFeatureFlagResult('feature-1')
          await waitForPromises()
          // Still only 2 calls — no second event
          expect(mocks.fetch).toHaveBeenCalledTimes(2)
        })

        it('should not send event again after reloadFeatureFlagsAsync if the value is unchanged', async () => {
          posthog.getFeatureFlagResult('feature-1')
          await waitForPromises()
          expect(mocks.fetch).toHaveBeenCalledTimes(2)

          await posthog.reloadFeatureFlagsAsync()
          posthog.getFeatureFlagResult('feature-1')
          await waitForPromises()
          // flags reload only, no second event for the same flag value
          expect(mocks.fetch).toHaveBeenCalledTimes(3)
        })

        it('should respect instance-level sendFeatureFlagEvent: false', async () => {
          const [noEventPosthog, noEventMocks] = createTestClient(
            'TEST_API_KEY',
            { flushAt: 1, sendFeatureFlagEvent: false },
            (_mocks) => {
              _mocks.fetch.mockImplementation((url) => {
                return Promise.resolve({
                  status: 200,
                  text: () => Promise.resolve('ok'),
                  json: () =>
                    Promise.resolve({
                      flags: createMockFeatureFlags(),
                      requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
                    }),
                })
              })
            }
          )
          noEventPosthog.reloadFeatureFlags()
          await waitForPromises()

          noEventPosthog.getFeatureFlagResult('feature-1')
          await waitForPromises()

          expect(noEventMocks.fetch).toHaveBeenCalledTimes(1)
        })

        it('should include $feature_flag_error FLAG_MISSING for a missing flag when flags are cached', async () => {
          posthog.getFeatureFlagResult('nonexistent-flag')
          await waitForPromises()

          expect(parseBody(mocks.fetch.mock.calls[1])).toMatchObject({
            batch: [
              {
                event: '$feature_flag_called',
                properties: {
                  $feature_flag: 'nonexistent-flag',
                  $feature_flag_error: 'flag_missing',
                },
              },
            ],
          })
        })
      })
    })

    describe('when quota limited', () => {
      beforeEach(() => {
        ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 }, (_mocks) => {
          _mocks.fetch.mockImplementation((url) => {
            if (url.includes('/flags/')) {
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () =>
                  Promise.resolve({
                    quotaLimited: ['feature_flags'],
                    flags: {},
                  }),
              })
            }
            return errorAPIResponse
          })
        })

        posthog.reloadFeatureFlags()
      })

      it('should unset all flags when feature_flags is quota limited', async () => {
        // First verify the fetch was called correctly
        expect(mocks.fetch).toHaveBeenCalledWith('https://us.i.posthog.com/flags/?v=2', {
          body: JSON.stringify({
            token: 'TEST_API_KEY',
            distinct_id: posthog.getDistinctId(),
            groups: {},
            person_properties: {},
            group_properties: {},
            $anon_distinct_id: posthog.getAnonymousId(),
          }),
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'posthog-core-tests',
          },
          signal: expect.anything(),
        })

        // When quota limited with no prior cached flags, return empty results
        expect(posthog.getFeatureFlags()).toEqual({})
        expect(posthog.getFeatureFlag('feature-1')).toEqual(undefined)
        expect(posthog.getFeatureFlagPayloads()).toEqual({})
        expect(posthog.getFeatureFlagPayload('feature-1')).toEqual(null)
      })

      it('should emit featureflags event with quotaLimited when quota limited', async () => {
        const featureFlagsHandler = jest.fn()
        posthog.on('featureflags', featureFlagsHandler)

        await posthog.reloadFeatureFlagsAsync()

        expect(featureFlagsHandler).toHaveBeenCalled()
        // Verify the flags response includes quotaLimited info
        const flagDetails = posthog.getFeatureFlagDetails()
        expect(flagDetails?.quotaLimited).toEqual(['feature_flags'])
      })

      it('getFeatureFlagResult should include QUOTA_LIMITED error', async () => {
        posthog.getFeatureFlagResult('feature-1')
        await waitForPromises()

        expect(parseBody(mocks.fetch.mock.calls[1])).toMatchObject({
          batch: [
            {
              event: '$feature_flag_called',
              properties: {
                $feature_flag: 'feature-1',
                $feature_flag_error: 'quota_limited',
              },
            },
          ],
        })
      })

      it('getFeatureFlagResult should NOT include FLAG_MISSING when quota limited', async () => {
        posthog.getFeatureFlagResult('nonexistent-flag')
        await waitForPromises()

        const body = parseBody(mocks.fetch.mock.calls[1])
        const error = body.batch[0].properties.$feature_flag_error
        expect(error).toEqual('quota_limited')
        expect(error).not.toContain('flag_missing')
      })
    })

    describe('getFlags retry behavior', () => {
      it.each([408, 429, 500, 503])('should not retry HTTP %i responses', async (status) => {
        ;[posthog, mocks] = createTestClient(
          'TEST_API_KEY',
          { flushAt: 1, fetchRetryCount: 3, fetchRetryDelay: 1 },
          (_mocks) => {
            _mocks.fetch.mockImplementation((url) => {
              if (url.includes('/flags/')) {
                return Promise.resolve({
                  status,
                  text: () => Promise.resolve('error'),
                  json: () => Promise.resolve({ error: 'error' }),
                })
              }
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () => Promise.resolve({ status: 'ok' }),
              })
            })
          }
        )

        await expect(posthog.getFlags('distinct-id')).resolves.toEqual({
          success: false,
          error: { type: 'api_error', statusCode: status },
        })
        expect(mocks.fetch).toHaveBeenCalledTimes(1)
      })

      it.each([502, 504])('should retry HTTP %i responses and return the successful flags response', async (status) => {
        let flagsRequestCount = 0
        ;[posthog, mocks] = createTestClient(
          'TEST_API_KEY',
          { flushAt: 1, fetchRetryCount: 2, fetchRetryDelay: 1 },
          (_mocks) => {
            _mocks.fetch.mockImplementation((url) => {
              if (url.includes('/flags/')) {
                flagsRequestCount++
                if (flagsRequestCount < 2) {
                  return Promise.resolve({
                    status,
                    text: () => Promise.resolve('error'),
                    json: () => Promise.resolve({ error: 'error' }),
                  })
                }
                return Promise.resolve({
                  status: 200,
                  text: () => Promise.resolve('ok'),
                  json: () =>
                    Promise.resolve({
                      flags: createMockFeatureFlags(),
                      requestId: 'retry-success',
                      evaluatedAt: 1640995200000,
                    }),
                })
              }
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () => Promise.resolve({ status: 'ok' }),
              })
            })
          }
        )

        const resultPromise = posthog.getFlags('distinct-id')
        await waitForPromises()
        await jest.advanceTimersByTimeAsync(1)
        const result = await resultPromise

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.response.featureFlags).toEqual(expectedFeatureFlagResponses)
        }
        expect(mocks.fetch).toHaveBeenCalledTimes(2)
      })

      it.each([502, 504])('should return api_error after exhausting retries for HTTP %i responses', async (status) => {
        ;[posthog, mocks] = createTestClient(
          'TEST_API_KEY',
          { flushAt: 1, fetchRetryCount: 2, fetchRetryDelay: 1, featureFlagsRequestMaxRetries: 2 },
          (_mocks) => {
            _mocks.fetch.mockImplementation((url) => {
              if (url.includes('/flags/')) {
                return Promise.resolve({
                  status,
                  text: () => Promise.resolve('error'),
                  json: () => Promise.resolve({ error: 'error' }),
                })
              }
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () => Promise.resolve({ status: 'ok' }),
              })
            })
          }
        )

        const resultPromise = posthog.getFlags('distinct-id')
        await waitForPromises()
        await jest.advanceTimersByTimeAsync(1)
        await jest.advanceTimersByTimeAsync(1)

        await expect(resultPromise).resolves.toEqual({
          success: false,
          error: { type: 'api_error', statusCode: status },
        })
        expect(mocks.fetch).toHaveBeenCalledTimes(3)
      })

      it('should not retry when featureFlagsRequestMaxRetries is 0', async () => {
        ;[posthog, mocks] = createTestClient(
          'TEST_API_KEY',
          { flushAt: 1, fetchRetryCount: 2, fetchRetryDelay: 1, featureFlagsRequestMaxRetries: 0 },
          (_mocks) => {
            _mocks.fetch.mockImplementation((url) => {
              if (url.includes('/flags/')) {
                return Promise.reject(new TypeError('Failed to fetch'))
              }
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () => Promise.resolve({ status: 'ok' }),
              })
            })
          }
        )

        const result = await posthog.getFlags('distinct-id')

        expect(result.success).toBe(false)
        expect(mocks.fetch).toHaveBeenCalledTimes(1)
      })

      it('should not retry connection refused failures when the error code is available', async () => {
        ;[posthog, mocks] = createTestClient(
          'TEST_API_KEY',
          { flushAt: 1, fetchRetryCount: 2, fetchRetryDelay: 1 },
          (_mocks) => {
            _mocks.fetch.mockImplementation((url) => {
              if (url.includes('/flags/')) {
                return Promise.reject(Object.assign(new TypeError('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))
              }
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () => Promise.resolve({ status: 'ok' }),
              })
            })
          }
        )

        const result = await posthog.getFlags('distinct-id')

        expect(result.success).toBe(false)
        expect(mocks.fetch).toHaveBeenCalledTimes(1)
      })

      it('should retry network failures and return the successful flags response', async () => {
        let flagsRequestCount = 0
        ;[posthog, mocks] = createTestClient(
          'TEST_API_KEY',
          { flushAt: 1, fetchRetryCount: 2, fetchRetryDelay: 1 },
          (_mocks) => {
            _mocks.fetch.mockImplementation((url) => {
              if (url.includes('/flags/')) {
                flagsRequestCount++
                if (flagsRequestCount < 2) {
                  return Promise.reject(new TypeError('Failed to fetch'))
                }
                return Promise.resolve({
                  status: 200,
                  text: () => Promise.resolve('ok'),
                  json: () =>
                    Promise.resolve({
                      flags: createMockFeatureFlags(),
                      requestId: 'retry-success',
                      evaluatedAt: 1640995200000,
                    }),
                })
              }
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () => Promise.resolve({ status: 'ok' }),
              })
            })
          }
        )

        const resultPromise = posthog.getFlags('distinct-id')
        await waitForPromises()
        await jest.advanceTimersByTimeAsync(1)
        const result = await resultPromise

        expect(result.success).toBe(true)
        expect(mocks.fetch).toHaveBeenCalledTimes(2)
      })
    })

    describe('getFeatureFlagResult error scenarios', () => {
      it('should include ERRORS_WHILE_COMPUTING error', async () => {
        ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 }, (_mocks) => {
          _mocks.fetch.mockImplementation((url) => {
            if (url.includes('/flags/')) {
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () =>
                  Promise.resolve({
                    flags: createMockFeatureFlags(),
                    errorsWhileComputingFlags: true,
                    requestId: 'test-request-id',
                  }),
              })
            }
            return Promise.resolve({
              status: 200,
              text: () => Promise.resolve('ok'),
              json: () => Promise.resolve({ status: 'ok' }),
            })
          })
        })
        posthog.reloadFeatureFlags()
        await waitForPromises()

        posthog.getFeatureFlagResult('feature-1')
        await waitForPromises()

        expect(parseBody(mocks.fetch.mock.calls[1])).toMatchObject({
          batch: [
            {
              event: '$feature_flag_called',
              properties: {
                $feature_flag: 'feature-1',
                $feature_flag_response: true,
                $feature_flag_error: 'errors_while_computing_flags',
              },
            },
          ],
        })
      })

      it('should include TIMEOUT error when request timed out', async () => {
        ;[posthog, mocks] = createTestClient(
          'TEST_API_KEY',
          { flushAt: 1, fetchRetryCount: 0, featureFlagsRequestMaxRetries: 0 },
          (_mocks) => {
            _mocks.fetch.mockImplementation((url) => {
              if (url.includes('/flags/')) {
                const abortError = new Error('The operation was aborted')
                abortError.name = 'AbortError'
                return Promise.reject(abortError)
              }
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () => Promise.resolve({ status: 'ok' }),
              })
            })
          }
        )
        posthog.reloadFeatureFlags()
        await waitForPromises()

        posthog.getFeatureFlagResult('feature-1')
        await waitForPromises()

        expect(parseBody(mocks.fetch.mock.calls[1])).toMatchObject({
          batch: [
            {
              event: '$feature_flag_called',
              properties: {
                $feature_flag: 'feature-1',
                $feature_flag_error: 'timeout',
              },
            },
          ],
        })
      })

      it('should include api_error with status code', async () => {
        ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 }, (_mocks) => {
          _mocks.fetch.mockImplementation((url) => {
            if (url.includes('/flags/')) {
              return Promise.resolve({
                status: 503,
                text: () => Promise.resolve('Service Unavailable'),
                json: () => Promise.resolve({ error: 'service unavailable' }),
              })
            }
            return Promise.resolve({
              status: 200,
              text: () => Promise.resolve('ok'),
              json: () => Promise.resolve({ status: 'ok' }),
            })
          })
        })
        posthog.reloadFeatureFlags()
        await waitForPromises()

        posthog.getFeatureFlagResult('feature-1')
        await waitForPromises()

        expect(parseBody(mocks.fetch.mock.calls[1])).toMatchObject({
          batch: [
            {
              event: '$feature_flag_called',
              properties: {
                $feature_flag: 'feature-1',
                $feature_flag_error: 'api_error_503',
              },
            },
          ],
        })
      })

      it('should include CONNECTION_ERROR for network failures', async () => {
        ;[posthog, mocks] = createTestClient(
          'TEST_API_KEY',
          { flushAt: 1, fetchRetryCount: 0, featureFlagsRequestMaxRetries: 0 },
          (_mocks) => {
            _mocks.fetch.mockImplementation((url) => {
              if (url.includes('/flags/')) {
                return Promise.reject(new TypeError('Failed to fetch'))
              }
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () => Promise.resolve({ status: 'ok' }),
              })
            })
          }
        )
        posthog.reloadFeatureFlags()
        await waitForPromises()

        posthog.getFeatureFlagResult('feature-1')
        await waitForPromises()

        expect(parseBody(mocks.fetch.mock.calls[1])).toMatchObject({
          batch: [
            {
              event: '$feature_flag_called',
              properties: {
                $feature_flag: 'feature-1',
                $feature_flag_error: 'connection_error',
              },
            },
          ],
        })
      })
    })
  })

  describe('bootstrapped feature flags', () => {
    beforeEach(() => {
      ;[posthog, mocks] = createTestClient(
        'TEST_API_KEY',
        {
          flushAt: 1,
          bootstrap: {
            distinctId: 'tomato',
            featureFlags: {
              'bootstrap-1': 'variant-1',
              'feature-1': 'feature-1-bootstrap-value',
              enabled: true,
              disabled: false,
            },
            featureFlagPayloads: {
              'bootstrap-1': {
                some: 'key',
              },
              'feature-1': {
                color: 'feature-1-bootstrap-color',
              },
              enabled: 200,
              'not-in-featureFlags': {
                color: { foo: 'bar' },
              },
            },
          },
        },
        (_mocks) => {
          _mocks.fetch.mockImplementation((url) => {
            if (url.includes('/flags/')) {
              return Promise.reject(new Error('Not responding to emulate use of bootstrapped values'))
            }

            return Promise.resolve({
              status: 200,
              text: () => Promise.resolve('ok'),
              json: () =>
                Promise.resolve({
                  status: 'ok',
                }),
            })
          })
        }
      )
    })

    it('getFeatureFlags should return bootstrapped flags', async () => {
      expect(posthog.getFeatureFlags()).toEqual({
        'bootstrap-1': 'variant-1',
        enabled: true,
        'feature-1': 'feature-1-bootstrap-value',
        'not-in-featureFlags': true,
      })
      expect(posthog.getDistinctId()).toEqual('tomato')
      expect(posthog.getAnonymousId()).toEqual('tomato')
    })

    it('getFeatureFlag should return bootstrapped flags', async () => {
      expect(posthog.getFeatureFlag('my-flag')).toEqual(false)
      expect(posthog.getFeatureFlag('bootstrap-1')).toEqual('variant-1')
      expect(posthog.getFeatureFlag('enabled')).toEqual(true)
      expect(posthog.getFeatureFlag('disabled')).toEqual(false)
      expect(posthog.getFeatureFlag('not-in-featureFlags')).toEqual(true)
    })

    it('getFeatureFlag should capture $feature_flag_called with bootstrapped values', async () => {
      expect(posthog.getFeatureFlag('bootstrap-1')).toEqual('variant-1')

      await waitForPromises()
      expect(mocks.fetch).toHaveBeenCalledTimes(1)

      expect(parseBody(mocks.fetch.mock.calls[0])).toMatchObject({
        batch: [
          {
            event: '$feature_flag_called',
            distinct_id: posthog.getDistinctId(),
            properties: {
              $feature_flag: 'bootstrap-1',
              $feature_flag_response: 'variant-1',
              '$feature/bootstrap-1': 'variant-1',
              $feature_flag_bootstrapped_response: 'variant-1',
              $feature_flag_bootstrapped_payload: { some: 'key' },
              $used_bootstrap_value: true,
            },
          },
        ],
      })
    })

    it('isFeatureEnabled should return true/false for bootstrapped flags', () => {
      expect(posthog.isFeatureEnabled('my-flag')).toEqual(false)
      expect(posthog.isFeatureEnabled('bootstrap-1')).toEqual(true)
      expect(posthog.isFeatureEnabled('enabled')).toEqual(true)
      expect(posthog.isFeatureEnabled('disabled')).toEqual(false)
      expect(posthog.isFeatureEnabled('not-in-featureFlags')).toEqual(true)
    })

    it('getFeatureFlagPayload should return bootstrapped payloads', () => {
      expect(posthog.getFeatureFlagPayload('my-flag')).toEqual(null)
      expect(posthog.getFeatureFlagPayload('bootstrap-1')).toEqual({
        some: 'key',
      })
      expect(posthog.getFeatureFlagPayload('enabled')).toEqual(200)
      expect(posthog.getFeatureFlagPayload('not-in-featureFlags')).toEqual({
        color: { foo: 'bar' },
      })
    })

    describe('when loaded', () => {
      beforeEach(() => {
        ;[posthog, mocks] = createTestClient(
          'TEST_API_KEY',
          {
            flushAt: 1,
            bootstrap: {
              distinctId: 'tomato',
              featureFlags: {
                'bootstrap-1': 'variant-1',
                'feature-1': 'feature-1-bootstrap-value',
                enabled: true,
                disabled: false,
              },
              featureFlagPayloads: {
                'bootstrap-1': {
                  some: 'key',
                },
                'feature-1': {
                  color: 'feature-1-bootstrap-color',
                },
                enabled: 200,
              },
            },
          },
          (_mocks) => {
            _mocks.fetch.mockImplementation((url) => {
              if (url.includes('/flags/')) {
                return Promise.resolve({
                  status: 200,
                  text: () => Promise.resolve('ok'),
                  json: () =>
                    Promise.resolve({
                      flags: createMockFeatureFlags(),
                    }),
                })
              }

              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () =>
                  Promise.resolve({
                    status: 'ok',
                  }),
              })
            })
          }
        )

        posthog.reloadFeatureFlags()
      })

      it('should load new feature flags', async () => {
        expect(mocks.fetch).toHaveBeenCalledWith('https://us.i.posthog.com/flags/?v=2', {
          body: JSON.stringify({
            token: 'TEST_API_KEY',
            distinct_id: posthog.getDistinctId(),
            groups: {},
            person_properties: {},
            group_properties: {},
            $anon_distinct_id: 'tomato',
          }),
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'posthog-core-tests',
          },
          signal: expect.anything(),
        })

        expect(posthog.getFeatureFlags()).toEqual({
          'feature-1': true,
          'feature-2': true,
          'json-payload': true,
          'feature-variant': 'variant',
        })
      })

      it('should load new feature flag payloads', async () => {
        expect(mocks.fetch).toHaveBeenCalledWith('https://us.i.posthog.com/flags/?v=2', {
          body: JSON.stringify({
            token: 'TEST_API_KEY',
            distinct_id: posthog.getDistinctId(),
            groups: {},
            person_properties: {},
            group_properties: {},
            $anon_distinct_id: 'tomato',
          }),
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'posthog-core-tests',
          },
          signal: expect.anything(),
        })
        expect(posthog.getFeatureFlagPayload('feature-1')).toEqual({
          color: 'blue',
        })
        expect(posthog.getFeatureFlagPayload('feature-variant')).toEqual([5])
      })

      it('should capture feature_flag_called with bootstrapped values', async () => {
        expect(posthog.getFeatureFlag('feature-1')).toEqual(true)

        await waitForPromises()
        expect(mocks.fetch).toHaveBeenCalledTimes(2)

        expect(parseBody(mocks.fetch.mock.calls[1])).toMatchObject({
          batch: [
            {
              event: '$feature_flag_called',
              distinct_id: posthog.getDistinctId(),
              properties: {
                $feature_flag: 'feature-1',
                $feature_flag_response: true,
                '$feature/feature-1': true,
                $feature_flag_bootstrapped_response: 'feature-1-bootstrap-value',
                $feature_flag_bootstrapped_payload: { color: 'feature-1-bootstrap-color' },
                $used_bootstrap_value: false,
              },
            },
          ],
        })
      })
    })
  })

  describe('bootstapped do not overwrite values', () => {
    beforeEach(() => {
      ;[posthog, mocks] = createTestClient(
        'TEST_API_KEY',
        {
          flushAt: 1,
          bootstrap: {
            distinctId: 'tomato',
            featureFlags: { 'bootstrap-1': 'variant-1', enabled: true, disabled: false },
            featureFlagPayloads: {
              'bootstrap-1': {
                some: 'key',
              },
              enabled: 200,
            },
          },
        },
        (_mocks) => {
          _mocks.fetch.mockImplementation((url) => {
            if (url.includes('/flags/')) {
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () =>
                  Promise.resolve({
                    flags: createMockFeatureFlags(),
                  }),
              })
            }

            return Promise.resolve({
              status: 200,
              text: () => Promise.resolve('ok'),
              json: () =>
                Promise.resolve({
                  status: 'ok',
                }),
            })
          })
        },
        // Storage cache
        {
          distinct_id: '123',
          feature_flag_details: {
            flags: {
              'bootstrap-1': {
                key: 'bootstrap-1',
                enabled: true,
                variant: 'variant-2',
                reason: {
                  code: 'matched_condition',
                  description: 'matched condition set 1',
                  condition_index: 0,
                },
                metadata: {
                  id: 1,
                  version: 1,
                  description: 'bootstrap-1',
                  payload: '{"some":"other-key"}',
                },
              },
              requestId: '8c865d72-94ef-4088-8b4e-cdb7983f0f81',
            },
          },
        }
      )
    })

    it('distinct id should not be overwritten if already there', () => {
      expect(posthog.getDistinctId()).toEqual('123')
    })

    it('flags should not be overwritten if already there', () => {
      expect(posthog.getFeatureFlag('bootstrap-1')).toEqual('variant-2')
    })

    it('flag payloads should not be overwritten if already there', () => {
      expect(posthog.getFeatureFlagPayload('bootstrap-1')).toEqual({
        some: 'other-key',
      })
    })
  })

  describe('updateFlags', () => {
    it('should replace stored flags and payloads by default', async () => {
      await posthog.reloadFeatureFlagsAsync()
      expect(posthog.getFeatureFlags()).toEqual(expectedFeatureFlagResponses)

      posthog.updateFlags(
        { 'local-flag': true, 'local-variant': 'variant-a' },
        { 'local-flag': { color: 'blue' }, 'local-variant': 'string-payload' }
      )

      expect(posthog.getFeatureFlags()).toEqual({ 'local-flag': true, 'local-variant': 'variant-a' })
      expect(posthog.getFeatureFlag('local-variant')).toEqual('variant-a')
      expect(posthog.getFeatureFlagPayload('local-flag')).toEqual({ color: 'blue' })
      expect(posthog.getFeatureFlagPayload('local-variant')).toEqual('string-payload')
      // server-loaded flags were replaced (missing-flag default is null once flags are stored)
      expect(posthog.getFeatureFlagPayload('json-payload')).toEqual(null)
    })

    it('should merge with stored flags and payloads when merge is true', async () => {
      await posthog.reloadFeatureFlagsAsync()

      posthog.updateFlags({ 'local-flag': true, 'feature-1': false }, { 'local-flag': [1, 2] }, { merge: true })

      expect(posthog.getFeatureFlags()).toEqual({
        ...expectedFeatureFlagResponses,
        'feature-1': false,
        'local-flag': true,
      })
      expect(posthog.getFeatureFlagPayload('json-payload')).toEqual({ a: 'payload' })
      expect(posthog.getFeatureFlagPayload('local-flag')).toEqual([1, 2])
    })

    it('should preserve the payload of a disabled flag across an unrelated merge', () => {
      posthog.updateFlags({ 'off-flag': false }, { 'off-flag': { a: 1 } })
      expect(posthog.getFeatureFlagPayload('off-flag')).toEqual({ a: 1 })

      posthog.updateFlags({ 'other-flag': true }, undefined, { merge: true })

      expect(posthog.getFeatureFlag('off-flag')).toEqual(false)
      expect(posthog.getFeatureFlagPayload('off-flag')).toEqual({ a: 1 })
      expect(posthog.getFeatureFlag('other-flag')).toEqual(true)
    })

    it('should keep explicitly-false flags readable as false', () => {
      posthog.updateFlags({ 'off-flag': false, 'on-flag': true })

      expect(posthog.getFeatureFlags()).toEqual({ 'off-flag': false, 'on-flag': true })
      expect(posthog.getFeatureFlag('off-flag')).toEqual(false)
      expect(posthog.isFeatureEnabled('off-flag')).toEqual(false)
      expect(posthog.isFeatureEnabled('on-flag')).toEqual(true)
    })

    it('should not throw when a payload cannot be serialized, and still apply the flag', () => {
      const circular: Record<string, unknown> = {}
      circular.self = circular

      expect(() => posthog.updateFlags({ 'circular-flag': true }, { 'circular-flag': circular })).not.toThrow()

      // the flag value is still applied; only the unserializable payload is dropped
      expect(posthog.getFeatureFlag('circular-flag')).toEqual(true)
      expect(posthog.getFeatureFlagPayload('circular-flag')).toBeNull()
    })

    it('should clear all stored flags when called with an empty object (no merge)', async () => {
      await posthog.reloadFeatureFlagsAsync()
      expect(posthog.getFeatureFlags()).toEqual(expectedFeatureFlagResponses)

      posthog.updateFlags({})

      expect(posthog.getFeatureFlags()).toEqual({})
      expect(posthog.getFeatureFlag('feature-1')).toEqual(undefined)
    })

    it.each([
      { name: 'object', payload: { color: 'blue' } },
      { name: 'array', payload: [1, 2, 3] },
      { name: 'number', payload: 7 },
      { name: 'zero', payload: 0 },
      { name: 'boolean', payload: false },
      { name: 'null', payload: null },
      { name: 'json-looking string', payload: '123' },
      { name: 'plain string', payload: 'hello' },
    ])('should round-trip a $name payload through updateFlags', ({ payload }) => {
      posthog.updateFlags({ 'p-flag': true }, { 'p-flag': payload as any })

      expect(posthog.getFeatureFlagPayload('p-flag')).toEqual(payload)
    })

    it('should not attach a payload when none is provided', () => {
      posthog.updateFlags({ 'no-payload': true })

      expect(posthog.getFeatureFlag('no-payload')).toEqual(true)
      expect(posthog.getFeatureFlagPayload('no-payload')).toEqual(null)
    })

    it('should fire onFeatureFlags listeners without any network request', async () => {
      const receivedFlags: Record<string, string | boolean>[] = []
      posthog.onFeatureFlags((flags) => receivedFlags.push(flags))

      posthog.updateFlags({ 'local-flag': true })
      await waitForPromises()

      expect(receivedFlags).toEqual([{ 'local-flag': true }])
      const flagsCalls = mocks.fetch.mock.calls.filter(([url]) => url.includes('/flags/'))
      expect(flagsCalls).toHaveLength(0)
    })

    it('merge reads the override-applied values (web parity), so an active override is folded in', async () => {
      // Web's updateFlags merge seeds from getFlagVariants(), which includes overrides; core mirrors
      // that via getFeatureFlags(). This documents that an active override is captured by a merge.
      posthog.updateFlags({ 'base-flag': true })
      await posthog.overrideFeatureFlag({ 'base-flag': 'forced' })

      posthog.updateFlags({ 'other-flag': true }, undefined, { merge: true })

      expect(posthog.getFeatureFlag('base-flag')).toEqual('forced')
      expect(posthog.getFeatureFlag('other-flag')).toEqual(true)
    })

    it('should still apply overrideFeatureFlag on top of updated flags', async () => {
      posthog.updateFlags({ 'local-flag': true })
      await posthog.overrideFeatureFlag({ 'local-flag': 'overridden' })

      expect(posthog.getFeatureFlag('local-flag')).toEqual('overridden')
    })

    it('should not bake an active override into the base when merging', async () => {
      posthog.updateFlags({ 'base-flag': 'control' })
      await posthog.overrideFeatureFlag({ 'base-flag': 'test' })
      expect(posthog.getFeatureFlag('base-flag')).toEqual('test')

      // Merge an unrelated flag — the override must not leak into stored flags.
      posthog.updateFlags({ 'other-flag': true }, undefined, { merge: true })

      // Clearing the override reveals the original value, not the override.
      await posthog.overrideFeatureFlag(null)
      expect(posthog.getFeatureFlag('base-flag')).toEqual('control')
      expect(posthog.getFeatureFlag('other-flag')).toEqual(true)
    })

    it('should capture $feature_flag_called after updateFlags changes to a new value', async () => {
      await posthog.reloadFeatureFlagsAsync()
      expect(posthog.getFeatureFlag('feature-1')).toEqual(true)
      await waitForPromises()
      expect(mocks.fetch).toHaveBeenCalledTimes(2)

      posthog.updateFlags({ 'feature-1': false })
      expect(posthog.getFeatureFlag('feature-1')).toEqual(false)
      await waitForPromises()

      expect(mocks.fetch).toHaveBeenCalledTimes(3)
      const flagCalledProps = parseBody(mocks.fetch.mock.calls[2]).batch[0].properties
      expect(flagCalledProps).toMatchObject({
        $feature_flag: 'feature-1',
        $feature_flag_response: false,
      })
      // Locally supplied flags have no server id, so no $feature_flag_id is emitted
      expect(flagCalledProps).not.toHaveProperty('$feature_flag_id')
    })

    it('should not capture $feature_flag_called after updateFlags cycles back to a previously seen value', async () => {
      await posthog.reloadFeatureFlagsAsync()
      expect(posthog.getFeatureFlag('feature-1')).toEqual(true)
      await waitForPromises()
      expect(mocks.fetch).toHaveBeenCalledTimes(2)

      posthog.updateFlags({ 'feature-1': false })
      expect(posthog.getFeatureFlag('feature-1')).toEqual(false)
      await waitForPromises()
      expect(mocks.fetch).toHaveBeenCalledTimes(3)

      posthog.updateFlags({ 'feature-1': true })
      expect(posthog.getFeatureFlag('feature-1')).toEqual(true)
      await waitForPromises()
      expect(mocks.fetch).toHaveBeenCalledTimes(3)
    })
  })

  describe('disableRemoteFeatureFlags', () => {
    beforeEach(() => {
      ;[posthog, mocks] = createTestClient(
        'TEST_API_KEY',
        { flushAt: 1, disableRemoteFeatureFlags: true },
        (_mocks) => {
          _mocks.fetch.mockImplementation((url) => {
            if (url.includes('/flags/?v=2')) {
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () =>
                  Promise.resolve({
                    flags: createMockFeatureFlags(),
                    requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
                    evaluatedAt: 1640995200000,
                    sessionRecording: { endpoint: '/s/' },
                  }),
              })
            }

            return Promise.resolve({
              status: 200,
              text: () => Promise.resolve('ok'),
              json: () => Promise.resolve({ status: 'ok' }),
            })
          })
        }
      )
    })

    it('should not fetch flags from reloads or flag-affecting methods', async () => {
      posthog.reloadFeatureFlags()
      await posthog.reloadFeatureFlagsAsync()
      posthog.identify('new-distinct-id')
      posthog.alias('alias-for-user')
      posthog.group('company', 'company-id')
      posthog.setPersonPropertiesForFlags({ plan: 'pro' })
      posthog.reset()
      await waitForPromises()

      const flagsCalls = mocks.fetch.mock.calls.filter(([url]) => url.includes('/flags/'))
      expect(flagsCalls).toHaveLength(0)
    })

    it('reset() clears flags and still notifies onFeatureFlags listeners (no reload runs to emit it)', async () => {
      posthog.updateFlags({ 'local-flag': true })
      const received: Record<string, string | boolean>[] = []
      posthog.onFeatureFlags((flags) => received.push(flags))

      posthog.reset()
      await waitForPromises()

      // The cleared state is emitted directly (no /flags fetch), so listeners re-evaluate.
      expect(received).toEqual([{}])
      expect(posthog.getFeatureFlags()).toEqual({})
      expect(mocks.fetch.mock.calls.filter(([url]) => url.includes('/flags/'))).toHaveLength(0)
    })

    it('reset() keeping FeatureFlagDetails preserves the flags and emits nothing', async () => {
      posthog.updateFlags({ 'local-flag': true })
      const received: Record<string, string | boolean>[] = []
      posthog.onFeatureFlags((flags) => received.push(flags))

      posthog.reset([PostHogPersistedProperty.FeatureFlagDetails])
      await waitForPromises()

      // The kept flags stay intact, so there's no cleared state to emit.
      expect(posthog.getFeatureFlags()).toEqual({ 'local-flag': true })
      expect(received).toEqual([])
      expect(mocks.fetch.mock.calls.filter(([url]) => url.includes('/flags/'))).toHaveLength(0)
    })

    it('a fully disabled SDK still returns undefined from reloadFeatureFlagsAsync (not stale stored flags)', async () => {
      const storageCache = {
        feature_flag_details: { flags: { 'stale-flag': { key: 'stale-flag', enabled: true } } },
      }
      const [disabledPosthog] = createTestClient(
        'TEST_API_KEY',
        { flushAt: 1, disabled: true, disableRemoteFeatureFlags: true },
        undefined,
        storageCache
      )

      expect(await disabledPosthog.reloadFeatureFlagsAsync()).toEqual(undefined)
    })

    it('reloadFeatureFlagsAsync should resolve with the locally supplied flags', async () => {
      posthog.updateFlags({ 'local-flag': true })

      const flags = await posthog.reloadFeatureFlagsAsync()

      expect(flags).toEqual({ 'local-flag': true })
    })

    it('reloadFeatureFlags should answer the callback with the locally supplied flags', async () => {
      posthog.updateFlags({ 'local-flag': true })

      let cbFlags: Record<string, string | boolean> | undefined
      posthog.reloadFeatureFlags({ cb: (_err, flags) => (cbFlags = flags) })
      await waitForPromises()

      expect(cbFlags).toEqual({ 'local-flag': true })
    })

    it('updateFlags should still work and fire listeners', async () => {
      const receivedFlags: Record<string, string | boolean>[] = []
      posthog.onFeatureFlags((flags) => receivedFlags.push(flags))

      posthog.updateFlags({ 'local-flag': 'variant-b' }, { 'local-flag': { a: 1 } })
      await waitForPromises()

      expect(posthog.getFeatureFlag('local-flag')).toEqual('variant-b')
      expect(posthog.getFeatureFlagPayload('local-flag')).toEqual({ a: 1 })
      expect(receivedFlags).toEqual([{ 'local-flag': 'variant-b' }])
    })

    it('updateFlags merge keeps bootstrap flags (the primary documented workflow)', async () => {
      const [bootstrapped] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        disableRemoteFeatureFlags: true,
        bootstrap: {
          featureFlags: { 'boot-flag': true },
          featureFlagPayloads: { 'boot-flag': { from: 'bootstrap' } },
        },
      })
      await waitForPromises()

      bootstrapped.updateFlags({ 'runtime-flag': 'variant-x' }, undefined, { merge: true })

      expect(bootstrapped.getFeatureFlag('boot-flag')).toEqual(true)
      expect(bootstrapped.getFeatureFlagPayload('boot-flag')).toEqual({ from: 'bootstrap' })
      expect(bootstrapped.getFeatureFlag('runtime-flag')).toEqual('variant-x')

      await bootstrapped.shutdown()
    })

    describe('config-fetching flags requests', () => {
      // Exposes the protected flagsAsync to drive the config-piggyback request
      // (in the SDKs this path is hit when remote config is disabled, e.g. RN's
      // _flagsAsyncWithSurveys)
      class TestClientExposingFlagsAsync extends PostHogCoreTestClient {
        public async flagsConfigAsync(): Promise<void> {
          await this.flagsAsync({ sendAnonDistinctId: true, fetchConfig: true })
        }
      }

      let exposedPosthog: TestClientExposingFlagsAsync

      beforeEach(() => {
        exposedPosthog = new TestClientExposingFlagsAsync(mocks, 'TEST_API_KEY', {
          disableCompression: true,
          flushAt: 1,
          disableRemoteFeatureFlags: true,
        })
      })

      it('should send disable_flags: true and not store the returned flags', async () => {
        exposedPosthog.updateFlags({ 'local-flag': true })
        const receivedFlags: Record<string, string | boolean>[] = []
        exposedPosthog.onFeatureFlags((flags) => receivedFlags.push(flags))

        await exposedPosthog.flagsConfigAsync()
        await waitForPromises()

        const flagsCall = mocks.fetch.mock.calls.find(([url]) => url.includes('/flags/'))
        expect(flagsCall).toBeDefined()
        expect(JSON.parse((flagsCall![1].body as string) || '')).toMatchObject({ disable_flags: true })

        // The mocked response contains flags, but they must not overwrite the local ones
        // and must not be emitted to onFeatureFlags listeners.
        expect(exposedPosthog.getFeatureFlags()).toEqual({ 'local-flag': true })
        expect(receivedFlags).toEqual([])
        expect(exposedPosthog.getPersistedProperty(PostHogPersistedProperty.FlagsEndpointWasHit)).toBeFalsy()
        // The remote config side effects still apply
        expect(exposedPosthog.getPersistedProperty(PostHogPersistedProperty.SessionReplay)).toEqual({
          endpoint: '/s/',
        })
      })

      it('updateFlags applied while a config request is in flight is not overwritten when it resolves', async () => {
        let resolveFetch: () => void = () => {}
        mocks.fetch.mockImplementation((url) => {
          if (url.includes('/flags/')) {
            return new Promise((resolve) => {
              resolveFetch = () =>
                resolve({
                  status: 200,
                  text: () => Promise.resolve('ok'),
                  json: () => Promise.resolve({ featureFlags: { 'server-flag': true } }),
                })
            })
          }
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve('ok'),
            json: () => Promise.resolve({ status: 'ok' }),
          })
        })

        // Start the config request, push local flags, then let the request resolve. The
        // waitForPromises lets the request reach the (mocked) fetch so it is genuinely in flight.
        const inFlight = exposedPosthog.flagsConfigAsync()
        exposedPosthog.updateFlags({ 'local-flag': true })
        await waitForPromises()
        resolveFetch()
        await inFlight
        await waitForPromises()

        // The disabled config response never writes flags, so the local ones survive.
        expect(exposedPosthog.getFeatureFlags()).toEqual({ 'local-flag': true })
      })

      it('should not stamp quota state onto local flags when the request is quota limited', async () => {
        mocks.fetch.mockImplementation((url) => {
          if (url.includes('/flags/')) {
            return Promise.resolve({
              status: 200,
              text: () => Promise.resolve('ok'),
              json: () => Promise.resolve({ quotaLimited: ['feature_flags'] }),
            })
          }
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve('ok'),
            json: () => Promise.resolve({ status: 'ok' }),
          })
        })

        exposedPosthog.updateFlags({ 'local-flag': true })
        const receivedFlags: Record<string, string | boolean>[] = []
        exposedPosthog.onFeatureFlags((flags) => receivedFlags.push(flags))

        await exposedPosthog.flagsConfigAsync()
        await waitForPromises()

        expect(receivedFlags).toEqual([])
        expect(exposedPosthog.getFeatureFlags()).toEqual({ 'local-flag': true })
        expect(exposedPosthog.getFeatureFlagPayload('local-flag')).toEqual(null)
      })

      it('should not emit featureflags or store error state when the request fails', async () => {
        mocks.fetch.mockImplementation((url) => {
          if (url.includes('/flags/')) {
            return errorAPIResponse
          }
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve('ok'),
            json: () => Promise.resolve({ status: 'ok' }),
          })
        })

        exposedPosthog.updateFlags({ 'local-flag': true })
        const receivedFlags: Record<string, string | boolean>[] = []
        exposedPosthog.onFeatureFlags((flags) => receivedFlags.push(flags))

        await exposedPosthog.flagsConfigAsync()
        await waitForPromises()

        expect(receivedFlags).toEqual([])
        expect(exposedPosthog.getFeatureFlags()).toEqual({ 'local-flag': true })
      })
    })
  })
})
