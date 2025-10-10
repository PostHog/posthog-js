import { PostHog } from '../posthog-core'

describe('enable_bootstrap_from_url config', () => {
    let posthog: PostHog
    const originalLocation = window.location

    beforeEach(() => {
        // Mock window.location
        delete (window as any).location
        window.location = {
            ...originalLocation,
            href: 'https://example.com?__ph_distinct_id=test-user&__ph_session_id=test-session&__ph_is_identified=true',
        } as any

        posthog = new PostHog()
    })

    afterEach(() => {
        window.location = originalLocation
        posthog.persistence?.clear()
    })

    it('should NOT bootstrap from URL when enable_bootstrap_from_url is false (default)', () => {
        posthog._init('test-token', {
            persistence: 'memory',
            enable_bootstrap_from_url: false,
        })

        // Should NOT use URL params
        expect(posthog.get_distinct_id()).not.toBe('test-user')
    })

    it('should bootstrap from URL when enable_bootstrap_from_url is true', () => {
        posthog._init('test-token', {
            persistence: 'memory',
            enable_bootstrap_from_url: true,
        })

        // Should use URL params
        expect(posthog.get_distinct_id()).toBe('test-user')
        expect(posthog.persistence?.get_property('$user_state')).toBe('identified')
    })

    it('should prioritize explicit bootstrap config over URL params', () => {
        posthog._init('test-token', {
            persistence: 'memory',
            enable_bootstrap_from_url: true,
            bootstrap: {
                distinctID: 'explicit-user',
                sessionID: 'explicit-session',
                isIdentifiedID: false,
            },
        })

        // Should use explicit config, not URL params
        expect(posthog.get_distinct_id()).toBe('explicit-user')
        expect(posthog.persistence?.get_property('$user_state')).toBe('anonymous')
    })

    it('should work with URL without bootstrap params when enabled', () => {
        window.location.href = 'https://example.com'

        posthog._init('test-token', {
            persistence: 'memory',
            enable_bootstrap_from_url: true,
        })

        // Should generate a new distinct_id
        expect(posthog.get_distinct_id()).toBeTruthy()
        expect(posthog.get_distinct_id()).not.toBe('test-user')
    })

    it('should handle partial URL params', () => {
        window.location.href = 'https://example.com?__ph_distinct_id=partial-user'

        posthog._init('test-token', {
            persistence: 'memory',
            enable_bootstrap_from_url: true,
        })

        // Should use the distinct_id from URL
        expect(posthog.get_distinct_id()).toBe('partial-user')
    })

    it('should handle is_identified as false', () => {
        window.location.href = 'https://example.com?__ph_distinct_id=anon-user&__ph_is_identified=false'

        posthog._init('test-token', {
            persistence: 'memory',
            enable_bootstrap_from_url: true,
        })

        expect(posthog.get_distinct_id()).toBe('anon-user')
        expect(posthog.persistence?.get_property('$user_state')).toBe('anonymous')
    })

    it('should preserve explicit bootstrap config when enable_bootstrap_from_url is false (default)', () => {
        posthog._init('test-token', {
            persistence: 'memory',
            enable_bootstrap_from_url: false,
            bootstrap: {
                distinctID: 'automated-tester',
                isIdentifiedID: true,
            },
        })

        // Should use explicit bootstrap config, even with URL params present
        expect(posthog.get_distinct_id()).toBe('automated-tester')
        expect(posthog.persistence?.get_property('$user_state')).toBe('identified')
    })
})
