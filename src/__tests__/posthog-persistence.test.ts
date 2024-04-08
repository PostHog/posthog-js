/// <reference lib="dom" />
import { PostHogPersistence } from '../posthog-persistence'
import { SESSION_ID, USER_STATE } from '../constants'
import { PostHogConfig } from '../types'
import Mock = jest.Mock

let referrer = '' // No referrer by default
Object.defineProperty(document, 'referrer', { get: () => referrer })

function makePostHogConfig(name: string, persistenceMode: string): PostHogConfig {
    return <PostHogConfig>{
        name,
        persistence: persistenceMode as 'cookie' | 'localStorage' | 'localStorage+cookie' | 'memory' | 'sessionStorage',
    }
}

describe('persistence', () => {
    let library: PostHogPersistence

    afterEach(() => {
        library?.clear()
        document.cookie = ''
        referrer = ''
    })

    const persistenceModes: string[] = ['cookie', 'localStorage', 'localStorage+cookie']
    describe.each(persistenceModes)('persistence modes: %p', (persistenceMode) => {
        // Common tests for all storage modes
        beforeEach(() => {
            library = new PostHogPersistence(makePostHogConfig('test', persistenceMode))
            library.clear()
        })

        it('should register_once', () => {
            library.register_once({ distinct_id: 'hi', test_prop: 'test_val' }, undefined, undefined)

            const lib2 = new PostHogPersistence(makePostHogConfig('test', persistenceMode))
            expect(lib2.props).toEqual({ distinct_id: 'hi', test_prop: 'test_val' })
        })

        it('should save user state', () => {
            const lib = new PostHogPersistence(makePostHogConfig('bla', persistenceMode))
            lib.set_property(USER_STATE, 'identified')
            expect(lib.props[USER_STATE]).toEqual('identified')
        })

        it('can load user state', () => {
            const lib = new PostHogPersistence(makePostHogConfig('bla', persistenceMode))
            lib.set_property(USER_STATE, 'identified')
            expect(lib.get_property(USER_STATE)).toEqual('identified')
        })

        it('has user state as a reserved property key', () => {
            const lib = new PostHogPersistence(makePostHogConfig('bla', persistenceMode))
            lib.register({ distinct_id: 'testy', test_prop: 'test_value' })
            lib.set_property(USER_STATE, 'identified')
            expect(lib.properties()).toEqual({ distinct_id: 'testy', test_prop: 'test_value' })
        })

        it(`should only call save if props changes`, () => {
            const lib = new PostHogPersistence(makePostHogConfig('test', 'localStorage+cookie'))
            lib.register({ distinct_id: 'hi', test_prop: 'test_val' })
            const saveMock: Mock = jest.fn()
            lib.save = saveMock

            lib.register({ distinct_id: 'hi', test_prop: 'test_val' })
            lib.register({})
            lib.register({ distinct_id: 'hi' })
            expect(lib.save).toHaveBeenCalledTimes(0)

            lib.register({ distinct_id: 'hi2' })
            expect(lib.save).toHaveBeenCalledTimes(1)
            saveMock.mockClear()

            lib.register({ new_key: '1234' })
            expect(lib.save).toHaveBeenCalledTimes(1)
            saveMock.mockClear()
        })

        it('should set direct referrer', () => {
            referrer = ''
            library.update_referrer_info()

            expect(library.props['$referring_domain']).toBe('$direct')
            expect(library.props['$referrer']).toBe('$direct')
        })

        it('should set external referrer', () => {
            referrer = 'https://www.google.com'
            library.update_referrer_info()

            expect(library.props['$referring_domain']).toBe('www.google.com')
            expect(library.props['$referrer']).toBe('https://www.google.com')
        })

        it('should set internal referrer', () => {
            referrer = 'https://hedgebox.net/files/abc.png'
            library.update_referrer_info()

            expect(library.props['$referring_domain']).toBe('hedgebox.net')
            expect(library.props['$referrer']).toBe('https://hedgebox.net/files/abc.png')
        })

        it('extracts enabled feature flags', () => {
            library.register({ $enabled_feature_flags: { flag: 'variant', other: true } })
            expect(library.props['$enabled_feature_flags']).toEqual({ flag: 'variant', other: true })
            expect(library.properties()).toEqual({
                '$feature/flag': 'variant',
                '$feature/other': true,
            })
        })
    })

    describe('localStorage+cookie', () => {
        const encode = (props: any) => encodeURIComponent(JSON.stringify(props))

        it('should migrate data from cookies to localStorage', () => {
            const lib = new PostHogPersistence(makePostHogConfig('bla', 'cookie'))
            lib.register_once({ distinct_id: 'testy', test_prop: 'test_value' }, undefined, undefined)
            expect(document.cookie).toEqual(
                'ph__posthog=%7B%22distinct_id%22%3A%22testy%22%2C%22test_prop%22%3A%22test_value%22%7D'
            )
            const lib2 = new PostHogPersistence(makePostHogConfig('bla', 'localStorage+cookie'))
            expect(document.cookie).toEqual('ph__posthog=%7B%22distinct_id%22%3A%22testy%22%7D')
            lib2.register({ test_prop2: 'test_val', distinct_id: 'test2' })
            expect(document.cookie).toEqual('ph__posthog=%7B%22distinct_id%22%3A%22test2%22%7D')
            expect(lib2.props).toEqual({ distinct_id: 'test2', test_prop: 'test_value', test_prop2: 'test_val' })
            lib2.remove()
            expect(localStorage.getItem('ph__posthog')).toEqual(null)
            expect(document.cookie).toEqual('')
        })

        it(`should additionally store certain values in cookies if localStorage+cookie`, () => {
            expect(document.cookie).toEqual('')

            const lib = new PostHogPersistence(makePostHogConfig('test', 'localStorage+cookie'))
            lib.register({ distinct_id: 'test', test_prop: 'test_val' })
            expect(document.cookie).toContain(
                `ph__posthog=${encode({
                    distinct_id: 'test',
                })}`
            )
            expect(document.cookie).not.toContain('test_prop')

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

            const newLib = new PostHogPersistence(makePostHogConfig('test', 'localStorage+cookie'))

            expect(newLib.props).toEqual({
                distinct_id: 'test',
                $sesid: [1000, 'sid', 2000],
            })
        })

        it('should allow swapping between storage methods', () => {
            const expectedProps = () => ({ distinct_id: 'test', test_prop: 'test_val', $is_identified: false })
            let config = makePostHogConfig('test', 'localStorage+cookie')
            const lib = new PostHogPersistence(makePostHogConfig('test', 'localStorage+cookie'))
            lib.register(expectedProps())
            expect(lib.properties()).toEqual(expectedProps())
            expect(document.cookie).toContain(
                `ph__posthog=${encode({
                    distinct_id: 'test',
                })}`
            )
            expect(document.cookie).not.toContain('test_prop')
            expect(localStorage.getItem('ph__posthog')).toEqual(JSON.stringify(expectedProps()))

            // Swap to memory
            let newConfig = makePostHogConfig('test', 'memory')
            lib.update_config(newConfig, config)
            config = newConfig

            // Check stores were cleared but properties are the same
            expect(document.cookie).toEqual('')
            expect(localStorage.getItem('ph__posthog')).toEqual(null)
            expect(lib.properties()).toEqual(expectedProps())

            // Swap to localStorage
            newConfig = makePostHogConfig('test', 'localStorage')
            lib.update_config(newConfig, config)
            config = newConfig

            // Check store contains data and props are the same
            expect(document.cookie).toEqual('')
            expect(localStorage.getItem('ph__posthog')).toEqual(JSON.stringify(expectedProps()))
            expect(lib.properties()).toEqual(expectedProps())
        })
    })
})
