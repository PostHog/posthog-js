import { createPosthogInstance } from './helpers/posthog-instance'
import { PostHog } from '../posthog-core'
import {
    getEventProperties,
    getPersonInfo,
    getReferrerInfo,
    getSearchInfo,
} from '@posthog/browser-common/utils/event-utils'
import { autocapturePropertiesForElement } from '@posthog/browser-common/autocapture'
import { getRecordedUrl } from '@posthog/browser-common/utils/url-sanitization'
import * as globals from '@posthog/browser-common/utils/globals'
import type { PostHogConfig, UrlSanitizationOptions } from '../types'

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

    it('sanitizes initial and session persistence even when before_send drops every event', async () => {
        const posthog = await create({ url_sanitization: { path: false, query: false, hash: false } })
        posthog.capture('probe')
        const serialized = JSON.stringify({
            persistent: posthog.persistence.props,
            session: posthog.sessionPersistence.props,
        })
        expect(serialized).not.toMatch(/current-secret|referrer-secret|search-secret|private-preview|private-referrer/)
        expect(posthog.persistence.props.$initial_person_info).toEqual({
            u: 'http://localhost/',
            r: 'https://www.google.com/',
        })
        expect(posthog.persistence.props.$client_session_props.props).toEqual({
            u: 'http://localhost/',
            r: 'https://www.google.com/',
        })
        expect(posthog.sessionPersistence.props.ph_keyword).toBeUndefined()
        expect(posthog.sessionPersistence.props.utm_source).toBeUndefined()
        expect(posthog.get_distinct_id()).toBeTruthy()
    })

    it('covers session and keyword writes with both attribution saving flags disabled', async () => {
        const posthog = await create({
            save_campaign_params: false,
            save_referrer: false,
            url_sanitization: { query: false },
        })
        posthog.capture('probe')
        expect(posthog.persistence.props.$initial_person_info).toBeUndefined()
        expect(posthog.persistence.props.$client_session_props.props.r).toBe('https://www.google.com/private-referrer')
        expect(posthog.sessionPersistence.props.ph_keyword).toBeUndefined()
    })

    it('restores sanitized session URLs when the referrer was omitted before serialization', async () => {
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

    it('allows public paths and validated campaign values through the callback', async () => {
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
        const result = posthog.capture('probe')
        expect(posthog.persistence.props.$initial_person_info.u).toBe('http://localhost/public?utm_source=allowed')
        expect(posthog.sessionPersistence.props.utm_source).toBe('allowed')
        expect(posthog.sessionPersistence.props.ph_keyword).toBeUndefined()
        expect(result).toBeUndefined() // default test transport drops events
    })

    it('omits failed URLs and derived event, session, and initial properties without throwing', async () => {
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
        expect(properties.$session_entry_url).toBeUndefined()
        expect(properties.$initial_current_url).toBeUndefined()
        expect(posthog.sessionPersistence.props.ph_keyword).toBeUndefined()
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

    it('sanitizes referrer query values before deriving keywords and domains', () => {
        const config = {
            url_sanitization: {},
            mask_personal_data_properties: true,
            custom_personal_data_properties: ['q', 'token'],
        }
        expect(getReferrerInfo(config).$referrer).toBe(
            'https://www.google.com/private-referrer?q=<masked>&token=<masked>'
        )
        expect(getSearchInfo(config).ph_keyword).toBe('<masked>')
    })

    it('honors explicit hash inclusion in current, initial and session event URLs', async () => {
        const posthog = await create({ disable_capture_url_hashes: true, url_sanitization: { hash: true } })
        posthog.capture('probe')
        const props = posthog.calculateEventProperties('probe', {}, new Date())
        expect(props.$current_url).toBe(current)
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
