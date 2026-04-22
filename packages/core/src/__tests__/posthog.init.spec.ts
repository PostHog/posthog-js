import { createTestClient, waitForPromises, PostHogCoreTestClient, PostHogCoreTestClientMocks } from '@/testing'

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

    it.each([
      ['missing', undefined as unknown as string],
      ['empty', '   '],
      ['non string', {} as string],
    ])('should disable and log if %s api key', (_case, apiKey) => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

      try {
        const [client, clientMocks] = createTestClient(apiKey)

        expect(client.isDisabled).toEqual(true)
        expect((client as any).apiKey).toEqual('')
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[PostHog]',
          "You must pass your PostHog project's api key. The client will be disabled."
        )

        client.capture('test')

        expect(clientMocks.fetch).not.toHaveBeenCalled()
      } finally {
        consoleErrorSpy.mockRestore()
      }
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

    it.each([
      {
        name: 'trims whitespace from the api key and host',
        apiKey: '  TEST_API_KEY\n',
        host: '  http://my-posthog.com///\t ',
        expectedApiKey: 'TEST_API_KEY',
        expectedHost: 'http://my-posthog.com',
      },
      {
        name: 'defaults a blank host after trimming whitespace',
        apiKey: 'TEST_API_KEY',
        host: ' \n\t ',
        expectedApiKey: 'TEST_API_KEY',
        expectedHost: 'https://us.i.posthog.com',
      },
    ])('should $name', ({ apiKey, host, expectedApiKey, expectedHost }) => {
      ;[posthog, mocks] = createTestClient(apiKey, { host })

      expect((posthog as any).apiKey).toEqual(expectedApiKey)
      expect((posthog as any).host).toEqual(expectedHost)
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
