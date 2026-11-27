import { PostHogPersistedProperty } from '@/types'
import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from '@/testing'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  let mocks: PostHogCoreTestClientMocks

  const getEnrichedProperties = (): any => {
    // NOTE: Hacky override so we can just test the props functionality
    return (posthog as any).enrichProperties()
  }

  beforeEach(() => {
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', {})
  })

  describe('register', () => {
    it('should register properties to storage', () => {
      posthog.register({ foo: 'bar' })
      expect(getEnrichedProperties()).toMatchObject({ foo: 'bar' })
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Props)).toEqual({ foo: 'bar' })
      posthog.register({ foo2: 'bar2' })
      expect(getEnrichedProperties()).toMatchObject({ foo: 'bar', foo2: 'bar2' })
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Props)).toEqual({ foo: 'bar', foo2: 'bar2' })
    })

    it('should unregister properties from storage', () => {
      posthog.register({ foo: 'bar', foo2: 'bar2' })
      posthog.unregister('foo')
      expect(getEnrichedProperties().foo).toBeUndefined()
      expect(getEnrichedProperties().foo2).toEqual('bar2')
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Props)).toEqual({ foo2: 'bar2' })
    })

    it('should register properties only for the session', () => {
      posthog.registerForSession({ foo: 'bar' })
      expect(getEnrichedProperties()).toMatchObject({ foo: 'bar' })
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Props)).toEqual(undefined)

      posthog.register({ foo: 'bar2' })
      expect(getEnrichedProperties()).toMatchObject({ foo: 'bar' })
      posthog.unregisterForSession('foo')
      expect(getEnrichedProperties()).toMatchObject({ foo: 'bar2' })
    })
  })

  describe('event property order', () => {
    const captured = (properties?: Record<string, any>): any => {
      const onCapture = vi.fn()
      posthog.on('capture', onCapture)
      posthog.capture('custom-event', properties)
      return onCapture.mock.calls[0][0].properties
    }
    const useNativePropertyOrder = (): void => {
      vi.spyOn(posthog as any, 'usesLegacyEventPropertyOrder').mockReturnValue(false)
    }

    it('lets the SDK properties and session id replace registered and caller ones in the legacy order', () => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { disableGeoip: true })
      posthog.register({ $lib: 'registered-lib', $geoip_disable: false })

      expect(captured({ $session_id: 'caller-session' })).toMatchObject({
        $lib: 'posthog-core-tests',
        $lib_version: '2.0.0-alpha',
        $session_id: posthog.getSessionId(),
        $geoip_disable: true,
      })
    })

    it('lets registered properties win over the SDK properties and caller properties win over both', () => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { disableGeoip: true })
      useNativePropertyOrder()
      posthog.register({ $lib: 'registered-lib', $lib_version: '1.0.0', $geoip_disable: false, $session_id: 'a' })

      expect(captured({ $session_id: 'caller-session' })).toMatchObject({
        $lib: 'registered-lib',
        $lib_version: '1.0.0',
        $session_id: 'caller-session',
        $geoip_disable: false,
      })
    })

    it.each([true, false])('lets a per-call disableGeoip: %s win over a registered GeoIP property', (disableGeoip) => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { disableGeoip: true })
      useNativePropertyOrder()
      posthog.register({ $geoip_disable: !disableGeoip })
      const onCapture = vi.fn()
      posthog.on('capture', onCapture)
      posthog.capture('custom-event', {}, { disableGeoip })
      expect(onCapture.mock.calls[0][0].properties.$geoip_disable).toBe(disableGeoip)
    })

    it('reads the SDK session only when no registered or caller session id is set', () => {
      useNativePropertyOrder()
      const getSessionId = vi.spyOn(posthog, 'getSessionId')
      posthog.register({ $session_id: 'registered-session' })
      captured({ $session_id: 'caller-session' })
      captured()
      expect(getSessionId).not.toHaveBeenCalled()

      posthog.unregister('$session_id')
      captured({ $session_id: ' ' })
      expect(getSessionId).toHaveBeenCalledTimes(1)
    })

    it.each([null, ' '])('treats a %j caller session id as unset', (sessionId) => {
      useNativePropertyOrder()
      expect(captured({ $session_id: sessionId }).$session_id).toBe(posthog.getSessionId())
    })

    it.each([
      [{ $lib: 'wrapper' }, { $lib: 'wrapper' }],
      [{ $lib_version: '9.9.9' }, { $lib: 'posthog-core-tests', $lib_version: '2.0.0-alpha' }],
      [{ $lib: 'posthog-core-tests' }, { $lib: 'posthog-core-tests', $lib_version: '2.0.0-alpha' }],
      [
        { $lib: '', $lib_version: '9.9.9' },
        { $lib: 'posthog-core-tests', $lib_version: '2.0.0-alpha' },
      ],
    ])('fills the library name and version as a pair after the caller properties (case %#)', (properties, expected) => {
      useNativePropertyOrder()
      const sent = captured(properties)
      expect({ $lib: sent.$lib, $lib_version: sent.$lib_version }).toEqual({ $lib_version: undefined, ...expected })
    })
  })
})
