import { buildNetworkRequestOptions } from '../../../extensions/replay/network/record/default-options'
import { defaultConfig } from '../../../posthog-core'

describe('config', () => {
    describe('network request options', () => {
        describe('maskRequestFn', () => {
            it('should remove the Authorization header from requests even if no other config is set', () => {
                const networkOptions = buildNetworkRequestOptions(defaultConfig())
                const cleaned = networkOptions.maskRequestFn!({
                    url: 'something',
                    requestHeaders: {
                        Authorization: 'Bearer 123',
                        'content-type': 'application/json',
                    },
                })
                expect(cleaned?.requestHeaders).toEqual({
                    'content-type': 'application/json',
                })
            })

            it('should cope with no headers when even if no other config is set', () => {
                const networkOptions = buildNetworkRequestOptions(defaultConfig())
                const cleaned = networkOptions.maskRequestFn!({
                    url: 'something',
                    requestHeaders: undefined,
                })
                expect(cleaned?.requestHeaders).toBeUndefined()
            })

            it('should remove the Authorization header from requests even when a mask request fn is set', () => {
                const posthogConfig = defaultConfig()
                posthogConfig.session_recording.maskNetworkRequestFn = (data) => {
                    return {
                        ...data,
                        requestHeaders: {
                            ...(data.requestHeaders ? data.requestHeaders : {}),
                            'content-type': 'edited',
                        },
                    }
                }
                const networkOptions = buildNetworkRequestOptions(posthogConfig)

                const cleaned = networkOptions.maskRequestFn!({
                    url: 'something',
                    requestHeaders: {
                        Authorization: 'Bearer 123',
                        'content-type': 'application/json',
                    },
                })
                expect(cleaned?.requestHeaders).toEqual({
                    'content-type': 'edited',
                })
            })
        })
    })
})
