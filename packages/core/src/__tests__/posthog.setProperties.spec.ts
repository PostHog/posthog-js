import { PostHogPersistedProperty } from '@/types'
import {
  createTestClient,
  PostHogCoreTestClient,
  PostHogCoreTestClientMocks,
  parseBody,
  waitForPromises,
} from '@/testing'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  let mocks: PostHogCoreTestClientMocks

  jest.useFakeTimers()
  jest.setSystemTime(new Date('2022-01-01'))

  beforeEach(() => {
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 })
  })

  describe('setGroupPropertiesForFlags', () => {
    it('should store setGroupPropertiesForFlags as persisted with group_properties key', () => {
      const props = { organisation: { name: 'bar' }, project: { name: 'baz' } }
      posthog.setGroupPropertiesForFlags(props)

      expect(mocks.storage.setItem).toHaveBeenCalledWith('group_properties', props)

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.GroupProperties)).toEqual(props)
    })

    it('should update setGroupPropertiesForFlags appropriately', () => {
      const props = { organisation: { name: 'bar' }, project: { name: 'baz' } }
      posthog.setGroupPropertiesForFlags(props)

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.GroupProperties)).toEqual(props)

      posthog.setGroupPropertiesForFlags({ organisation: { name: 'bar2' }, project: { name2: 'baz' } })
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.GroupProperties)).toEqual({
        organisation: { name: 'bar2' },
        project: { name: 'baz', name2: 'baz' },
      })

      posthog.setGroupPropertiesForFlags({ organisation2: { name: 'bar' } })
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.GroupProperties)).toEqual({
        organisation: { name: 'bar2' },
        project: { name: 'baz', name2: 'baz' },
        organisation2: { name: 'bar' },
      })
    })

    it('should clear setGroupPropertiesForFlags on reset', () => {
      const props = { organisation: { name: 'bar' }, project: { name: 'baz' } }
      posthog.setGroupPropertiesForFlags(props)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.GroupProperties)).toEqual(props)

      posthog.reset()
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.GroupProperties)).toEqual(undefined)

      posthog.setGroupPropertiesForFlags(props)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.GroupProperties)).toEqual(props)
    })
  })

  describe('setPersonPropertiesForFlags', () => {
    it('should store setPersonPropertiesForFlags as persisted with person_properties key', () => {
      const props = { organisation: 'bar', project: 'baz' }
      posthog.setPersonPropertiesForFlags(props)

      expect(mocks.storage.setItem).toHaveBeenCalledWith('person_properties', props)

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)).toEqual(props)
    })

    it('should update setPersonPropertiesForFlags appropriately', () => {
      const props = { organisation: 'bar', project: 'baz' }
      posthog.setPersonPropertiesForFlags(props)

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)).toEqual(props)

      posthog.setPersonPropertiesForFlags({ organisation: 'bar2', project2: 'baz' })
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)).toEqual({
        organisation: 'bar2',
        project: 'baz',
        project2: 'baz',
      })

      posthog.setPersonPropertiesForFlags({ organisation2: 'bar' })
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)).toEqual({
        organisation: 'bar2',
        project: 'baz',
        project2: 'baz',
        organisation2: 'bar',
      })
    })

    it('should clear setPersonPropertiesForFlags on reset', () => {
      const props = { organisation: 'bar', project: 'baz' }
      posthog.setPersonPropertiesForFlags(props)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)).toEqual(props)

      posthog.reset()
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)).toEqual(undefined)

      posthog.setPersonPropertiesForFlags(props)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.PersonProperties)).toEqual(props)
    })
  })

  describe('setPersonProperties', () => {
    it('should send a $set event with person properties', async () => {
      posthog.setPersonProperties({ email: 'test@example.com' })
      await waitForPromises()

      expect(mocks.fetch).toHaveBeenCalled()
      const batchCall = mocks.fetch.mock.calls.find((call) => call[0].includes('/batch/'))
      expect(batchCall).toBeDefined()
      expect(parseBody(batchCall)).toMatchObject({
        batch: [
          {
            event: '$set',
            properties: {
              $set: { email: 'test@example.com' },
              $set_once: {},
            },
          },
        ],
      })
    })

    it('should not send duplicate $set events with the same properties', async () => {
      // First call should send the event
      posthog.setPersonProperties({ email: 'test@example.com' })
      await waitForPromises()
      const callCount = mocks.fetch.mock.calls.filter((call) => call[0].includes('/batch/')).length

      // Second call with the same properties should be ignored
      posthog.setPersonProperties({ email: 'test@example.com' })
      await waitForPromises()
      const newCallCount = mocks.fetch.mock.calls.filter((call) => call[0].includes('/batch/')).length

      // Should not have made an additional batch call
      expect(newCallCount).toBe(callCount)
    })

    it('should send $set event when properties change', async () => {
      // First call
      posthog.setPersonProperties({ email: 'test@example.com' })
      await waitForPromises()
      const callCount = mocks.fetch.mock.calls.filter((call) => call[0].includes('/batch/')).length

      // Second call with different properties should send
      posthog.setPersonProperties({ email: 'new@example.com' })
      await waitForPromises()
      const newCallCount = mocks.fetch.mock.calls.filter((call) => call[0].includes('/batch/')).length

      expect(newCallCount).toBe(callCount + 1)
    })

    it('should clear cached person properties on reset', async () => {
      // First call
      posthog.setPersonProperties({ email: 'test@example.com' })
      await waitForPromises()
      const callCount = mocks.fetch.mock.calls.filter((call) => call[0].includes('/batch/')).length

      // Reset should clear the cache
      posthog.reset()
      await waitForPromises()

      // Same properties should now be sent again after reset
      posthog.setPersonProperties({ email: 'test@example.com' })
      await waitForPromises()
      const newCallCount = mocks.fetch.mock.calls.filter((call) => call[0].includes('/batch/')).length

      expect(newCallCount).toBeGreaterThan(callCount)
    })

    it('should send $set event when set_once properties are different', async () => {
      // First call with set_once
      posthog.setPersonProperties(undefined, { signup_date: '2024-01-01' })
      await waitForPromises()
      const callCount = mocks.fetch.mock.calls.filter((call) => call[0].includes('/batch/')).length

      // Second call with same set but different set_once should send
      posthog.setPersonProperties(undefined, { signup_date: '2024-01-02' })
      await waitForPromises()
      const newCallCount = mocks.fetch.mock.calls.filter((call) => call[0].includes('/batch/')).length

      expect(newCallCount).toBe(callCount + 1)
    })
  })
})
