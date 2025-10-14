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

    it('should parse session entry properties from URL params', () => {
        window.location.href =
            'https://example.com?__ph_distinct_id=test-user&__ph_session_id=test-session&__ph_session_entry_utm_source=facebook&__ph_session_entry_utm_campaign=summer_sale&__ph_session_entry_utm_medium=social'

        posthog._init('test-token', {
            persistence: 'memory',
            enable_bootstrap_from_url: true,
        })

        const sessionProps = posthog.get_session_properties()

        expect(sessionProps).toEqual({
            $session_entry_utm_source: 'facebook',
            $session_entry_utm_campaign: 'summer_sale',
            $session_entry_utm_medium: 'social',
        })
    })

    it('should handle URL with only session entry properties', () => {
        window.location.href =
            'https://example.com?__ph_session_entry_utm_source=google&__ph_session_entry_referring_domain=example.org'

        posthog._init('test-token', {
            persistence: 'memory',
            enable_bootstrap_from_url: true,
        })

        const sessionProps = posthog.get_session_properties()

        expect(sessionProps).toEqual({
            $session_entry_utm_source: 'google',
            $session_entry_referring_domain: 'example.org',
        })
    })

    it('should work with URL that has no session entry properties', () => {
        window.location.href = 'https://example.com?__ph_distinct_id=test-user&__ph_session_id=test-session'

        posthog._init('test-token', {
            persistence: 'memory',
            enable_bootstrap_from_url: true,
        })

        // Should derive session props from current page since no bootstrapped props
        const sessionProps = posthog.get_session_properties()

        // We expect it to be an object (could be empty or derived from current page)
        expect(typeof sessionProps).toBe('object')
    })

    it('should URL decode session entry property values', () => {
        const encodedValue = encodeURIComponent('Test Campaign with spaces & special chars!')
        window.location.href = `https://example.com?__ph_session_entry_utm_campaign=${encodedValue}`

        posthog._init('test-token', {
            persistence: 'memory',
            enable_bootstrap_from_url: true,
        })

        const sessionProps = posthog.get_session_properties()

        expect(sessionProps.$session_entry_utm_campaign).toBe('Test Campaign with spaces & special chars!')
    })

    it('should preserve session entry properties across events', () => {
        window.location.href =
            'https://example.com?__ph_distinct_id=test-user&__ph_session_id=test-session&__ph_session_entry_utm_source=linkedin&__ph_session_entry_utm_campaign=product_launch'

        posthog._init('test-token', {
            persistence: 'memory',
            enable_bootstrap_from_url: true,
        })

        // Verify that session props are available
        const sessionProps = posthog.get_session_properties()
        expect(sessionProps).toHaveProperty('$session_entry_utm_source', 'linkedin')
        expect(sessionProps).toHaveProperty('$session_entry_utm_campaign', 'product_launch')

        // The session props should be the same on subsequent calls
        const sessionProps2 = posthog.get_session_properties()
        expect(sessionProps2).toEqual(sessionProps)
    })
})
