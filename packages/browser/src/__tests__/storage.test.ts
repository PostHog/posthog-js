import { window } from '@posthog/browser-common/utils/globals'
import { SESSION_RECORDING_IS_SAMPLED } from '../constants'
import {
    resetSessionStorageSupported,
    seekFirstNonPublicSubDomain,
    resetSubDomainCache,
    sessionStore,
    createLocalPlusCookieStore,
    getCookiePersistedPropertiesMetadataName,
    cookieStore,
    resetLocalStorageSupported,
    resetCookieStorageSupported,
    memoryStore,
} from '../storage'

describe('sessionStore', () => {
    describe('seekFirstNonPublicSubDomain', () => {
        beforeEach(() => {
            resetSubDomainCache()
        })
        const mockDocumentDotCookie = {
            value_: '',

            get cookie() {
                return this.value_
            },

            set cookie(value) {
                //needs to refuse known public suffixes, like a browser would
                // value arrives like dmn_chk_1699961248575=1;domain=.uk
                const domain = value.split('domain=')[1].split(';')[0]
                if (['.uk', '.com', '.au', '.com.au', '.co.uk'].includes(domain)) return
                this.value_ += value + ';'
            },
        }
        test.each([
            {
                candidate: 'www.google.co.uk',
                expected: 'google.co.uk',
            },
            {
                candidate: 'www.google.com',
                expected: 'google.com',
            },
            {
                candidate: 'www.google.com.au',
                expected: 'google.com.au',
            },
            {
                candidate: 'localhost',
                expected: '',
            },
        ])(`%s subdomain check`, ({ candidate, expected }) => {
            expect(seekFirstNonPublicSubDomain(candidate, mockDocumentDotCookie as unknown as Document)).toEqual(
                expected
            )
        })
    })

    it('stores objects as strings', () => {
        sessionStore._set('foo', { bar: 'baz' })
        expect(sessionStore._get('foo')).toEqual('{"bar":"baz"}')
    })
    it('stores and retrieves an object untouched', () => {
        const obj = { bar: 'baz' }
        sessionStore._set('foo', obj)
        expect(sessionStore._parse('foo')).toEqual(obj)
    })
    it('stores and retrieves a string untouched', () => {
        const str = 'hey hey'
        sessionStore._set('foo', str)
        expect(sessionStore._parse('foo')).toEqual(str)
    })
    it('returns null if the key does not exist', () => {
        expect(sessionStore._parse('baz')).toEqual(null)
    })
    it('remove deletes an item from storage', () => {
        const str = 'hey hey'
        sessionStore._set('foo', str)
        expect(sessionStore._parse('foo')).toEqual(str)
        sessionStore._remove('foo')
        expect(sessionStore._parse('foo')).toEqual(null)
    })

    describe('sessionStore._is_supported', () => {
        beforeEach(() => {
            // Reset the sessionStorageSupported before each test. Otherwise, we'd just be testing the cached value.
            resetSessionStorageSupported()
        })
        it('returns false if sessionStorage is undefined', () => {
            const sessionStorage = (window as any).sessionStorage
            delete (window as any).sessionStorage
            expect(sessionStore._is_supported()).toEqual(false)
            ;(window as any).sessionStorage = sessionStorage
        })
        it('returns true by default', () => {
            expect(sessionStore._is_supported()).toEqual(true)
        })
    })
})

