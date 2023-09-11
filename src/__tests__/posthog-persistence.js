import { PostHogPersistence } from '../posthog-persistence'
import { SESSION_ID, USER_STATE } from '../constants'

given('lib', () => new PostHogPersistence({ name: 'bla', persistence: 'cookie' }))

let referrer = '' // No referrer by default
Object.defineProperty(document, 'referrer', { get: () => referrer })

describe('persistence', () => {
    afterEach(() => {
        given.lib.clear()
        document.cookie = ''
        referrer = ''
    })

    describe.each([`cookie`, `localStorage`, `localStorage+cookie`])('persistence modes: %p', (persistenceMode) => {
        // Common tests for all storage modes
        beforeEach(() => {
            given('lib', () => new PostHogPersistence({ name: 'test', persistence: persistenceMode }))
            given.lib.clear()
        })

        it('should register_once', () => {
            given.lib.register_once({ distinct_id: 'hi', test_prop: 'test_val' })

            let lib2 = new PostHogPersistence({ name: 'test', persistence: persistenceMode })
            expect(lib2.props).toEqual({ distinct_id: 'hi', test_prop: 'test_val' })
        })

        it('should save user state', () => {
            let lib = new PostHogPersistence({ name: 'bla', persistence: 'cookie' })
            lib.set_user_state('identified')
            expect(lib.props[USER_STATE]).toEqual('identified')
        })

        it('can load user state', () => {
            let lib = new PostHogPersistence({ name: 'bla', persistence: 'cookie' })
            lib.set_user_state('identified')
            expect(lib.get_user_state()).toEqual('identified')
        })

        it('has user state as a reserved property key', () => {
            let lib = new PostHogPersistence({ name: 'bla', persistence: 'cookie' })
            lib.register({ distinct_id: 'testy', test_prop: 'test_value' })
            lib.set_user_state('identified')
            expect(lib.properties()).toEqual({ distinct_id: 'testy', test_prop: 'test_value' })
        })

        it(`should only call save if props changes`, () => {
            let lib = new PostHogPersistence({ name: 'test', persistence: 'localStorage+cookie' })
            lib.register({ distinct_id: 'hi', test_prop: 'test_val' })
            lib.save = jest.fn()

            lib.register({ distinct_id: 'hi', test_prop: 'test_val' })
            lib.register({})
            lib.register({ distinct_id: 'hi' })
            expect(lib.save).toHaveBeenCalledTimes(0)

            lib.register({ distinct_id: 'hi2' })
            expect(lib.save).toHaveBeenCalledTimes(1)
            lib.save.mockClear()

            lib.register({ new_key: '1234' })
            expect(lib.save).toHaveBeenCalledTimes(1)
            lib.save.mockClear()
        })

        it('should set direct referrer', () => {
            referrer = ''
            given.lib.update_referrer_info()

            expect(given.lib.props['$referring_domain']).toBe('$direct')
            expect(given.lib.props['$referrer']).toBe('$direct')
        })

        it('should set external referrer', () => {
            referrer = 'https://www.google.com'
            given.lib.update_referrer_info()

            expect(given.lib.props['$referring_domain']).toBe('www.google.com')
            expect(given.lib.props['$referrer']).toBe('https://www.google.com')
        })

        it('should set internal referrer', () => {
            referrer = 'https://hedgebox.net/files/abc.png'
            given.lib.update_referrer_info()

            expect(given.lib.props['$referring_domain']).toBe('hedgebox.net')
            expect(given.lib.props['$referrer']).toBe('https://hedgebox.net/files/abc.png')
        })

        it('extracts enabled feature flags', () => {
            given.lib.register({ $enabled_feature_flags: { flag: 'variant', other: true } })
            expect(given.lib.props['$enabled_feature_flags']).toEqual({ flag: 'variant', other: true })
            expect(given.lib.properties()).toEqual({
                '$feature/flag': 'variant',
                '$feature/other': true,
            })
        })
    })

    describe('localStorage+cookie', () => {
        it('should migrate data from cookies to localStorage', () => {
            let lib = new PostHogPersistence({ name: 'bla', persistence: 'cookie' })
            lib.register_once({ distinct_id: 'testy', test_prop: 'test_value' })
            expect(document.cookie).toContain(
                'ph__posthog=%7B%22distinct_id%22%3A%22testy%22%2C%22test_prop%22%3A%22test_value%22%7D'
            )
            let lib2 = new PostHogPersistence({ name: 'bla', persistence: 'localStorage+cookie' })
            expect(document.cookie).toContain('ph__posthog=%7B%22distinct_id%22%3A%22testy%22%7D')
            lib2.register({ test_prop2: 'test_val', distinct_id: 'test2' })
            expect(document.cookie).toContain('ph__posthog=%7B%22distinct_id%22%3A%22test2%22%7D')
            expect(lib2.props).toEqual({ distinct_id: 'test2', test_prop: 'test_value', test_prop2: 'test_val' })
            lib2.remove('ph__posthog')
            expect(localStorage.getItem('ph__posthog')).toEqual(null)
            expect(document.cookie).toEqual('')
        })

        it(`should additionally store certain values in cookies if localStorage+cookie`, () => {
            expect(document.cookie).toEqual('')

            const encode = (props) => encodeURIComponent(JSON.stringify(props))

            let lib = new PostHogPersistence({ name: 'test', persistence: 'localStorage+cookie' })
            lib.register({ distinct_id: 'test', test_prop: 'test_val' })
            expect(document.cookie).toContain(
                `ph__posthog=${encode({
                    distinct_id: 'test',
                })}`
            )

            lib.register({ otherProp: 'prop' })
            expect(document.cookie).toContain(
                `ph__posthog=${encode({
                    distinct_id: 'test',
                })}`
            )

            lib.register({ [SESSION_ID]: [1000, 'sid', 2000] })
            expect(document.cookie).toContain(
                `ph__posthog=${encode({
                    distinct_id: 'test',
                    $sesid: [1000, 'sid', 2000],
                })}`
            )

            // Clear localstorage to simulate being on a different domain
            localStorage.clear()

            const newLib = new PostHogPersistence({ name: 'test', persistence: 'localStorage+cookie' })

            expect(newLib.props).toEqual({
                distinct_id: 'test',
                $sesid: [1000, 'sid', 2000],
            })
        })
    })
})
