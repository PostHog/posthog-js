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

        expect(store._parse(name)).toEqual({ distinct_id: 'abc' })
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
