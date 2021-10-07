import { PostHogPersistence } from '../posthog-persistence'
import { cookieStore } from '../storage'

given('lib', () => new PostHogPersistence({ name: 'bla', persistence: 'cookie' }))

describe('persistence', () => {
    afterEach(() => {
        given.lib.clear()
    })

    it('should set referrer', () => {
        // Initial visit
        given.lib.update_referrer_info('https://www.google.com')

        expect(given.lib.props['$initial_referring_domain']).toBe('www.google.com')
        expect(given.lib.props['$referring_domain']).toBe('www.google.com')
        expect(given.lib.props['$referrer']).toBe('https://www.google.com')

        //subsequent visit
        given.lib.update_referrer_info('https://www.facebook.com')
        // first touch
        expect(given.lib.props['$initial_referring_domain']).toBe('www.google.com')

        // last touch
        expect(given.lib.props['$referring_domain']).toBe('www.facebook.com')
        expect(given.lib.props['$referrer']).toBe('https://www.facebook.com')

        // page visit that doesn't have direct referrer
        given.lib.update_referrer_info('')
        expect(given.lib.props['$initial_referring_domain']).toBe('www.google.com')
        // last touch should still be set to facebook
        expect(given.lib.props['$referring_domain']).toBe('www.facebook.com')
        expect(given.lib.props['$referrer']).toBe('https://www.facebook.com')
    })

    it('extracts enabled feature flags', () => {
        given.lib.register({ $enabled_feature_flags: { flag: 'variant', other: true } })
        expect(given.lib.props['$enabled_feature_flags']).toEqual({ flag: 'variant', other: true })
        expect(given.lib.properties()).toEqual({
            '$feature/flag': 'variant',
            '$feature/other': true,
        })
    })

    it('should migrate data from cookies to localStorage', () => {
        let lib = new PostHogPersistence({ name: 'bla', persistence: 'cookie' })
        lib.register_once({ distinct_id: 'testy', test_prop: 'test_value' })
        expect(document.cookie).toEqual(
            'ph__posthog=%7B%22distinct_id%22%3A%22testy%22%2C%22test_prop%22%3A%22test_value%22%7D'
        )
        let lib2 = new PostHogPersistence({ name: 'bla', persistence: 'localStorage+cookie' })
        expect(document.cookie).toEqual('ph__posthog=%7B%22distinct_id%22%3A%22testy%22%7D')
        lib2.register_once({ test_prop2: 'test_val' })
        expect(lib2.props).toEqual({ distinct_id: 'testy', test_prop: 'test_value', test_prop2: 'test_val' })
        lib2.remove('ph__posthog')
        expect(localStorage.getItem('ph__posthog')).toEqual(null)
        expect(document.cookie).toEqual('')
    })
})
