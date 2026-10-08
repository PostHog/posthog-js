import { doesTourUrlMatch } from '../../extensions/product-tours/product-tours'
import { createMockPostHog } from '../helpers/posthog-instance'
import { ProductTour } from '../../posthog-product-tours-types'
import { PostHogConfig } from '../../types'

// Mirrors the survey/replay coverage: product tour URL conditions honor the `get_current_url`
// hook so Electron/desktop apps that rewrite their URL can scope tours to a logical URL.
describe('doesTourUrlMatch get_current_url override', () => {
    const setWindowLocation = (url: string) => {
        Object.defineProperty(window, 'location', { value: { href: url }, writable: true, configurable: true })
    }

    const posthogWith = (getCurrentUrl?: (defaultUrl: string) => string) =>
        createMockPostHog({
            config: {
                token: 'test-token',
                api_host: 'https://test.com',
                get_current_url: getCurrentUrl,
            } as PostHogConfig,
        })

    const tourWithUrl = (id: string, url: string): ProductTour =>
        ({ id, conditions: { url, urlMatchType: 'icontains' } }) as ProductTour

    it('matches against the overridden URL instead of window.location.href', () => {
        // raw browser URL would not match the condition
        setWindowLocation('https://generated-host.skin/game')
        const tour = tourWithUrl('tour-1', 'app.example.com')

        expect(
            doesTourUrlMatch(
                tour,
                posthogWith(() => 'https://app.example.com/welcome')
            )
        ).toBe(true)
    })

    it('does not match when the override rewrites away from the matching URL', () => {
        setWindowLocation('https://app.example.com/welcome')
        const tour = tourWithUrl('tour-2', 'app.example.com')

        expect(
            doesTourUrlMatch(
                tour,
                posthogWith(() => 'https://generated-host.skin/game')
            )
        ).toBe(false)
    })

    it('falls back to window.location.href when no override is configured', () => {
        setWindowLocation('https://app.example.com/welcome')
        const tour = tourWithUrl('tour-3', 'app.example.com')

        expect(doesTourUrlMatch(tour, posthogWith())).toBe(true)
    })

    it('invalidates its per-URL cache when the resolved targeting URL changes', () => {
        const tour = tourWithUrl('tour-4', 'app.example.com')
        let current = 'https://app.example.com/welcome'
        const instance = posthogWith(() => current)

        setWindowLocation('https://generated-host.skin/a')
        expect(doesTourUrlMatch(tour, instance)).toBe(true)

        // override now resolves to a non-matching URL — cache must not return the stale `true`
        current = 'https://generated-host.skin/b'
        expect(doesTourUrlMatch(tour, instance)).toBe(false)
    })
})