describe('createLocalPlusCookieStore', () => {
    beforeEach(() => {
        resetLocalStorageSupported()
        window?.localStorage.clear()
    })

    it.each(['"string"', '123', 'true', '[]'])(
        'ignores non-object cookie roots without throwing: %s',
        (cookieValue) => {
            const name = 'ph_x_posthog'
            window?.localStorage.setItem(name, JSON.stringify({ distinct_id: 'local-id' }))
            document.cookie = `${name}=${encodeURIComponent(cookieValue)}; path=/`
            const store = createLocalPlusCookieStore([], true)

            expect(() => store._parse(name)).not.toThrow()
            expect(store._parse(name)).toEqual({ distinct_id: 'local-id' })
        }
    )

    it('does not merge unsafe cookie property names', () => {
        const name = 'ph_x_posthog'
        window?.localStorage.setItem(name, JSON.stringify({ distinct_id: 'local-id' }))
        document.cookie = `${name}=${encodeURIComponent('{"__proto__":{"polluted":true},"distinct_id":"cookie-id"}')}; path=/`
        const store = createLocalPlusCookieStore([], true)

        const value = store._parse(name)!

        expect(value.distinct_id).toBe('cookie-id')
        expect(value).not.toHaveProperty('polluted')
        expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
    })

    it('marks built-in-only snapshots as written by the current SDK', () => {
        const name = 'ph_current_builtin_posthog'
        const store = createLocalPlusCookieStore([], true)

        store._set(name, { distinct_id: 'abc' })

        expect(cookieStore._parse(getCookiePersistedPropertiesMetadataName(name))).toEqual({
            p: [],
            f: expect.any(String),
        })
    })

    it('preserves a falsy built-in omitted by a legacy cookie writer', () => {
        const name = 'ph_legacy_falsy_posthog'
        const store = createLocalPlusCookieStore([], true)
        window?.localStorage.setItem(
            name,
            JSON.stringify({ distinct_id: 'abc', [SESSION_RECORDING_IS_SAMPLED]: false })
        )
        cookieStore._set(name, { distinct_id: 'abc' })

        expect(store._parse(name)).toEqual({
            distinct_id: 'abc',
            $user_state: 'anonymous',
            [SESSION_RECORDING_IS_SAMPLED]: false,
        })
    })

    it('removes a falsy built-in omitted by a current authoritative snapshot', () => {
        const name = 'ph_current_falsy_posthog'
        const store = createLocalPlusCookieStore([], true)
        store._set(name, { distinct_id: 'abc' })
        window?.localStorage.setItem(
            name,
            JSON.stringify({ distinct_id: 'abc', [SESSION_RECORDING_IS_SAMPLED]: false })
        )

        expect(store._parse(name)).toEqual({ distinct_id: 'abc', $user_state: 'anonymous' })
    })

    it('stores custom-key metadata outside the event-visible persistence cookie', () => {
        const name = 'ph_x_posthog'
        const store = createLocalPlusCookieStore(['custom_property'], true)

        store._set(name, { distinct_id: 'abc', custom_property: 'custom' })

        expect(cookieStore._parse(name)).toEqual({ distinct_id: 'abc', custom_property: 'custom' })
        expect(cookieStore._parse(name)).not.toHaveProperty('$cookie_persisted_properties')
        expect(cookieStore._parse(getCookiePersistedPropertiesMetadataName(name))).toEqual({
            p: ['custom_property'],
            f: expect.any(String),
        })
    })

    it('publishes built-in identity when custom-key metadata cannot be persisted', () => {
        const name = 'ph_x_posthog'
        cookieStore._set(name, { distinct_id: 'anonymous' })
        const store = createLocalPlusCookieStore(['custom_property'], true)
        const cookieSet = cookieStore._set
        const setSpy = jest
            .spyOn(cookieStore, '_set')
            .mockImplementation((cookieName, ...args) =>
                cookieName === getCookiePersistedPropertiesMetadataName(name) ? false : cookieSet(cookieName, ...args)
            )

        store._set(name, { distinct_id: 'identified-user', custom_property: 'custom' })

        expect(cookieStore._parse(name)).toEqual({ distinct_id: 'identified-user' })
        setSpy.mockRestore()
    })

    it('reports the localStorage write succeeded even when the cookie mirror throws', () => {
        const store = createLocalPlusCookieStore()
        // distinct_id is a cookie-persisted property, so the cookie path runs
        const cookieSpy = jest.spyOn(cookieStore, '_set').mockImplementation(() => {
            throw new Error('cookie write blew up')
        })

        const result = store._set('ph_x_posthog', { distinct_id: 'abc' }, undefined, undefined, undefined, false)

        expect(result).toBe(true)
        expect(JSON.parse(window?.localStorage.getItem('ph_x_posthog') as string)).toEqual({ distinct_id: 'abc' })
        cookieSpy.mockRestore()
    })
})

describe('cookieStore._is_supported', () => {
    beforeEach(() => {
        resetCookieStorageSupported()
    })

    afterEach(() => {
        jest.restoreAllMocks()
        resetCookieStorageSupported()
    })

    it('returns true when a probe cookie round-trips', () => {
        expect(cookieStore._is_supported()).toEqual(true)
    })

    it('returns false when reading document.cookie throws, as it does inside a data: URL', () => {
        // Chrome disables cookies in a `data:` URL and throws SecurityError on access.
        // Before this check existed, _is_supported was `() => !!document`, which is true
        // here, so persistence selected a cookie store that could never store anything.
        jest.spyOn(document, 'cookie', 'get').mockImplementation(() => {
            throw new Error('SecurityError: Storage is disabled inside data: URLs')
        })

        expect(cookieStore._is_supported()).toEqual(false)
    })

    it('returns false when cookie writes are silently dropped', () => {
        jest.spyOn(document, 'cookie', 'get').mockReturnValue('')

        expect(cookieStore._is_supported()).toEqual(false)
    })

    it('does not overwrite an existing cookie with the former fixed probe name', () => {
        cookieStore._set('__ph_cookie_support__', 'existing-value')

        expect(cookieStore._is_supported()).toEqual(true)
        expect(cookieStore._get('__ph_cookie_support__')).toEqual('"existing-value"')

        cookieStore._remove('__ph_cookie_support__')
    })

    it('caches the result so the probe cookie is only written once', () => {
        const getter = jest.spyOn(document, 'cookie', 'get')
        cookieStore._is_supported()
        const callsAfterFirst = getter.mock.calls.length
        cookieStore._is_supported()

        expect(getter.mock.calls.length).toEqual(callsAfterFirst)
    })
})

describe('memoryStore', () => {
    it.each([0, '0', false, ''])('round-trips the falsy value %p instead of reporting it absent', (value) => {
        memoryStore._set('falsy_probe', value)

        expect(memoryStore._get('falsy_probe')).toEqual(value)
        expect(memoryStore._parse('falsy_probe')).toEqual(value)

        memoryStore._remove('falsy_probe')
    })

    it('still reports a genuinely absent key as null', () => {
        expect(memoryStore._get('never_set')).toEqual(null)
    })

    // Consent stores `0` to mean "opted out". Reading that back as null made it
    // indistinguishable from "no decision recorded", silently re-enabling capture.
    it('distinguishes a stored 0 from an unset key', () => {
        memoryStore._set('opt_out', 0)

        expect(memoryStore._get('opt_out')).not.toEqual(memoryStore._get('unset_key'))

        memoryStore._remove('opt_out')
    })
})
