import { PostHogPersistence } from '../posthog-persistence'

given('lib', () => new PostHogPersistence({ name: 'bla', persistence: 'cookie' }))

function forPersistenceTypes(runTests) {
    ;[`cookie`, `localStorage`, `localStorage+cookie`].forEach(function (persistenceType) {
        describe(persistenceType, runTests.bind(null, persistenceType))
    })
}

let referrer = '' // No referrer by default
Object.defineProperty(document, 'referrer', { get: () => referrer })

describe('persistence', () => {
    afterEach(() => {
        given.lib.clear()
        referrer = ''
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

    it('should migrate data from cookies to localStorage', () => {
        let lib = new PostHogPersistence({ name: 'bla', persistence: 'cookie' })
        lib.register_once({ distinct_id: 'testy', test_prop: 'test_value' })
        expect(document.cookie).toEqual(
            'ph__posthog=%7B%22distinct_id%22%3A%22testy%22%2C%22test_prop%22%3A%22test_value%22%7D'
        )
        let lib2 = new PostHogPersistence({ name: 'bla', persistence: 'localStorage+cookie' })
        expect(document.cookie).toEqual('ph__posthog=%7B%22distinct_id%22%3A%22testy%22%7D')
        lib2.register({ test_prop2: 'test_val', distinct_id: 'test2' })
        expect(document.cookie).toEqual('ph__posthog=%7B%22distinct_id%22%3A%22test2%22%7D')
        expect(lib2.props).toEqual({ distinct_id: 'test2', test_prop: 'test_value', test_prop2: 'test_val' })
        lib2.remove('ph__posthog')
        expect(localStorage.getItem('ph__posthog')).toEqual(null)
        expect(document.cookie).toEqual('')
    })

    it('should save user state', () => {
        let lib = new PostHogPersistence({ name: 'bla', persistence: 'cookie' })
        lib.set_user_state('identified')
        expect(document.cookie).toEqual('ph__posthog=%7B%22%24user_state%22%3A%22identified%22%7D')
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

    it(`should register once LS`, () => {
        let lib = new PostHogPersistence({ name: 'test', persistence: 'localStorage+cookie' })
        lib.register_once({ distinct_id: 'hi', test_prop: 'test_val' })

        let lib2 = new PostHogPersistence({ name: 'test', persistence: 'localStorage+cookie' })
        expect(lib2.props).toEqual({ distinct_id: 'hi', test_prop: 'test_val' })
        lib.clear()
        lib2.clear()
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

    forPersistenceTypes(function (persistenceType) {
        it(`should register once`, () => {
            let lib = new PostHogPersistence({ name: 'test', persistence: persistenceType })
            lib.register_once({ distinct_id: 'hi', test_prop: 'test_val' })

            let lib2 = new PostHogPersistence({ name: 'test', persistence: persistenceType })
            expect(lib2.props).toEqual({ distinct_id: 'hi', test_prop: 'test_val' })
            lib.clear()
            lib2.clear()
        })
        // Need to add more tests here
    })
})
