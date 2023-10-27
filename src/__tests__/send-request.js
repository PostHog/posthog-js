/* eslint-disable compat/compat */

import { addParamsToURL, encodePostData, xhr } from '../send-request'
import { assert, boolean, property, uint8Array, VerbosityLevel } from 'fast-check'

jest.mock('../config', () => ({ DEBUG: false, LIB_VERSION: '1.23.45' }))

describe('send-request', () => {
    describe('xhr', () => {
        let mockXHR
        let xhrParams
        let onXHRError
        let checkForLimiting
        let xhrOptions

        beforeEach(() => {
            mockXHR = {
                open: jest.fn(),
                setRequestHeader: jest.fn,
                onreadystatechange: jest.fn(),
                send: jest.fn(),
                readyState: 4,
                responseText: JSON.stringify('something here'),
                status: 502,
            }
            onXHRError = jest.fn()
            checkForLimiting = jest.fn()
            xhrOptions = {}
            xhrParams = () => ({
                url: 'https://any.posthog-instance.com',
                data: '',
                headers: {},
                options: xhrOptions,
                callback: () => {},
                retriesPerformedSoFar: null,
                retryQueue: {
                    enqueue: () => {},
                },
                onXHRError,
                onResponse: checkForLimiting,
            })

            window.XMLHttpRequest = jest.fn(() => mockXHR)
        })

        describe('when xhr requests fail', () => {
            it('does not error if the configured onXHRError is not a function', () => {
                onXHRError = 'not a function'
                expect(() => {
                    xhr(xhrParams())
                    mockXHR.onreadystatechange()
                }).not.toThrow()
            })

            it('calls the injected XHR error handler', () => {
                //cannot use an auto-mock from jest as the code checks if onXHRError is a Function
                let requestFromError
                onXHRError = (req) => {
                    requestFromError = req
                }
                xhr(xhrParams())
                mockXHR.onreadystatechange()
                expect(requestFromError).toHaveProperty('status', 502)
            })

            it('calls the on response handler - regardless of status', () => {
                mockXHR.status = Math.floor(Math.random() * 100)
                xhr(xhrParams())
                mockXHR.onreadystatechange()
                expect(checkForLimiting).toHaveBeenCalledWith(mockXHR)
            })
        })
    })

    describe('adding query params to posthog API calls', () => {
        let posthogURL
        let parameterOptions

        posthogURL = 'https://any.posthog-instance.com'

        it('adds library version', () => {
            const alteredURL = addParamsToURL(
                posthogURL,
                {},
                {
                    ip: true,
                }
            )
            expect(new URL(alteredURL).search).toContain('&ver=1.23.45')
        })

        it('adds i as 1 when IP in config', () => {
            const alteredURL = addParamsToURL(
                posthogURL,
                {},
                {
                    ip: true,
                }
            )
            expect(new URL(alteredURL).search).toContain('ip=1')
        })
        it('adds i as 0 when IP not in config', () => {
            parameterOptions = {}
            const alteredURL = addParamsToURL(posthogURL, {}, parameterOptions)
            expect(new URL(alteredURL).search).toContain('ip=0')
        })
        it('adds timestamp', () => {
            const alteredURL = addParamsToURL(
                posthogURL,
                {},
                {
                    ip: true,
                }
            )
            expect(new URL(alteredURL).search).toMatch(/_=\d+/)
        })

        it('does not add a query parameter if it already exists in the URL', () => {
            posthogURL = 'https://test.com/'
            const whenItShouldAddParam = addParamsToURL(
                posthogURL,
                {},
                {
                    ip: true,
                }
            )
            expect(whenItShouldAddParam).toContain('ver=1.23.45')

            posthogURL = 'https://test.com/decide/?ver=2'
            const whenItShouldNotAddParam = addParamsToURL(
                posthogURL,
                {},
                {
                    ip: true,
                }
            )
            expect(whenItShouldNotAddParam).not.toContain('ver=1.23.45')
            expect(whenItShouldNotAddParam).toContain('ver=2')
        })
    })

    describe('using property based testing to identify edge cases in encodePostData', () => {
        it('can use many combinations of typed arrays and options to detect if the method generates undefined', () => {
            assert(
                property(uint8Array(), boolean(), boolean(), (data, blob, sendBeacon) => {
                    const encodedData = encodePostData(data, { blob, sendBeacon, method: 'POST' })
                    // returns blob or string - ignore when it is not a string response
                    return encodedData.indexOf && encodedData.indexOf('undefined') < 0
                }),
                { numRuns: 1000, verbose: VerbosityLevel.VeryVerbose }
            )
        })

        it('does not return undefined when blob and send beacon are false and the input is an empty uint8array', () => {
            const encodedData = encodePostData(new Uint8Array([]), { method: 'POST' })
            expect(typeof encodedData).toBe('string')
            expect(encodedData).toBe('data=')
        })
    })

    describe('encodePostData()', () => {
        let data
        let options

        beforeEach(() => {
            data = { data: 'content' }
            options = { method: 'POST' }

            jest.spyOn(global, 'Blob').mockImplementation((...args) => ['Blob', ...args])
        })

        test.each([
            ['handles objects', { data: 'content' }, { method: 'POST' }, 'data=content'],
            ['handles arrays', ['foo', 'bar'], { method: 'POST' }, 'data=foo%2Cbar'],
            [
                'handles data with compression',
                { data: 'content', compression: 'lz64' },
                { method: 'POST' },
                'data=content&compression=lz64',
            ],
            [
                'handles string buffer as a blob',
                { buffer: 'buffer' },
                { method: 'POST', blob: true },
                [
                    'Blob',
                    ['buffer'],
                    {
                        type: 'text/plain',
                    },
                ],
            ],
            [
                'handles sendBeacon',
                { data: 'content' },
                { method: 'POST', sendBeacon: true },
                [
                    'Blob',
                    ['data=content'],
                    {
                        type: 'application/x-www-form-urlencoded',
                    },
                ],
            ],
            [
                'handles sendBeacon when data is not a typed array and blob is also true',
                { data: 'content' },
                { method: 'POST', sendBeacon: true, blob: true },
                [
                    'Blob',
                    ['data=content'],
                    {
                        type: 'application/x-www-form-urlencoded',
                    },
                ],
            ],
            [
                'handles sendBeacon when data is a typed array and blob is also true',
                new Uint8Array([1, 2, 3, 4]),
                { method: 'POST', sendBeacon: true, blob: true },
                [
                    'Blob',
                    // TODO in the snapshot versions of this test the content was converted to an empty array
                    // should it still be a Uint8Array?
                    [new Uint8Array([1, 2, 3, 4])],
                    {
                        type: 'text/plain',
                    },
                ],
            ],
        ])('handles %s', (_, data, options, expected) => {
            expect(encodePostData(data, options)).toEqual(expected)
        })

        it('handles GET requests', () => {
            options = { method: 'GET' }

            expect(encodePostData(data, options)).toEqual(null)
        })
    })
})
