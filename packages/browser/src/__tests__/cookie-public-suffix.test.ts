// @vitest-environment-options {"url": "https://example.github.io/"}
/// <reference lib="dom" />
import { PostHogPersistence } from '../posthog-persistence'
import { PostHogConfig } from '../types'
import { cookieStore, resetSubDomainCache } from '../storage'

describe.each(['cookie', 'localStorage+cookie'])(
    'cookie persistence on a public suffix host: %s',
    (persistenceMode) => {
        const name = 'public-suffix'
        const cookieName = `ph_${name}_posthog`
        const config = {
            name,
            token: name,
            persistence: persistenceMode,
            cross_subdomain_cookie: false,
            secure_cookie: false,
        } as PostHogConfig

        let cookieWrites: string[]

        beforeEach(() => {
            resetSubDomainCache()
            window.localStorage.clear()
            // domain discovery only runs when the origin already has a cookie
            document.cookie = 'origin_cookie=1; path=/'

            cookieWrites = []
            const cookieSetter = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')?.set
            vi.spyOn(document, 'cookie', 'set').mockImplementation((value) => {
                cookieWrites.push(value)
                cookieSetter?.call(document, value)
            })
        })

        afterEach(() => {
            vi.restoreAllMocks()
            cookieStore._remove(cookieName, false)
            document.cookie = 'origin_cookie=; max-age=0; path=/'
            window.localStorage.clear()
            resetSubDomainCache()
        })

        it('does not write dmn_chk_ probe cookies across page loads with cross_subdomain_cookie false', () => {
            const firstPage = new PostHogPersistence(config)
            firstPage.register({ distinct_id: 'user' })

            resetSubDomainCache()
            const secondPage = new PostHogPersistence(config)

            expect(secondPage.get_property('distinct_id')).toBe('user')
            expect(cookieWrites.filter((value) => value.startsWith('dmn_chk_'))).toEqual([])
        })
    }
)
