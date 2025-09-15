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
        if (url.includes('/flags/?v=2&config=true')) {
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve('ok'),
            json: () =>
              Promise.resolve({
                flags: createMockFeatureFlags(),
                requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
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

    it('should only call fetch once if already calling', async () => {
      expect(mocks.fetch).toHaveBeenCalledTimes(0)
      posthog.reloadFeatureFlagsAsync()
      posthog.reloadFeatureFlagsAsync()
      const flags = await posthog.reloadFeatureFlagsAsync()
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      expect(flags).toEqual(expectedFeatureFlagResponses)
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
          expect(mocks.fetch).toHaveBeenCalledWith('https://us.i.posthog.com/flags/?v=2&config=true', {
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

          expect(posthog.getFeatureFlagPayloads()).toEqual(undefined)
          expect(posthog.getFeatureFlagPayload('feature-1')).toEqual(undefined)
        })
      })

      describe('when subsequent flags calls return partial results', () => {
        beforeEach(() => {
          ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 }, (_mocks) => {
            _mocks.fetch
              .mockImplementationOnce((url) => {
                if (url.includes('/flags/?v=2&config=true')) {
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
                if (url.includes('/flags/?v=2&config=true')) {
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
          expect(mocks.fetch).toHaveBeenCalledWith('https://us.i.posthog.com/flags/?v=2&config=true', {
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

          expect(mocks.fetch).toHaveBeenCalledWith('https://us.i.posthog.com/flags/?v=2&config=true', {
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

      describe('when subsequent flags calls return results without errors', () => {
        beforeEach(() => {
          ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 }, (_mocks) => {
            _mocks.fetch
              .mockImplementationOnce((url) => {
                if (url.includes('/flags/?v=2&config=true')) {
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
                if (url.includes('/flags/?v=2&config=true')) {
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
          expect(mocks.fetch).toHaveBeenCalledWith('https://us.i.posthog.com/flags/?v=2&config=true', {
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

          expect(mocks.fetch).toHaveBeenCalledWith('https://us.i.posthog.com/flags/?v=2&config=true', {
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
        expect(mocks.fetch).toHaveBeenCalledTimes(2)
        expect(JSON.parse((mocks.fetch.mock.calls[1][1].body as string) || '')).toMatchObject({
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
                },
                type: 'capture',
              },
            ],
          })

          // Only tracked once
          expect(posthog.getFeatureFlag('feature-1')).toEqual(true)
          expect(mocks.fetch).toHaveBeenCalledTimes(2)
        }
      )

      it('should capture $feature_flag_called again if new flags', async () => {
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
              },
              type: 'capture',
            },
          ],
        })

        await posthog.reloadFeatureFlagsAsync()
        posthog.getFeatureFlag('feature-1')

        await waitForPromises()
        expect(mocks.fetch).toHaveBeenCalledTimes(4)

        expect(parseBody(mocks.fetch.mock.calls[3])).toMatchObject({
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
              type: 'capture',
            },
          ],
        })
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
              type: 'capture',
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
        }
        const normalizedFeatureFlags = normalizeFlagsResponse(expectedFeatureFlags as PostHogV2FlagsResponse)
        expect(posthog.getPersistedProperty(PostHogPersistedProperty.FeatureFlagDetails)).toEqual(
          normalizedFeatureFlags
        )
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
              type: 'capture',
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
        expect(mocks.fetch).toHaveBeenCalledWith('https://us.i.posthog.com/flags/?v=2&config=true', {
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

        // Verify all flag methods return undefined when quota limited
        expect(posthog.getFeatureFlags()).toEqual(undefined)
        expect(posthog.getFeatureFlag('feature-1')).toEqual(undefined)
        expect(posthog.getFeatureFlagPayloads()).toEqual(undefined)
        expect(posthog.getFeatureFlagPayload('feature-1')).toEqual(undefined)
      })

      it('should emit debug message when quota limited', async () => {
        const warnSpy = jest.spyOn(console, 'warn')
        posthog.debug(true)
        await posthog.reloadFeatureFlagsAsync()

        expect(warnSpy).toHaveBeenCalledWith(
          '[FEATURE FLAGS] Feature flags quota limit exceeded - unsetting all flags. Learn more about billing limits at https://posthog.com/docs/billing/limits-alerts'
        )
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
            type: 'capture',
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
        expect(mocks.fetch).toHaveBeenCalledWith('https://us.i.posthog.com/flags/?v=2&config=true', {
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
        expect(mocks.fetch).toHaveBeenCalledWith('https://us.i.posthog.com/flags/?v=2&config=true', {
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
              type: 'capture',
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
})
