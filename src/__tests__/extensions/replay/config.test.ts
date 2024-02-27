import { defaultConfig } from '../../../posthog-core'
import { buildNetworkRequestOptions } from '../../../extensions/replay/config'

describe('config', () => {
    describe('network request options', () => {
        describe('maskRequestFn', () => {
            it('can enable header recording remotely', () => {
                const networkOptions = buildNetworkRequestOptions(defaultConfig(), { recordHeaders: true })
                expect(networkOptions.recordHeaders).toBe(true)
                expect(networkOptions.recordBody).toBe(undefined)
            })

            it('can enable body recording remotely', () => {
                const networkOptions = buildNetworkRequestOptions(defaultConfig(), { recordBody: true })
                expect(networkOptions.recordHeaders).toBe(undefined)
                expect(networkOptions.recordBody).toBe(true)
            })

            it('client can force disable recording', () => {
                const posthogConfig = defaultConfig()
                posthogConfig.session_recording.recordHeaders = false
                posthogConfig.session_recording.recordBody = false
                const networkOptions = buildNetworkRequestOptions(posthogConfig, {
                    recordHeaders: true,
                    recordBody: true,
                })
                expect(networkOptions.recordHeaders).toBe(false)
                expect(networkOptions.recordBody).toBe(false)
            })

            it('should remove the Authorization header from requests even if no other config is set', () => {
                const networkOptions = buildNetworkRequestOptions(defaultConfig(), {})
                const cleaned = networkOptions.maskRequestFn!({
                    name: 'something',
                    requestHeaders: {
                        Authorization: 'Bearer 123',
                        'content-type': 'application/json',
                    },
                })
                expect(cleaned).toEqual({
                    name: 'something',
                    requestHeaders: {
                        'content-type': 'application/json',
                    },
                })
            })

            it('should cope with no headers when even if no other config is set', () => {
                const networkOptions = buildNetworkRequestOptions(defaultConfig(), {})
                const cleaned = networkOptions.maskRequestFn!({
                    name: 'something',
                    requestHeaders: undefined,
                })
                expect(cleaned).toEqual({
                    name: 'something',
                    requestHeaders: undefined,
                })
            })

            it('should remove the Authorization header from requests even when a mask request fn is set', () => {
                const posthogConfig = defaultConfig()
                posthogConfig.session_recording.maskCapturedNetworkRequestFn = (data) => {
                    return {
                        ...data,
                        requestHeaders: {
                            ...(data.requestHeaders ? data.requestHeaders : {}),
                            'content-type': 'edited',
                        },
                    }
                }
                const networkOptions = buildNetworkRequestOptions(posthogConfig, {})

                const cleaned = networkOptions.maskRequestFn!({
                    name: 'something',
                    requestHeaders: {
                        Authorization: 'Bearer 123',
                        'content-type': 'application/json',
                    },
                })
                expect(cleaned).toEqual({
                    name: 'something',
                    requestHeaders: {
                        'content-type': 'edited',
                    },
                })
            })

            it('uses the deprecated mask fn when set', () => {
                const posthogConfig = defaultConfig()
                posthogConfig.session_recording.maskNetworkRequestFn = (data) => {
                    return {
                        ...data,
                        url: 'edited', // deprecated fn only edits the url
                    }
                }
                const networkOptions = buildNetworkRequestOptions(posthogConfig, {})

                const cleaned = networkOptions.maskRequestFn!({
                    name: 'something',
                    requestHeaders: {
                        Authorization: 'Bearer 123',
                        'content-type': 'application/json',
                    },
                })
                expect(cleaned).toEqual({
                    name: 'edited',
                    requestHeaders: {
                        'content-type': 'application/json',
                    },
                })
            })

            it('case insensitively removes headers on the deny list', () => {
                const networkOptions = buildNetworkRequestOptions(defaultConfig(), {})
                const cleaned = networkOptions.maskRequestFn!({
                    name: 'something',
                    requestHeaders: {
                        AuThOrIzAtIoN: 'Bearer 123',
                        'content-type': 'application/json',
                    },
                })
                expect(cleaned).toEqual({
                    name: 'something',
                    requestHeaders: {
                        'content-type': 'application/json',
                    },
                })
            })

            it.each([
                [
                    {
                        name: 'https://app.posthog.com/api/feature_flag/',
                    },
                    {
                        name: 'https://app.posthog.com/api/feature_flag/',
                    },
                ],
                [
                    {
                        name: 'https://app.posthog.com/s/',
                    },
                    undefined,
                ],
                [
                    {
                        name: 'https://app.posthog.com/e/',
                    },
                    undefined,
                ],
                [
                    {
                        name: 'https://app.posthog.com/i/vo/e/',
                    },
                    undefined,
                ],
            ])('ignores ingestion paths', (capturedRequest, expected) => {
                const networkOptions = buildNetworkRequestOptions(defaultConfig(), {})
                const x = networkOptions.maskRequestFn!(capturedRequest)
                expect(x).toEqual(expected)
            })

            it('redacts large request body', () => {
                const networkOptions = buildNetworkRequestOptions(defaultConfig(), {})
                const cleaned = networkOptions.maskRequestFn!({
                    name: 'something',
                    requestHeaders: {
                        'content-type': 'application/json',
                        'content-length': '1000001',
                    },
                    requestBody: 'something very large',
                })
                expect(cleaned).toEqual({
                    name: 'something',
                    requestHeaders: {
                        'content-type': 'application/json',
                        'content-length': '1000001',
                    },
                    requestBody: '[SessionReplay] Request body too large to record (1000001 bytes)',
                })
            })

            it('redacts large response body', () => {
                const networkOptions = buildNetworkRequestOptions(defaultConfig(), {})
                const cleaned = networkOptions.maskRequestFn!({
                    name: 'something',
                    responseHeaders: {
                        'content-type': 'application/json',
                        'content-length': '1000001',
                    },
                    responseBody: 'something very large',
                })
                expect(cleaned).toEqual({
                    name: 'something',
                    responseHeaders: {
                        'content-type': 'application/json',
                        'content-length': '1000001',
                    },
                    responseBody: '[SessionReplay] Response body too large to record (1000001 bytes)',
                })
            })

            it('no need to redact small payload when there is no content length header', () => {
                const networkOptions = buildNetworkRequestOptions(defaultConfig(), {})
                const cleaned = networkOptions.maskRequestFn!({
                    name: 'something',
                    requestHeaders: {
                        'content-type': 'application/json',
                    },
                    requestBody: 'some body that has no content length',
                })
                expect(cleaned).toEqual({
                    name: 'something',
                    requestHeaders: {
                        'content-type': 'application/json',
                    },
                    requestBody: 'some body that has no content length',
                })
            })

            it('can redact large payload when there is no content length header', () => {
                const networkOptions = buildNetworkRequestOptions(defaultConfig(), {})
                const cleaned = networkOptions.maskRequestFn!({
                    name: 'something',
                    requestHeaders: {
                        'content-type': 'application/json',
                    },
                    requestBody: 'a'.repeat(1000001),
                })
                expect(cleaned).toEqual({
                    name: 'something',
                    requestHeaders: {
                        'content-type': 'application/json',
                    },
                    requestBody: '[SessionReplay] Request body too large to record (1000001 bytes)',
                })
            })
        })
    })
})
