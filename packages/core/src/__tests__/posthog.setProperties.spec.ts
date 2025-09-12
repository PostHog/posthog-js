import { PostHogPersistedProperty } from '@/types'
import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from '@/testing'

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
})
