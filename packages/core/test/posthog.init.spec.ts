import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from './test-utils/PostHogCoreTestClient'
import { waitForPromises } from './test-utils/test-utils'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  let mocks: PostHogCoreTestClientMocks

  beforeEach(() => {
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', {})
  })

  describe('init', () => {
    it('should initialise', () => {
      expect(posthog.optedOut).toEqual(false)
    })

    it('should throw if missing api key', () => {
      expect(() => createTestClient(undefined as unknown as string)).toThrowError(
        "You must pass your PostHog project's api key."
      )
    })

    it('should throw if empty api key', () => {
      expect(() => createTestClient('   ')).toThrowError("You must pass your PostHog project's api key.")
    })

    it('should throw if non string api key', () => {
      expect(() => createTestClient({} as string)).toThrowError("You must pass your PostHog project's api key.")
    })

    it('should initialise default options', () => {
      expect(posthog as any).toMatchObject({
        apiKey: 'TEST_API_KEY',
        host: 'https://us.i.posthog.com',
        flushAt: 20,
        flushInterval: 10000,
      })
    })

    it('overwrites defaults with options', () => {
      ;[posthog, mocks] = createTestClient('key', {
        host: 'https://a.com',
        flushAt: 1,
        flushInterval: 2,
      })

      expect(posthog).toMatchObject({
        apiKey: 'key',
        host: 'https://a.com',
        flushAt: 1,
        flushInterval: 2,
      })
    })

    it('should keep the flushAt option above zero', () => {
      ;[posthog, mocks] = createTestClient('key', { flushAt: -2 }) as any
      expect((posthog as any).flushAt).toEqual(1)
    })

    it('should remove trailing slashes from `host`', () => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { host: 'http://my-posthog.com///' })

      expect((posthog as any).host).toEqual('http://my-posthog.com')
    })

    it('should use bootstrapped distinct ID when present', async () => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { bootstrap: { distinctId: 'new_anon_id' } })

      expect((posthog as any).getDistinctId()).toEqual('new_anon_id')
      expect((posthog as any).getAnonymousId()).toEqual('new_anon_id')

      await posthog.identify('random_id')

      expect((posthog as any).getDistinctId()).toEqual('random_id')
      expect((posthog as any).getAnonymousId()).toEqual('new_anon_id')
    })

    it('should use bootstrapped distinct ID as identified ID when present', async () => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        bootstrap: { distinctId: 'new_id', isIdentifiedId: true },
      })
      jest.runOnlyPendingTimers()

      expect((posthog as any).getDistinctId()).toEqual('new_id')
      expect((posthog as any).getAnonymousId()).not.toEqual('new_id')

      await posthog.identify('random_id')

      expect((posthog as any).getDistinctId()).toEqual('random_id')
      expect((posthog as any).getAnonymousId()).toEqual('new_id')
    })
  })

  describe('disabled', () => {
    it('should not send events when disabled', async () => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        disabled: true,
        flushAt: 1,
      })
      jest.runOnlyPendingTimers()

      expect(posthog.getFeatureFlags()).toEqual(undefined)
      posthog.capture('test')
      posthog.capture('identify')

      await waitForPromises()

      expect(mocks.fetch).not.toHaveBeenCalled()
    })
  })
})
