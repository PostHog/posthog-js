/// <reference lib="dom" />

/*
 * Test that basic SDK usage (init, capture, etc) does not
 * blow up in non-browser (node.js) envs. These are not
 * tests of server-side capturing functionality (which is
 * currently not supported in the browser lib).
 */

import { _copyAndTruncateStrings, isCrossDomainCookie, _base64Encode } from '../utils'
import { Info } from '../utils/event-utils'
import { isLikelyBot, DEFAULT_BLOCKED_UA_STRS, isBlockedUA, NavigatorUAData } from '../utils/blocked-uas'
import { expect } from '@jest/globals'

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
                expect(Info.deviceType(userAgent)).toEqual(deviceType)
            }
        })

        it('properties', () => {
            const properties = Info.properties()

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
            [false, 'https://test.herokuapp.com'],
            [false, 'test.herokuapp.com'],
            [false, 'herokuapp.com'],
            [false, undefined],
            // ensure it isn't matching herokuapp anywhere in the domain
            [true, 'https://test.herokuapp.com.impersonator.io'],
            [true, 'mysite-herokuapp.com'],
            [true, 'https://bbc.co.uk'],
            [true, 'bbc.co.uk'],
            [true, 'www.bbc.co.uk'],
        ])('should return %s when hostname is %s', (expectedResult, hostname) => {
            expect(isCrossDomainCookie({ hostname } as unknown as Location)).toEqual(expectedResult)
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
})
