/// <reference lib="dom" />

/*
 * Test that basic SDK usage (init, capture, etc) does not
 * blow up in non-browser (node.js) envs. These are not
 * tests of server-side capturing functionality (which is
 * currently not supported in the browser lib).
 */

import { _copyAndTruncateStrings, isCrossDomainCookie } from '../utils'
import { isLikelyBot, DEFAULT_BLOCKED_UA_STRS, isBlockedUA, NavigatorUAData } from '../utils/blocked-uas'
import { expect } from '@jest/globals'

import { _base64Encode } from '../utils/encode-utils'
import { getPersonPropertiesHash } from '../utils/person-property-utils'
import { detectDeviceType } from '../utils/user-agent-utils'
import { getEventProperties } from '../utils/event-utils'

function userAgentFor(botString: string) {
    const randOne = (Math.random() + 1).toString(36).substring(7)
    const randTwo = (Math.random() + 1).toString(36).substring(7)
    return `Mozilla/5.0 (compatible; ${botString}/${randOne}; +http://a.com/bot/${randTwo})`
}

describe('utils', () => {
    describe('_.copyAndTruncateStrings', () => {
        let target: Record<string, any>

        beforeEach(() => {
            target = {
                key: 'value',
                [5]: 'looongvalue',
                nested: {
                    keeeey: ['vaaaaaalue', 1, 99999999999.4],
                },
            }
        })

        it('truncates objects', () => {
            expect(_copyAndTruncateStrings(target, 5)).toEqual({
                key: 'value',
                [5]: 'looon',
                nested: {
                    keeeey: ['vaaaa', 1, 99999999999.4],
                },
            })
        })

        it('makes a copy', () => {
            const copy = _copyAndTruncateStrings(target, 5)

            target.foo = 'bar'

            expect(copy).not.toEqual(target)
        })

        it('does not truncate when passed null', () => {
            expect(_copyAndTruncateStrings(target, null)).toEqual(target)
        })

        it('handles recursive objects', () => {
            const recursiveObject: Record<string, any> = { key: 'vaaaaalue', values: ['fooobar'] }
            recursiveObject.values.push(recursiveObject)
            recursiveObject.ref = recursiveObject

            expect(_copyAndTruncateStrings(recursiveObject, 5)).toEqual({ key: 'vaaaa', values: ['fooob', undefined] })
        })

        it('handles frozen objects', () => {
            const original = Object.freeze({ key: 'vaaaaalue' })
            expect(_copyAndTruncateStrings(original, 5)).toEqual({ key: 'vaaaa' })
        })
    })

    describe('_.info', () => {
        it('deviceType', () => {
            const deviceTypes = {
                // iPad
                'Mozilla/5.0 (iPad; CPU OS 6_0 like Mac OS X) AppleWebKit/536.26 (KHTML, like Gecko) Version/6.0 Mobile/10A5355d Safari/8536.25':
                    'Tablet',
                // Samsung tablet
                'Mozilla/5.0 (Linux; Android 7.1.1; SM-T555 Build/NMF26X; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/83.0.4103.96 Safari/537.36':
                    'Tablet',
                // Windows Chrome
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.157 Safari/537.36':
                    'Desktop',
                // Mac Safari
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_3) AppleWebKit/537.75.14 (KHTML, like Gecko) Version/7.0.3 Safari/7046A194A':
                    'Desktop',
                // iPhone
                'Mozilla/5.0 (iPhone; CPU iPhone OS 13_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.4 Mobile/15E148 Safari/604.1':
                    'Mobile',
                // LG Android
                'Mozilla/5.0 (Linux; Android 6.0; LG-H631 Build/MRA58K) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/38.0.2125.102 Mobile Safari/537.36':
                    'Mobile',
            }

            for (const [userAgent, deviceType] of Object.entries(deviceTypes)) {
                expect(detectDeviceType(userAgent)).toEqual(deviceType)
            }
        })

        it('properties', () => {
            const properties = getEventProperties()

            expect(properties['$lib']).toEqual('web')
            expect(properties['$device_type']).toEqual('Desktop')
        })
    })

    describe('isLikelyBot', () => {
        it.each(DEFAULT_BLOCKED_UA_STRS.concat('testington'))(
            'blocks a bot based on the user agent %s',
            (botString) => {
                const randomisedUserAgent = userAgentFor(botString)

                expect(isLikelyBot({ userAgent: randomisedUserAgent } as Navigator, ['testington'])).toBe(true)
            }
        )

        it.each([
            [
                'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/W.X.Y.Z Safari/537.36',
            ],
            ['AhrefsSiteAudit (Desktop) - Mozilla/5.0 (compatible; AhrefsSiteAudit/6.1; +http://ahrefs.com/robot/)'],
            ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0; +https://openai.com/gptbot)'],
            [
                'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
            ],
            [
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.175 Safari/537.36 (compatible; Google-HotelAdsVerifier/2.0)',
            ],
            [
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/122.0.0.0 Safari/537.36',
            ],
            [
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Cypress/13.6.3 Chrome/114.0.5735.289 Electron/25.8.4 Safari/537.36',
            ],
            [
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4590.2 Safari/537.36 Chrome-Lighthouse',
            ],
            [
                'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
            ],
            ['Buck/2.4.2; (+https://app.hypefactors.com/media-monitoring/about.html)'],

            ['op3-fetcher/1.0 (bot; https://op3.dev)'],
            ['ZoomBot (Linkbot 1.0 http://suite.seozoom.it/bot.html)'],
            ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'],
            [
                'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.6943.53 Mobile Safari/537.36 (compatible; AdsBot-Google-Mobile; +http://www.google.com/mobile/adsbot.html)',
            ],
            [
                'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexitybot-user)',
            ],
            ['Mozilla/5.0 (compatible; DotBot/1.2; +https://opensiteexplorer.org/dotbot; help@moz.com)'],
            [
                'Mozilla/5.0 (compatible; archive.org_bot +http://archive.org/details/archive.org_bot) Zeno/002a12a warc/v0.8.70',
            ],
            ['Mozilla/5.0 (compatible; DataForSeoBot/1.0; +https://dataforseo.com/dataforseo-bot)'],
            ['Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
            ['Mozilla/5.0 +https://podfollow.com/crawling podfollowbot/1.0'],
            ['meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)'],
            ['Mozilla/5.0 +https://chartable.com/crawler Trackable/0.1'],
            ['Mozilla/5.0 (compatible; SnapchatAds/1.0; +https://businesshelp.snapchat.com/s/article/adsbot-crawler)'],
            [
                'Mozilla/5.0 (compatible; SeznamBot/4.0; +https://o-seznam.cz/napoveda/vyhledavani/en/seznambot-crawler/)',
            ],
            ['BrightEdge Crawler/1.0 (crawler@brightedge.com)'],
        ])('blocks based on user agent', (botString) => {
            expect(isBlockedUA(botString, [])).toBe(true)
            expect(isBlockedUA(botString.toLowerCase(), [])).toBe(true)
            expect(isBlockedUA(botString.toUpperCase(), [])).toBe(true)
            expect(isLikelyBot({ userAgent: botString } as Navigator, [])).toBe(true)
            expect(isLikelyBot({ userAgent: botString.toLowerCase() } as Navigator, [])).toBe(true)
            expect(isLikelyBot({ userAgent: botString.toUpperCase() } as Navigator, [])).toBe(true)
        })

        it.each([
            ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:129.0) Gecko/20100101 Firefox/129.0'],
            [
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
            ],
            [
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
            ],
            [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) elec/1.0.0 Chrome/126.0.6478.127 Electron/31.2.1 Safari/537.36',
            ],
        ])('does not block based on non-bot user agent', (userAgent) => {
            expect(isBlockedUA(userAgent, [])).toBe(false)
            expect(isBlockedUA(userAgent.toLowerCase(), [])).toBe(false)
            expect(isBlockedUA(userAgent.toUpperCase(), [])).toBe(false)
            expect(isLikelyBot({ userAgent } as Navigator, [])).toBe(false)
            expect(isLikelyBot({ userAgent: userAgent.toLowerCase() } as Navigator, [])).toBe(false)
            expect(isLikelyBot({ userAgent: userAgent.toUpperCase() } as Navigator, [])).toBe(false)
        })

        it('blocks based on the webdriver property being set to true', () => {
            expect(isLikelyBot({ webdriver: true } as Navigator, [])).toBe(true)
        })

        it('blocks based on userAgentData', () => {
            const headlessUserAgentData: NavigatorUAData = {
                brands: [
                    { brand: 'Not)A;Brand', version: '99' },
                    { brand: 'HeadlessChrome', version: '127' },
                    { brand: 'Chromium', version: '127' },
                ],
            }
            expect(
                isLikelyBot(
                    {
                        userAgentData: headlessUserAgentData,
                    } as Navigator,
                    []
                )
            ).toBe(true)
        })

        it('does not block a normal browser based of userAgentData', () => {
            const realUserAgentData: NavigatorUAData = {
                brands: [
                    { brand: 'Not)A;Brand', version: '99' },
                    { brand: 'Google Chrome', version: '127' },
                    { brand: 'Chromium', version: '127' },
                ],
            }
            expect(
                isLikelyBot(
                    {
                        userAgentData: realUserAgentData,
                    } as Navigator,
                    []
                )
            ).toBe(false)
        })

        it('does not crash if the type of navigatorUAData changes', () => {
            // we're not checking the return values of these, only that they don't crash
            // @ts-expect-error testing invalid data
            isLikelyBot({ userAgentData: { brands: ['HeadlessChrome'] } } as Navigator, [])
            // @ts-expect-error testing invalid data
            isLikelyBot({ userAgentData: { brands: [() => 'HeadlessChrome'] } } as Navigator, [])
            isLikelyBot({ userAgentData: { brands: () => ['HeadlessChrome'] } } as unknown as Navigator, [])
            isLikelyBot({ userAgentData: 'HeadlessChrome' } as unknown as Navigator, [])
            isLikelyBot({ userAgentData: {} } as unknown as Navigator, [])
            isLikelyBot({ userAgentData: null } as unknown as Navigator, [])
            isLikelyBot({ userAgentData: () => ['HeadlessChrome'] } as unknown as Navigator, [])
            isLikelyBot({ userAgentData: true } as unknown as Navigator, [])
        })
    })

    describe('check for cross domain cookies', () => {
        it.each([
            // Known subdomains are detected
            [false, 'https://test.herokuapp.com'],
            [false, 'test.herokuapp.com'],
            [false, 'herokuapp.com'],
            [false, 'https://test.vercel.app'],
            [false, 'test.vercel.app'],
            [false, 'vercel.app'],
            [false, 'https://test.netlify.app'],
            [false, 'test.netlify.app'],
            [false, 'netlify.app'],

            // ensure it isn't matching known subdomains anywhere in the domain
            [true, 'https://test.herokuapp.com.impersonator.io'],
            [true, 'mysite-herokuapp.com'],
            [true, 'https://test.vercel.app.impersonator.io'],
            [true, 'vercel.app.impersonator.io'],
            [true, 'mysite-vercel.app'],
            [true, 'https://test.netlify.app.impersonator.io'],
            [true, 'mysite-netlify.app'],

            // Base check
            [false, undefined],

            // Basic domain matching for random website
            [true, 'https://bbc.co.uk'],
            [true, 'bbc.co.uk'],
            [true, 'www.bbc.co.uk'],
        ])('should return %s when hostname is %s', (expectedResult, hostname) => {
            // Array is here to make tests more readable
            expect([hostname, isCrossDomainCookie({ hostname } as unknown as Location)]).toEqual([
                hostname,
                expectedResult,
            ])
        })
    })

    describe('base64Encode', () => {
        it('should return null when input is null', () => {
            expect(_base64Encode(null)).toBe(null)
        })

        it('should return undefined when input is undefined', () => {
            expect(_base64Encode(undefined)).toBe(undefined)
        })

        it('should return base64 encoded string when input is a string', () => {
            const input = 'Hello, World!'
            const expectedOutput = 'SGVsbG8sIFdvcmxkIQ==' // Base64 encoded string of 'Hello, World!'
            expect(_base64Encode(input)).toBe(expectedOutput)
        })

        it('should handle special characters correctly', () => {
            const input = '✓ à la mode'
            const expectedOutput = '4pyTIMOgIGxhIG1vZGU=' // Base64 encoded string of '✓ à la mode'
            expect(_base64Encode(input)).toBe(expectedOutput)
        })

        it('should handle empty string correctly', () => {
            const input = ''
            const expectedOutput = '' // Base64 encoded string of an empty string is an empty string
            expect(_base64Encode(input)).toBe(expectedOutput)
        })
    })

    describe('getPersonPropertiesHash', () => {
        it('returns a string hash with only distinct_id', () => {
            const hash = getPersonPropertiesHash('user123')
            expect(typeof hash).toBe('string')
            expect(hash).toContain('user123')
        })

        it('returns the same hash for the same inputs', () => {
            const distinct_id = 'user123'
            const userPropertiesToSet = { name: 'John Doe', email: 'john@example.com' }
            const userPropertiesToSetOnce = { first_seen: '2023-01-01' }

            const hash1 = getPersonPropertiesHash(distinct_id, userPropertiesToSet, userPropertiesToSetOnce)
            const hash2 = getPersonPropertiesHash(distinct_id, userPropertiesToSet, userPropertiesToSetOnce)

            expect(hash1).toBe(hash2)
        })

        it('returns different hashes for different distinct_ids', () => {
            const props = { name: 'John Doe' }
            const hash1 = getPersonPropertiesHash('user1', props)
            const hash2 = getPersonPropertiesHash('user2', props)

            expect(hash1).not.toBe(hash2)
        })

        it('returns different hashes for different userPropertiesToSet', () => {
            const distinct_id = 'user123'
            const hash1 = getPersonPropertiesHash(distinct_id, { name: 'John' })
            const hash2 = getPersonPropertiesHash(distinct_id, { name: 'Jane' })

            expect(hash1).not.toBe(hash2)
        })

        it('returns different hashes for different userPropertiesToSetOnce', () => {
            const distinct_id = 'user123'
            const hash1 = getPersonPropertiesHash(distinct_id, undefined, { first_seen: '2023-01-01' })
            const hash2 = getPersonPropertiesHash(distinct_id, undefined, { first_seen: '2023-02-01' })

            expect(hash1).not.toBe(hash2)
        })

        it('includes all parameters in the hash', () => {
            const distinct_id = 'user123'
            const userPropertiesToSet = { name: 'John Doe' }
            const userPropertiesToSetOnce = { first_seen: '2023-01-01' }

            const hash = getPersonPropertiesHash(distinct_id, userPropertiesToSet, userPropertiesToSetOnce)

            expect(hash).toContain('user123')
            expect(hash).toContain('John Doe')
            expect(hash).toContain('2023-01-01')
        })

        it('handles undefined userPropertiesToSet', () => {
            const distinct_id = 'user123'
            const userPropertiesToSetOnce = { first_seen: '2023-01-01' }

            const hash = getPersonPropertiesHash(distinct_id, undefined, userPropertiesToSetOnce)

            expect(hash).toContain('user123')
            expect(hash).toContain('2023-01-01')
            expect(hash).not.toContain('undefined')
        })

        it('handles undefined userPropertiesToSetOnce', () => {
            const distinct_id = 'user123'
            const userPropertiesToSet = { name: 'John Doe' }

            const hash = getPersonPropertiesHash(distinct_id, userPropertiesToSet)

            expect(hash).toContain('user123')
            expect(hash).toContain('John Doe')
        })

        it('handles complex nested properties', () => {
            const distinct_id = 'user123'
            const userPropertiesToSet = {
                profile: {
                    name: 'John Doe',
                    contacts: ['email', 'phone'],
                    details: {
                        age: 30,
                        location: 'New York',
                    },
                },
            }

            const hash = getPersonPropertiesHash(distinct_id, userPropertiesToSet)

            expect(typeof hash).toBe('string')
            expect(hash).toContain('user123')
            expect(hash).toContain('John Doe')
            expect(hash).toContain('New York')
        })
    })
})
