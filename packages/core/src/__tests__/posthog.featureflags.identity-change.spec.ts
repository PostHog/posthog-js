import { PostHogPersistedProperty } from '@/types'
import { createTestClient, parseBody, waitForPromises, PostHogCoreTestClient } from '@/testing'

type FlagsRequest = {
  distinctId: string
  respond: (flags: Record<string, { enabled: boolean; payload?: string }>) => void
}

describe('PostHog Feature Flags: identity change while a request is in flight', () => {
  let posthog: PostHogCoreTestClient
  let flagsRequests: FlagsRequest[]

  beforeEach(() => {
    flagsRequests = []
    ;[posthog] = createTestClient('TEST_API_KEY', { flushAt: 1 }, (mocks) => {
      mocks.fetch.mockImplementation((url, options) => {
        if (!url.includes('/flags/?v=2')) {
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve('ok'),
            json: () => Promise.resolve({ status: 'ok' }),
          })
        }
        // Each flags request stays in flight until the test answers it.
        return new Promise((resolve) => {
          flagsRequests.push({
            distinctId: parseBody([url, options]).distinct_id,
            respond: (flags) =>
              resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () =>
                  Promise.resolve({
                    flags: Object.fromEntries(
                      Object.entries(flags).map(([key, { enabled, payload }], index) => [
                        key,
                        {
                          key,
                          enabled,
                          variant: undefined,
                          reason: { code: 'matched_condition', description: 'matched', condition_index: 0 },
                          metadata: { id: index + 1, version: 1, description: key, payload },
                        },
                      ])
                    ),
                    requestId: '0152a345-295f-4fba-adac-2e6ea9c91082',
                  }),
              }),
          })
        })
      })
    })
  })

  it('does not store the previous user’s flags when reset() runs before the response arrives', async () => {
    posthog.identify('user-a')
    await waitForPromises()
    expect(flagsRequests).toHaveLength(1)
    expect(flagsRequests[0].distinctId).toBe('user-a')

    // user-a signs out while their flags request is still in flight
    posthog.reset()
    const anonymousId = posthog.getDistinctId()
    expect(anonymousId).not.toBe('user-a')

    flagsRequests[0].respond({ 'staff-tools': { enabled: true, payload: '{"account":"user-a"}' } })
    await waitForPromises()

    // The reload reset() queued has gone out for the new identity and has not been answered.
    expect(flagsRequests).toHaveLength(2)
    expect(flagsRequests[1].distinctId).toBe(anonymousId)

    expect(posthog.getFeatureFlags()).toBeUndefined()
    expect(posthog.getFeatureFlagPayloads()).toBeUndefined()
    expect(posthog.getPersistedProperty(PostHogPersistedProperty.FeatureFlagDetails)).toBeUndefined()

    flagsRequests[1].respond({ 'public-banner': { enabled: true } })
    await waitForPromises()

    expect(posthog.getFeatureFlags()).toEqual({ 'public-banner': true })
  })

  it('does not store the previous user’s flags when identify() switches to another user', async () => {
    posthog.identify('user-a')
    await waitForPromises()
    expect(flagsRequests).toHaveLength(1)

    posthog.identify('user-b')
    flagsRequests[0].respond({ 'staff-tools': { enabled: true, payload: '{"account":"user-a"}' } })
    await waitForPromises()

    expect(flagsRequests).toHaveLength(2)
    expect(flagsRequests[1].distinctId).toBe('user-b')
    expect(posthog.getFeatureFlags()).toBeUndefined()

    flagsRequests[1].respond({ 'public-banner': { enabled: true } })
    await waitForPromises()

    expect(posthog.getFeatureFlags()).toEqual({ 'public-banner': true })
  })

  it('still stores the response when the identity has not changed', async () => {
    posthog.identify('user-a')
    await waitForPromises()

    flagsRequests[0].respond({ 'staff-tools': { enabled: true } })
    await waitForPromises()

    expect(flagsRequests).toHaveLength(1)
    expect(posthog.getFeatureFlags()).toEqual({ 'staff-tools': true })
  })
})
