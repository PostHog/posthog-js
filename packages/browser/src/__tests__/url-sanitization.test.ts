import { createPosthogInstance } from './helpers/posthog-instance'
import { PostHog } from '../posthog-core'
import {
    getEventProperties,
    getPersonInfo,
    getPersonPropsFromInfo,
    getReferrerInfo,
    getSearchInfo,
} from '@posthog/browser-common/utils/event-utils'
import { autocapturePropertiesForElement } from '@posthog/browser-common/autocapture'
import { getRecordedUrl, getUrlSanitizer } from '../utils/url-sanitization'
import * as globals from '@posthog/browser-common/utils/globals'
import type { CaptureResult, PostHogConfig, UrlSanitizationOptions } from '../types'

const current = 'http://localhost/private-preview?token=current-secret&utm_source=allowed#private'
const referrer = 'https://www.google.com/private-referrer?q=search-secret&token=referrer-secret'

describe('url_sanitization', () => {
    let instances: PostHog[] = []
    beforeEach(() => {
        localStorage.clear()
        sessionStorage.clear()
        vi.spyOn(globals, 'location', 'get').mockReturnValue(new URL(current) as unknown as Location)
        vi.spyOn(document, 'URL', 'get').mockReturnValue(current)
        vi.spyOn(document, 'referrer', 'get').mockReturnValue(referrer)
    })
    afterEach(async () => {
        for (const instance of instances) await instance.shutdown()
        instances = []
        vi.restoreAllMocks()
    })

    const create = async (config: Partial<PostHogConfig> = {}) => {
        const instance = await createPosthogInstance(undefined, {
            persistence: 'localStorage',
            capture_pageview: false,
            autocapture: false,
            person_profiles: 'always',
            disable_session_recording: true,
            advanced_disable_flags: true,
            ...config,
        })
        instances.push(instance)
        return instance
    }

    it.each(['localStorage', 'localStorage+cookie', 'cookie', 'sessionStorage'] as const)(
        'preserves campaign attribution while sanitizing stored landing URLs with %s',
        async (persistence) => {
            const beforeSend = vi.fn((_event: CaptureResult) => null)
            const posthog = await create({
                persistence,
                cross_subdomain_cookie: false,
                bootstrap: { distinctID: 'synthetic-attribution-id' },
                url_sanitization: { path: false, query: false, hash: false },
                before_send: beforeSend,
            })
            posthog.capture('probe')
            const initial = posthog.persistence.props.$initial_person_info
            const session = posthog.persistence.props.$client_session_props.props
            expect(initial.u).toBe('http://localhost/')
            expect(session.u).toBe('http://localhost/')
            expect(initial.c).toEqual({ utm_source: 'allowed' })
            expect(session.c).toEqual(initial.c)
            const event = beforeSend.mock.calls.find(([event]) => event?.event === 'probe')![0]
            expect(event.properties.$session_entry_url).toBe('http://localhost/')
            expect(event.properties.$session_entry_utm_source).toBe('allowed')
            const setOnce = beforeSend.mock.calls.map(([event]) => event.$set_once).find(Boolean)!
            expect(setOnce.$initial_current_url).toBe('http://localhost/')
            expect(setOnce.$current_url).toBe('http://localhost/')
            expect(setOnce.$initial_utm_source).toBe('allowed')
            expect(setOnce.utm_source).toBe('allowed')
            expect(setOnce.$initial_utm_medium).toBeNull()
            expect(setOnce.utm_medium).toBeNull()
            expect(JSON.stringify({ initial, session, events: beforeSend.mock.calls })).not.toMatch(
                /current-secret|private-preview|#private/
            )
        }
    )

    it('keeps extracted campaign values when both URL callbacks omit their URLs', async () => {
        const posthog = await create({
            url_sanitization: {
                sanitize: () => {
                    throw new Error('failure')
                },
            },
        })
        posthog.capture('probe')
        const stored = JSON.parse(JSON.stringify(posthog.persistence.props.$client_session_props))
        posthog.persistence.props.$client_session_props = stored
        expect(stored.props).toEqual({ c: { utm_source: 'allowed' } })
        expect(posthog.sessionPropsManager.getSessionProps().$session_entry_utm_source).toBe('allowed')
        expect(posthog.sessionPropsManager.getSessionProps().$session_entry_url).toBeUndefined()
        expect(posthog.persistence.get_initial_props().$initial_utm_source).toBe('allowed')
    })

    it('extracts campaign values before URL rewriting and preserves personal-data masking', async () => {
        const input = current.replace('utm_source=allowed', 'utm_source=original&gclid=personal-id')
        vi.spyOn(globals, 'location', 'get').mockReturnValue(new URL(input) as unknown as Location)
        const posthog = await create({
            mask_personal_data_properties: true,
            url_sanitization: {
                sanitize: (url) => {
                    url.searchParams.set('utm_source', 'rewritten')
                    return url
                },
            },
        })
        posthog.capture('probe')
        expect(posthog.persistence.props.$initial_person_info.c).toEqual({ utm_source: 'original' })
        expect(posthog.persistence.get_initial_props().$initial_gclid).toBe('<masked>')
        expect(posthog.persistence.get_initial_props().$initial_utm_source).toBe('original')
        expect(posthog.sessionPropsManager.getSessionProps().$session_entry_utm_source).toBe('original')
    })

    it('masks campaign values before retaining them separately from a filtered URL', async () => {
        const posthog = await create({
            mask_personal_data_properties: true,
            custom_personal_data_properties: ['utm_source'],
            url_sanitization: { path: false, query: false, hash: false },
        })
        posthog.capture('probe')
        expect(posthog.persistence.props.$initial_person_info.c).toEqual({ utm_source: '<masked>' })
        expect(posthog.persistence.props.$client_session_props.props.c).toEqual({ utm_source: '<masked>' })
        expect(JSON.stringify(posthog.persistence.props)).not.toMatch(/allowed|current-secret|referrer-secret/)
    })

    it('uses null overrides for campaigns introduced by URL rewriting', async () => {
        vi.spyOn(globals, 'location', 'get').mockReturnValue(new URL('http://localhost/private') as unknown as Location)
        const posthog = await create({
            url_sanitization: {
                sanitize: (url) => {
                    url.searchParams.set('utm_source', 'rewritten')
                    return url
                },
            },
        })
        posthog.capture('probe')
        expect(posthog.persistence.props.$initial_person_info.c).toEqual({ utm_source: null })
        expect(posthog.persistence.get_initial_props().$initial_utm_source).toBeNull()
        expect(posthog.sessionPropsManager.getSessionProps().$session_entry_utm_source).toBeUndefined()
    })

    it('does not duplicate campaign values retained in the sanitized URL', async () => {
        const posthog = await create({
            url_sanitization: { sanitize: (url) => url },
        })
        posthog.capture('probe')
        expect(posthog.persistence.props.$initial_person_info.c).toBeUndefined()
        expect(posthog.persistence.props.$client_session_props.props.c).toBeUndefined()
        expect(posthog.persistence.get_initial_props().$initial_utm_source).toBe('allowed')
    })

    it('keeps long campaign attribution within the encoded cookie budget', async () => {
        const source = '🙂'.repeat(60)
        const landing = new URL('http://localhost/private')
        landing.searchParams.set('utm_source', source)
        vi.spyOn(globals, 'location', 'get').mockReturnValue(landing as unknown as Location)
        const posthog = await create({
            persistence: 'localStorage+cookie',
            persistence_name: 'campaign-cookie-size',
            cross_subdomain_cookie: false,
            url_sanitization: { path: false, query: false },
        })
        posthog.capture('probe')
        posthog.persistence.save()
        expect(posthog.persistence.get_initial_props().$initial_utm_source).toBe(source)
        const cookie = document.cookie.split('; ').find((cookie) => cookie.startsWith('ph_campaign-cookie-size='))!
        expect(cookie.length).toBeLessThan(4096 * 0.9)
    })

    it.each(['cookie', 'localStorage+cookie'] as const)(
        'bounds encoded campaign overrides together with other cookie state in %s',
        async (persistence) => {
            const landing = new URL('http://localhost/')
            landing.searchParams.set('utm_source', '\\'.repeat(800))
            vi.spyOn(globals, 'location', 'get').mockReturnValue(landing as unknown as Location)
            vi.spyOn(document, 'referrer', 'get').mockReturnValue('')
            const original = getPersonPropsFromInfo(getPersonInfo()).utm_source
            const posthog = await create({
                persistence,
                persistence_name: 'bounded-campaign-' + persistence,
                cross_subdomain_cookie: false,
                persistence_save_debounce_ms: 0,
                cookie_persisted_properties: ['budget_padding'],
                url_sanitization: { query: false },
            })
            if (persistence === 'localStorage+cookie') {
                posthog.register({ budget_padding: 'p'.repeat(2400) })
            }
            posthog.capture('probe')
            const cookie = document.cookie
                .split('; ')
                .find((value) => value.startsWith('ph_bounded-campaign-' + persistence + '='))!
            expect(cookie.length).toBeLessThan(4096)
            const stored = JSON.parse(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)))
            const initial = stored.$initial_person_info
            expect(initial.c.utm_source.length).toBeGreaterThan(0)
            expect(initial.c.utm_source.length).toBeLessThan(original.length)
            expect(original.startsWith(initial.c.utm_source)).toBe(true)
            expect(initial.u).toBe('http://localhost/')
            expect(stored.distinct_id).toBe(posthog.get_distinct_id())
            expect(stored.$sesid[1]).toBe(posthog.get_session_id())
            if (persistence === 'cookie') {
                expect(stored.$client_session_props.props.c.utm_source).toBe(initial.c.utm_source)
            } else {
                expect(stored.budget_padding).toBe('p'.repeat(2400))
            }
        }
    )

    it.each(['localStorage', 'sessionStorage'] as const)(
        'retains campaign values without cookie bounds in %s',
        async (persistence) => {
            const landing = new URL('http://localhost/')
            landing.searchParams.set('utm_source', '\\'.repeat(800))
            vi.spyOn(globals, 'location', 'get').mockReturnValue(landing as unknown as Location)
            const original = getPersonPropsFromInfo(getPersonInfo()).utm_source
            const posthog = await create({
                persistence,
                bootstrap: { distinctID: 'synthetic-unbounded-campaign-id' },
                url_sanitization: { query: false },
            })
            posthog.capture('probe')
            expect(posthog.persistence.props.$initial_person_info.c.utm_source).toBe(original)
            expect(posthog.persistence.props.$client_session_props.props.c.utm_source).toBe(original)
        }
    )

    it('excludes split localStorage groups from the cookie campaign budget', async () => {
        const posthog = await create({
            persistence: 'localStorage+cookie',
            persistence_name: 'split-campaign-budget',
            split_storage: true,
            cookie_persisted_properties: ['$enabled_feature_flags'],
            url_sanitization: { query: false },
        })
        posthog.capture('probe')
        const flags = { 'large-variant': 'v'.repeat(6000) }
        posthog.persistence.register({ $enabled_feature_flags: flags })
        expect(posthog.persistence.get_initial_props().$initial_utm_source).toBe('allowed')
        expect(posthog.sessionPropsManager.getSessionProps().$session_entry_utm_source).toBe('allowed')
        expect(JSON.parse(localStorage.getItem('ph_split-campaign-budget__flags')!).$enabled_feature_flags).toEqual(
            flags
        )
        const cookie = document.cookie.split('; ').find((value) => value.startsWith('ph_split-campaign-budget='))!
        const stored = JSON.parse(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)))
        expect(stored.$initial_person_info.c.utm_source).toBe('allowed')
        expect(stored.$enabled_feature_flags).toBeUndefined()
    })

    it('preserves null overrides and Unicode boundaries when cookie campaigns are bounded', async () => {
        const landing = new URL('http://localhost/')
        landing.searchParams.set('utm_source', '🙂'.repeat(60))
        vi.spyOn(globals, 'location', 'get').mockReturnValue(landing as unknown as Location)
        vi.spyOn(document, 'referrer', 'get').mockReturnValue('')
        const posthog = await create({
            persistence: 'cookie',
            cross_subdomain_cookie: false,
            url_sanitization: {
                sanitize: (url) => {
                    url.searchParams.delete('utm_source')
                    url.searchParams.set('utm_medium', 'introduced')
                    return url
                },
            },
        })
        posthog.register({ budget_padding: 'p'.repeat(2000) })
        posthog.capture('probe')
        const initial = posthog.persistence.props.$initial_person_info.c
        const session = posthog.persistence.props.$client_session_props.props.c
        expect(initial.utm_medium).toBeNull()
        expect(session.utm_medium).toBeNull()
        expect(Array.from(initial.utm_source).length).toBeLessThan(60)
        expect(Array.from(initial.utm_source).every((character) => character === '🙂')).toBe(true)
        expect(session.utm_source).toBe(initial.utm_source)
        expect(posthog.persistence.get_initial_props().$initial_utm_medium).toBeNull()
        expect(posthog.sessionPropsManager.getSessionProps().$session_entry_utm_medium).toBeUndefined()
    })

    it('reads campaign values from older landing URL records', async () => {
        const posthog = await create({ url_sanitization: { query: false } })
        posthog.capture('probe')
        posthog.persistence.props.$initial_person_info = { r: referrer, u: current }
        posthog.persistence.props.$client_session_props.props = { r: referrer, u: current }
        expect(posthog.persistence.get_initial_props().$initial_utm_source).toBe('allowed')
        expect(posthog.sessionPropsManager.getSessionProps().$session_entry_utm_source).toBe('allowed')
        expect(posthog.persistence.get_initial_props().$initial_current_url).toBe(current)
    })

    it('sanitizes current URLs and persisted referrers even when before_send drops every event', async () => {
        const posthog = await create({ url_sanitization: { path: false, query: false, hash: false } })
        posthog.capture('probe')
        const props = posthog.calculateEventProperties('probe', {}, new Date())
        expect(props.$current_url).toBe('http://localhost/')
        expect(props.$pathname).toBe('/')
        expect(props.$host).toBe('localhost')
        expect(props.$referrer).toBe('https://www.google.com/')
        expect(props.$referring_domain).toBe('www.google.com')
        expect(posthog.persistence.props.$initial_person_info.r).toBe('https://www.google.com/')
        expect(posthog.persistence.props.$client_session_props.props.r).toBe('https://www.google.com/')
        expect(posthog.persistence.get_initial_props().$initial_referrer).toBe('https://www.google.com/')
        expect(props.$session_entry_referrer).toBe('https://www.google.com/')
        expect(posthog.get_distinct_id()).toBeTruthy()
    })

    it('sanitizes session referrers with both attribution saving flags disabled', async () => {
        const posthog = await create({
            save_campaign_params: false,
            save_referrer: false,
            url_sanitization: { query: false },
        })
        posthog.capture('probe')
        expect(posthog.persistence.props.$initial_person_info).toBeUndefined()
        expect(posthog.persistence.props.$client_session_props.props.r).toBe('https://www.google.com/private-referrer')
    })

    it('restores session properties when the referrer was omitted before serialization', async () => {
        const posthog = await create({
            url_sanitization: {
                sanitize: (url) => {
                    if (url.hostname === 'www.google.com') throw new Error('omit referrer')
                    return url
                },
            },
        })
        posthog.capture('probe')
        const saved = posthog.persistence.props.$client_session_props
        posthog.persistence.props.$client_session_props = JSON.parse(JSON.stringify(saved))
        expect(posthog.sessionPropsManager.getSessionProps().$session_entry_url).toBe(current)
    })

    it('retains anonymous identity and session continuity when persistence is reopened', async () => {
        const config = { url_sanitization: { query: false }, persistence_name: 'url-sanitization-reload' }
        const first = await create(config)
        first.capture('probe')
        const id = first.get_distinct_id()
        const sessionId = first.get_session_id()
        // Re-open the same browser persistence as a fresh document would.
        const second = await create(config)
        expect(second.get_distinct_id()).toBe(id)
        expect(second.get_session_id()).toBe(sessionId)
    })

    it('rewrites current URLs and referrers through the callback', async () => {
        const posthog = await create({
            url_sanitization: {
                hash: false,
                sanitize: (url) => {
                    url.pathname = '/public'
                    for (const key of Array.from(url.searchParams.keys())) {
                        if (key !== 'utm_source') url.searchParams.delete(key)
                    }
                    return url.href
                },
            },
        })
        posthog.capture('probe')
        const props = posthog.calculateEventProperties('probe', {}, new Date())
        expect(props.$current_url).toBe('http://localhost/public?utm_source=allowed')
        expect(props.$pathname).toBe('/public')
        expect(posthog.persistence.props.$initial_person_info.r).toBe('https://www.google.com/public')
        expect(props.$session_entry_referrer).toBe('https://www.google.com/public')
    })

    it('omits failed current URLs and referrers without throwing', async () => {
        const posthog = await create({
            url_sanitization: {
                sanitize: () => {
                    throw new Error('failure')
                },
            },
        })
        expect(() => posthog.capture('$pageview')).not.toThrow()
        const properties = posthog.calculateEventProperties('probe', {}, new Date())
        expect(properties.$current_url).toBeUndefined()
        expect(properties.$pathname).toBeUndefined()
        expect(properties.$referrer).toBeUndefined()
        expect(properties.$host).toBeUndefined()
        expect(properties.$referring_domain).toBeUndefined()
        expect(properties.$session_entry_referrer).toBeUndefined()
        expect(posthog.persistence.get_initial_props().$initial_referrer).toBeUndefined()
        expect(posthog.pageViewManager._currentPageview?.pathname).toBeUndefined()
    })

    it('does not rewrite previously persisted attribution or arbitrary caller properties', async () => {
        const posthog = await create()
        posthog.capture('probe')
        const initial = { ...posthog.persistence.props.$initial_person_info }
        posthog.set_config({ url_sanitization: { query: false } })
        posthog.capture('probe')
        expect(posthog.persistence.props.$initial_person_info).toEqual(initial)
        const props = posthog.calculateEventProperties(
            'probe',
            { custom_url: current, $current_url: current },
            new Date()
        )
        expect(props.custom_url).toBe(current)
        expect(props.$current_url).toBe(current)
    })

    it('masks configured personal-data query values in referrers', () => {
        const config = {
            url_sanitization: {},
            mask_personal_data_properties: true,
            custom_personal_data_properties: ['q', 'token'],
        }
        expect(getReferrerInfo(getUrlSanitizer(config)).$referrer).toBe(
            'https://www.google.com/private-referrer?q=<masked>&token=<masked>'
        )
    })

    it('honors explicit hash inclusion in current and persisted attribution URLs', async () => {
        const posthog = await create({ disable_capture_url_hashes: true, url_sanitization: { hash: true } })
        posthog.capture('probe')
        const props = posthog.calculateEventProperties('probe', {}, new Date())
        expect(props.$current_url).toBe(current)
        expect(posthog.persistence.props.$initial_person_info.u).toBe(current)
        expect(posthog.persistence.props.$client_session_props.props.u).toBe(current)
        expect(posthog.persistence.get_initial_props().$initial_current_url).toBe(current)
        expect(props.$session_entry_url).toBe(current)
    })

    it('removes private paths from previous-pageview metadata', async () => {
        const posthog = await create({ url_sanitization: { path: false } })
        posthog.capture('$pageview')
        const props = posthog.calculateEventProperties('$pageleave', {}, new Date())
        expect(props.$prev_pageview_pathname).toBe('/')
    })

    it.each([false, true])('preserves legacy current URL and raw referrer behavior with hash stripping=%s', (strip) => {
        expect(getEventProperties(false, undefined, undefined, strip).$current_url).toBe(
            strip ? current.split('#')[0] : current
        )
        expect(getPersonInfo(false, undefined, strip).r).toBe(referrer)
        expect(getReferrerInfo().$referrer).toBe(referrer)
        expect(getSearchInfo().ph_keyword).toBe('search-secret')
    })

    it('resolves recorded relative links against the document base', () => {
        const base = document.createElement('base')
        base.href = 'https://external.example/store/'
        document.head.appendChild(base)
        try {
            const element = document.createElement('a')
            element.setAttribute('href', 'checkout?token=secret')
            const { props } = autocapturePropertiesForElement(element, {
                e: new MouseEvent('click'),
                maskAllElementAttributes: false,
                maskAllText: false,
                elementsChainAsString: false,
                disableCaptureUrlHashes: false,
                sanitizeUrl: (url) => getRecordedUrl(url, { url_sanitization: { query: false } }),
            })
            expect(props.$elements[0].attr__href).toBe('https://external.example/store/checkout')
            expect(props.$external_click_url).toBe('https://external.example/store/checkout')
        } finally {
            base.remove()
        }
    })

    it.each([false, true])('sanitizes SVG xlink URLs; omit=%s', (omit) => {
        const element = document.createElementNS('http://www.w3.org/2000/svg', 'a')
        element.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', 'https://example.com/private?token=secret')
        const { props } = autocapturePropertiesForElement(element, {
            e: new MouseEvent('click'),
            maskAllElementAttributes: false,
            maskAllText: false,
            elementsChainAsString: false,
            disableCaptureUrlHashes: false,
            sanitizeUrl: (url) =>
                getRecordedUrl(url, {
                    url_sanitization: omit
                        ? {
                              sanitize: () => {
                                  throw new Error('failure')
                              },
                          }
                        : { query: false },
                }),
        })
        expect(props.$elements[0]['attr__xlink:href']).toBe(omit ? undefined : 'https://example.com/private')
        expect(props.$elements_chain).not.toContain('secret')
    })

    it.each([false, true])('sanitizes autocapture link attributes and external click URLs; omit=%s', (omit) => {
        const element = document.createElement('a')
        element.href = 'https://external.example/private?token=secret#private'
        const options: UrlSanitizationOptions = omit
            ? {
                  sanitize: () => {
                      throw new Error('failure')
                  },
              }
            : { path: false, query: false, hash: false }
        const { props } = autocapturePropertiesForElement(element, {
            e: new MouseEvent('click'),
            maskAllElementAttributes: false,
            maskAllText: false,
            elementsChainAsString: false,
            disableCaptureUrlHashes: true,
            sanitizeUrl: (url) => getRecordedUrl(url, { url_sanitization: options }),
        })
        expect(props.$elements[0].attr__href).toBe(omit ? undefined : 'https://external.example/')
        expect(props.$external_click_url).toBe(omit ? undefined : 'https://external.example/')
        expect(props.$elements_chain).not.toContain('secret')
    })
})
