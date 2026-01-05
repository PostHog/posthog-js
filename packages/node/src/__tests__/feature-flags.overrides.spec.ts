import { PostHogOptions } from '@/types'
import { PostHog } from '@/entrypoints/index.node'
import { apiImplementation, waitForPromises } from './utils'

jest.spyOn(console, 'debug').mockImplementation()

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

const posthogImmediateResolveOptions: PostHogOptions = {
  fetchRetryCount: 0,
}

describe('overrideFeatureFlags', () => {
  let posthog: PostHog

  jest.useFakeTimers()

  beforeEach(() => {
    mockedFetch.mockClear()
  })

  afterEach(async () => {
    await posthog.shutdown()
  })

  describe('basic overrides', () => {
    it('should return overridden flag value instead of evaluated value', async () => {
      const flags = {
        flags: [
          {
            id: 1,
            key: 'test-flag',
            active: true,
            filters: {
              groups: [{ rollout_percentage: 0 }], // Would normally be false
            },
          },
        ],
      }
      mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      await waitForPromises()

      // Without override, should be false (0% rollout)
      expect(await posthog.getFeatureFlag('test-flag', 'user-123')).toBe(false)

      // Override the flag
      posthog.overrideFeatureFlags({ 'test-flag': true })

      // Now should return the override value
      expect(await posthog.getFeatureFlag('test-flag', 'user-123')).toBe(true)
    })

    it('should support string variant overrides', async () => {
      mockedFetch.mockImplementation(apiImplementation({ localFlags: { flags: [] } }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      await waitForPromises()

      posthog.overrideFeatureFlags({ 'variant-flag': 'control' })

      expect(await posthog.getFeatureFlag('variant-flag', 'user-123')).toBe('control')
    })

    it('should support array syntax to enable multiple flags', async () => {
      mockedFetch.mockImplementation(apiImplementation({ localFlags: { flags: [] } }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      await waitForPromises()

      posthog.overrideFeatureFlags(['flag-a', 'flag-b', 'flag-c'])

      expect(await posthog.getFeatureFlag('flag-a', 'user-123')).toBe(true)
      expect(await posthog.getFeatureFlag('flag-b', 'user-123')).toBe(true)
      expect(await posthog.getFeatureFlag('flag-c', 'user-123')).toBe(true)
    })

    it('should clear all overrides when passed false', async () => {
      mockedFetch.mockImplementation(apiImplementation({ localFlags: { flags: [] } }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      await waitForPromises()

      // Set overrides
      posthog.overrideFeatureFlags({ 'test-flag': true })
      expect(await posthog.getFeatureFlag('test-flag', 'user-123')).toBe(true)

      // Clear overrides
      posthog.overrideFeatureFlags(false)

      // Should return undefined (no flag exists)
      expect(await posthog.getFeatureFlag('test-flag', 'user-123')).toBe(undefined)
    })

    it('should handle falsy override values correctly', async () => {
      mockedFetch.mockImplementation(apiImplementation({ localFlags: { flags: [] } }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      await waitForPromises()

      // Override with false should return false, not undefined
      posthog.overrideFeatureFlags({ 'disabled-flag': false })

      expect(await posthog.getFeatureFlag('disabled-flag', 'user-123')).toBe(false)
    })
  })

  describe('payload overrides', () => {
    it('should return overridden payload value', async () => {
      mockedFetch.mockImplementation(apiImplementation({ localFlags: { flags: [] } }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      await waitForPromises()

      posthog.overrideFeatureFlags({
        flags: { 'test-flag': 'variant-a' },
        payloads: { 'test-flag': { discount: 20, message: 'Welcome!' } },
      })

      expect(await posthog.getFeatureFlagPayload('test-flag', 'user-123')).toEqual({
        discount: 20,
        message: 'Welcome!',
      })
    })

    it('should support overriding only payloads without flags', async () => {
      const flags = {
        flags: [
          {
            id: 1,
            key: 'test-flag',
            active: true,
            filters: {
              groups: [{ rollout_percentage: 100 }],
            },
          },
        ],
      }
      mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      await waitForPromises()

      // Override only payload
      posthog.overrideFeatureFlags({
        payloads: { 'test-flag': { customData: true } },
      })

      // Flag should still be evaluated normally
      expect(await posthog.getFeatureFlag('test-flag', 'user-123')).toBe(true)
      // But payload should be overridden
      expect(await posthog.getFeatureFlagPayload('test-flag', 'user-123')).toEqual({ customData: true })
    })
  })

  describe('getAllFlags with overrides', () => {
    it('should include overridden flags in getAllFlags result', async () => {
      const flags = {
        flags: [
          {
            id: 1,
            key: 'server-flag',
            active: true,
            filters: {
              groups: [{ rollout_percentage: 100 }],
            },
          },
        ],
      }
      mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      await waitForPromises()

      posthog.overrideFeatureFlags({
        'override-flag': 'variant-x',
        'server-flag': false, // Override server flag
      })

      const allFlags = await posthog.getAllFlags('user-123')

      expect(allFlags['override-flag']).toBe('variant-x')
      expect(allFlags['server-flag']).toBe(false) // Override takes precedence
    })
  })

  describe('isFeatureEnabled with overrides', () => {
    it('should use override value for isFeatureEnabled', async () => {
      mockedFetch.mockImplementation(apiImplementation({ localFlags: { flags: [] } }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      await waitForPromises()

      posthog.overrideFeatureFlags({ 'enabled-flag': true, 'disabled-flag': false })

      expect(await posthog.isFeatureEnabled('enabled-flag', 'user-123')).toBe(true)
      expect(await posthog.isFeatureEnabled('disabled-flag', 'user-123')).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('should handle flag named "flags" correctly', async () => {
      mockedFetch.mockImplementation(apiImplementation({ localFlags: { flags: [] } }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      await waitForPromises()

      // A flag named "flags" with value true should work
      posthog.overrideFeatureFlags({ flags: true })

      expect(await posthog.getFeatureFlag('flags', 'user-123')).toBe(true)
    })

    it('should handle flag named "payloads" correctly', async () => {
      mockedFetch.mockImplementation(apiImplementation({ localFlags: { flags: [] } }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      await waitForPromises()

      // A flag named "payloads" with value "variant-a" should work
      posthog.overrideFeatureFlags({ payloads: 'variant-a' })

      expect(await posthog.getFeatureFlag('payloads', 'user-123')).toBe('variant-a')
    })

    it('should handle empty string as override value', async () => {
      mockedFetch.mockImplementation(apiImplementation({ localFlags: { flags: [] } }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      await waitForPromises()

      // Empty string is a falsy value but should still be returned (not undefined)
      posthog.overrideFeatureFlags({ 'my-flag': '' as any })

      expect(await posthog.getFeatureFlag('my-flag', 'user-123')).toBe('')
    })

    it('should replace all flag overrides when passed empty object', async () => {
      mockedFetch.mockImplementation(apiImplementation({ localFlags: { flags: [] } }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      await waitForPromises()

      // Set initial overrides
      posthog.overrideFeatureFlags({ 'flag-a': true, 'flag-b': 'variant' })
      expect(await posthog.getFeatureFlag('flag-a', 'user-123')).toBe(true)

      // Empty object replaces with empty overrides (effectively clearing)
      posthog.overrideFeatureFlags({})

      expect(await posthog.getFeatureFlag('flag-a', 'user-123')).toBe(undefined)
      expect(await posthog.getFeatureFlag('flag-b', 'user-123')).toBe(undefined)
    })

    it('should clear only flags when flags is false but preserve payload overrides', async () => {
      mockedFetch.mockImplementation(apiImplementation({ localFlags: { flags: [] } }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      await waitForPromises()

      // Set both flag and payload overrides
      posthog.overrideFeatureFlags({
        flags: { 'my-flag': 'variant-a' },
        payloads: { 'my-flag': { data: 'preserved' } },
      })

      expect(await posthog.getFeatureFlag('my-flag', 'user-123')).toBe('variant-a')
      expect(await posthog.getFeatureFlagPayload('my-flag', 'user-123')).toEqual({ data: 'preserved' })

      // Clear only flag overrides
      posthog.overrideFeatureFlags({ flags: false })

      // Flag should be undefined, but payload should still be overridden
      expect(await posthog.getFeatureFlag('my-flag', 'user-123')).toBe(undefined)
      expect(await posthog.getFeatureFlagPayload('my-flag', 'user-123')).toEqual({ data: 'preserved' })
    })

    it('should clear only payloads when payloads is false but preserve flag overrides', async () => {
      mockedFetch.mockImplementation(apiImplementation({ localFlags: { flags: [] } }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      await waitForPromises()

      // Set both flag and payload overrides
      posthog.overrideFeatureFlags({
        flags: { 'my-flag': 'variant-a' },
        payloads: { 'my-flag': { data: 'will-be-cleared' } },
      })

      expect(await posthog.getFeatureFlag('my-flag', 'user-123')).toBe('variant-a')
      expect(await posthog.getFeatureFlagPayload('my-flag', 'user-123')).toEqual({ data: 'will-be-cleared' })

      // Clear only payload overrides
      posthog.overrideFeatureFlags({ payloads: false })

      // Flag should still be overridden, but payload should fall back to evaluation (null = not found)
      expect(await posthog.getFeatureFlag('my-flag', 'user-123')).toBe('variant-a')
      expect(await posthog.getFeatureFlagPayload('my-flag', 'user-123')).toBeNull()
    })
  })
})
