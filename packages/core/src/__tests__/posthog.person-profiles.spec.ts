import {
  parseBody,
  waitForPromises,
  createTestClient,
  PostHogCoreTestClient,
  PostHogCoreTestClientMocks,
} from '@/testing'
import { PostHogPersistedProperty } from '@/types'

describe('PostHog Core - Person Profiles', () => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date('2022-01-01'))

  describe('personProfiles: "identified_only" (default)', () => {
    let posthog: PostHogCoreTestClient
    let mocks: PostHogCoreTestClientMocks

    beforeEach(() => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        personProfiles: 'identified_only',
      })
    })

    it('should set $process_person_profile to false for anonymous users', async () => {
      posthog.capture('test-event')
      await waitForPromises()

      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].properties.$process_person_profile).toBe(false)
    })

    it('should set $is_identified to false for anonymous users', async () => {
      posthog.capture('test-event')
      await waitForPromises()

      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].properties.$is_identified).toBe(false)
    })

    it('should set $is_identified to true after identify()', async () => {
      posthog.identify('user-123')
      await waitForPromises()

      mocks.fetch.mockClear()
      posthog.capture('test-event')
      await waitForPromises()

      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].properties.$is_identified).toBe(true)
    })

    it('should set $process_person_profile to true after identify()', async () => {
      posthog.identify('user-123')
      await waitForPromises()

      mocks.fetch.mockClear()
      posthog.capture('test-event')
      await waitForPromises()

      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].properties.$process_person_profile).toBe(true)
    })

    it('should allow identify() to work', async () => {
      posthog.identify('user-123', { name: 'Test User' })
      await waitForPromises()

      // identify triggers flags call (1) and batch call (2)
      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      const batchCall = mocks.fetch.mock.calls[1]
      const body = parseBody(batchCall)
      expect(body.batch[0].event).toBe('$identify')
    })

    it('should allow alias() to work', async () => {
      posthog.alias('alias-id')
      await waitForPromises()

      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].event).toBe('$create_alias')
    })

    it('should set $process_person_profile to true after group()', async () => {
      posthog.group('company', 'company-123')
      await waitForPromises()

      mocks.fetch.mockClear()
      posthog.capture('test-event')
      await waitForPromises()

      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].properties.$process_person_profile).toBe(true)
    })

    it('should set $process_person_profile to true after groups()', async () => {
      posthog.groups({ company: 'company-123' })
      await waitForPromises()

      mocks.fetch.mockClear()
      posthog.capture('test-event')
      await waitForPromises()

      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].properties.$process_person_profile).toBe(true)
    })

    it('should allow groupIdentify() to work', async () => {
      posthog.groupIdentify('company', 'company-123', { name: 'Acme Inc' })
      await waitForPromises()

      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      const batchCall = mocks.fetch.mock.calls[0]
      const body = parseBody(batchCall)
      expect(body.batch[0].event).toBe('$groupidentify')
      expect(body.batch[0].properties.$group_type).toBe('company')
      expect(body.batch[0].properties.$group_key).toBe('company-123')
      expect(body.batch[0].properties.$group_set).toEqual({ name: 'Acme Inc' })
    })

    it('should allow createPersonProfile() to enable person processing', async () => {
      posthog.createPersonProfile()
      await waitForPromises()

      mocks.fetch.mockClear()
      posthog.capture('test-event')
      await waitForPromises()

      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].properties.$process_person_profile).toBe(true)
    })

    it('should persist person mode as identified after identify()', async () => {
      posthog.identify('user-123')
      await waitForPromises()

      expect(mocks.storage.setItem).toHaveBeenCalledWith(PostHogPersistedProperty.PersonMode, 'identified')
    })
  })

  describe('personProfiles: "always"', () => {
    let posthog: PostHogCoreTestClient
    let mocks: PostHogCoreTestClientMocks

    beforeEach(() => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        personProfiles: 'always',
      })
    })

    it('should set $process_person_profile to true for all events', async () => {
      posthog.capture('test-event')
      await waitForPromises()

      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].properties.$process_person_profile).toBe(true)
    })

    it('should allow identify() to work', async () => {
      posthog.identify('user-123')
      await waitForPromises()

      expect(mocks.fetch).toHaveBeenCalled()
      const batchCall = mocks.fetch.mock.calls[1]
      const body = parseBody(batchCall)
      expect(body.batch[0].event).toBe('$identify')
    })
  })

  describe('personProfiles: "never"', () => {
    let posthog: PostHogCoreTestClient
    let mocks: PostHogCoreTestClientMocks

    beforeEach(() => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        personProfiles: 'never',
      })
    })

    it('should set $process_person_profile to false for all events', async () => {
      posthog.capture('test-event')
      await waitForPromises()

      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].properties.$process_person_profile).toBe(false)
    })

    it('should not send identify events', async () => {
      posthog.identify('user-123')
      await waitForPromises()

      // Should not have sent any batch calls for identify
      const batchCalls = mocks.fetch.mock.calls.filter((call) => call[0].includes('/batch/'))
      expect(batchCalls.length).toBe(0)
    })

    it('should not send alias events', async () => {
      posthog.alias('alias-id')
      await waitForPromises()

      const batchCalls = mocks.fetch.mock.calls.filter((call) => call[0].includes('/batch/'))
      expect(batchCalls.length).toBe(0)
    })

    it('should not register groups via group()', async () => {
      posthog.group('company', 'company-123')
      await waitForPromises()

      // Capture an event and verify $groups is not set
      mocks.fetch.mockClear()
      posthog.capture('test-event')
      await waitForPromises()

      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].properties.$groups).toBeUndefined()
    })

    it('should not register groups via groups()', async () => {
      posthog.groups({ company: 'company-123', team: 'team-456' })
      await waitForPromises()

      // Capture an event and verify $groups is not set
      mocks.fetch.mockClear()
      posthog.capture('test-event')
      await waitForPromises()

      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].properties.$groups).toBeUndefined()
    })

    it('should not send groupIdentify events', async () => {
      posthog.groupIdentify('company', 'company-123', { name: 'Acme Inc' })
      await waitForPromises()

      const batchCalls = mocks.fetch.mock.calls.filter((call) => call[0].includes('/batch/'))
      expect(batchCalls.length).toBe(0)
    })

    it('should not send groupIdentify events when called via group() with properties', async () => {
      posthog.group('company', 'company-123', { name: 'Acme Inc' })
      await waitForPromises()

      const batchCalls = mocks.fetch.mock.calls.filter((call) => call[0].includes('/batch/'))
      expect(batchCalls.length).toBe(0)
    })

    it('should not enable person processing via createPersonProfile()', async () => {
      posthog.createPersonProfile()
      await waitForPromises()

      // After createPersonProfile, capture should still have $process_person_profile: false
      mocks.fetch.mockClear()
      posthog.capture('test-event')
      await waitForPromises()

      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].properties.$process_person_profile).toBe(false)
    })
  })

  describe('backwards compatibility - existing identified users', () => {
    it('should detect identified user when DistinctId differs from AnonymousId (no PersonMode set)', async () => {
      const [posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        personProfiles: 'identified_only',
      })

      // Simulate an existing user who was identified before SDK upgrade
      // They have different DistinctId and AnonymousId, but no PersonMode set
      mocks.storage.setItem(PostHogPersistedProperty.DistinctId, 'user-123')
      mocks.storage.setItem(PostHogPersistedProperty.AnonymousId, 'anon-456')
      // PersonMode is NOT set (simulating upgrade from old SDK)

      posthog.capture('test-event')
      await waitForPromises()

      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].properties.$process_person_profile).toBe(true)
    })

    it('should detect anonymous user when DistinctId equals AnonymousId (no PersonMode set)', async () => {
      const [posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        personProfiles: 'identified_only',
      })

      // Simulate an anonymous user - DistinctId and AnonymousId are the same
      const anonId = 'anon-123'
      mocks.storage.setItem(PostHogPersistedProperty.DistinctId, anonId)
      mocks.storage.setItem(PostHogPersistedProperty.AnonymousId, anonId)
      // PersonMode is NOT set

      posthog.capture('test-event')
      await waitForPromises()

      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].properties.$process_person_profile).toBe(false)
    })

    it('should use PersonMode when explicitly set, even if IDs differ', async () => {
      const [posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        personProfiles: 'identified_only',
      })

      // PersonMode is explicitly set to undefined/not 'identified'
      // but IDs are different - PersonMode should take precedence when set
      mocks.storage.setItem(PostHogPersistedProperty.DistinctId, 'user-123')
      mocks.storage.setItem(PostHogPersistedProperty.AnonymousId, 'anon-456')
      mocks.storage.setItem(PostHogPersistedProperty.PersonMode, 'anonymous')

      posthog.capture('test-event')
      await waitForPromises()

      const body = parseBody(mocks.fetch.mock.calls[0])
      // PersonMode is 'anonymous', so should be false even though IDs differ
      expect(body.batch[0].properties.$process_person_profile).toBe(false)
    })
  })

  describe('bootstrap with isIdentifiedId', () => {
    it('should mark user as identified when bootstrapping with isIdentifiedId: true', async () => {
      const [posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        personProfiles: 'identified_only',
        bootstrap: {
          distinctId: 'user-123',
          isIdentifiedId: true,
        },
      })

      posthog.capture('test-event')
      await waitForPromises()

      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].properties.$process_person_profile).toBe(true)
    })

    it('should NOT mark user as identified when bootstrapping with isIdentifiedId: false', async () => {
      const [posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        personProfiles: 'identified_only',
        bootstrap: {
          distinctId: 'anon-123',
          isIdentifiedId: false,
        },
      })

      posthog.capture('test-event')
      await waitForPromises()

      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].properties.$process_person_profile).toBe(false)
    })
  })

  describe('setPersonProperties', () => {
    describe('personProfiles: "identified_only" (default)', () => {
      let posthog: PostHogCoreTestClient
      let mocks: PostHogCoreTestClientMocks

      beforeEach(() => {
        ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
          flushAt: 1,
          personProfiles: 'identified_only',
        })
      })

      it('should send a $set event with provided properties', async () => {
        posthog.setPersonProperties({ email: 'test@example.com', name: 'Test User' }, undefined, false)
        await waitForPromises()

        expect(mocks.fetch).toHaveBeenCalled()
        const batchCall = mocks.fetch.mock.calls.find((call: any) => call[0].includes('/batch'))
        const body = parseBody(batchCall)
        expect(body.batch[0].event).toBe('$set')
        expect(body.batch[0].properties.$set).toEqual({ email: 'test@example.com', name: 'Test User' })
        expect(body.batch[0].properties.$set_once).toEqual({})
      })

      it('should send a $set event with $set_once properties', async () => {
        posthog.setPersonProperties(undefined, { first_login: '2022-01-01' }, false)
        await waitForPromises()

        expect(mocks.fetch).toHaveBeenCalled()
        const batchCall = mocks.fetch.mock.calls.find((call: any) => call[0].includes('/batch'))
        const body = parseBody(batchCall)
        expect(body.batch[0].event).toBe('$set')
        expect(body.batch[0].properties.$set).toEqual({})
        expect(body.batch[0].properties.$set_once).toEqual({ first_login: '2022-01-01' })
      })

      it('should send both $set and $set_once properties', async () => {
        posthog.setPersonProperties({ email: 'test@example.com' }, { first_login: '2022-01-01' }, false)
        await waitForPromises()

        expect(mocks.fetch).toHaveBeenCalled()
        const batchCall = mocks.fetch.mock.calls.find((call: any) => call[0].includes('/batch'))
        const body = parseBody(batchCall)
        expect(body.batch[0].event).toBe('$set')
        expect(body.batch[0].properties.$set).toEqual({ email: 'test@example.com' })
        expect(body.batch[0].properties.$set_once).toEqual({ first_login: '2022-01-01' })
      })

      it('should enable person processing for subsequent events', async () => {
        // First capture without setPersonProperties
        posthog.capture('before-event')
        await waitForPromises()

        let batchCall = mocks.fetch.mock.calls.find((call: any) => call[0].includes('/batch'))
        let body = parseBody(batchCall)
        expect(body.batch[0].properties.$process_person_profile).toBe(false)

        mocks.fetch.mockClear()

        // Now call setPersonProperties (with reloadFeatureFlags=false to simplify test)
        posthog.setPersonProperties({ email: 'test@example.com' }, undefined, false)
        await waitForPromises()

        // Check the $set event has person processing enabled
        batchCall = mocks.fetch.mock.calls.find((call: any) => call[0].includes('/batch'))
        body = parseBody(batchCall)
        expect(body.batch[0].event).toBe('$set')
        expect(body.batch[0].properties.$process_person_profile).toBe(true)

        mocks.fetch.mockClear()

        // Capture another event - should now have person processing enabled
        posthog.capture('after-event')
        await waitForPromises()

        batchCall = mocks.fetch.mock.calls.find((call: any) => call[0].includes('/batch'))
        body = parseBody(batchCall)
        expect(body.batch[0].properties.$process_person_profile).toBe(true)
      })

      it('should reload feature flags by default', async () => {
        posthog.setPersonProperties({ email: 'test@example.com' })
        await waitForPromises()

        const flagsCall = mocks.fetch.mock.calls.find((call: any) => call[0].includes('/flags'))
        expect(flagsCall).toBeDefined()
      })

      it('should not reload feature flags when reloadFeatureFlags is false', async () => {
        posthog.setPersonProperties({ email: 'test@example.com' }, undefined, false)
        await waitForPromises()

        const flagsCall = mocks.fetch.mock.calls.find((call: any) => call[0].includes('/flags'))
        expect(flagsCall).toBeUndefined()
      })

      it('should not send event if both properties are undefined', async () => {
        posthog.setPersonProperties(undefined, undefined)
        await waitForPromises()

        expect(mocks.fetch).not.toHaveBeenCalled()
      })

      it('should update person properties for feature flag evaluation', async () => {
        posthog.setPersonProperties({ plan: 'enterprise' })
        await waitForPromises()

        expect(mocks.storage.setItem).toHaveBeenCalledWith(
          PostHogPersistedProperty.PersonProperties,
          expect.objectContaining({ plan: 'enterprise' })
        )
      })
    })

    describe('personProfiles: "always"', () => {
      let posthog: PostHogCoreTestClient
      let mocks: PostHogCoreTestClientMocks

      beforeEach(() => {
        ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
          flushAt: 1,
          personProfiles: 'always',
        })
      })

      it('should send a $set event', async () => {
        posthog.setPersonProperties({ email: 'test@example.com' }, undefined, false)
        await waitForPromises()

        expect(mocks.fetch).toHaveBeenCalled()
        const batchCall = mocks.fetch.mock.calls.find((call: any) => call[0].includes('/batch'))
        const body = parseBody(batchCall)
        expect(body.batch[0].event).toBe('$set')
        expect(body.batch[0].properties.$set).toEqual({ email: 'test@example.com' })
      })
    })

    describe('personProfiles: "never"', () => {
      let posthog: PostHogCoreTestClient
      let mocks: PostHogCoreTestClientMocks

      beforeEach(() => {
        ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
          flushAt: 1,
          personProfiles: 'never',
        })
      })

      it('should not send a $set event', async () => {
        posthog.setPersonProperties({ email: 'test@example.com' })
        await waitForPromises()

        const batchCalls = mocks.fetch.mock.calls.filter((call) => call[0].includes('/batch/'))
        expect(batchCalls.length).toBe(0)
      })

      it('should not enable person processing for subsequent events', async () => {
        posthog.setPersonProperties({ email: 'test@example.com' })
        await waitForPromises()

        posthog.capture('test-event')
        await waitForPromises()

        const batchCalls = mocks.fetch.mock.calls.filter((call) => call[0].includes('/batch/'))
        if (batchCalls.length > 0) {
          const body = parseBody(batchCalls[0])
          expect(body.batch[0].properties.$process_person_profile).toBe(false)
        }
      })
    })
  })
})
