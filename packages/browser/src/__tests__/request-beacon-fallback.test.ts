/// <reference lib="dom" />

import { request } from '../request'

vi.mock('@posthog/browser-common/utils/globals', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@posthog/browser-common/utils/globals')>()),
    fetch: undefined,
    XMLHttpRequest: vi.fn(),
    navigator: {
        sendBeacon: vi.fn(),
    },
    CompressionStream: undefined,
}))

import { XMLHttpRequest, navigator } from '@posthog/browser-common/utils/globals'

// A browser without `fetch` still has to deliver a beacon the browser rejects,
// otherwise the event is simply lost.
describe('beacon fallback without fetch', () => {
    const mockedXMLHttpRequest: any = XMLHttpRequest
    const mockedSendBeacon: any = navigator!.sendBeacon
    let mockedXHR: any

    beforeEach(() => {
        mockedXHR = {
            open: vi.fn(),
            setRequestHeader: vi.fn(),
            send: vi.fn(),
        }
        mockedXMLHttpRequest.mockImplementation(() => mockedXHR)
    })

    const sendBeaconRequest = () =>
        request({
            url: 'https://any.posthog-instance.com/e',
            method: 'POST',
            transport: 'sendBeacon',
            data: { event: 'conversion' },
            headers: {},
        })

    it('falls back to XHR when the browser rejects the beacon', () => {
        mockedSendBeacon.mockReturnValue(false)

        sendBeaconRequest()

        expect(mockedXHR.send).toHaveBeenCalledTimes(1)
    })

    it('does not use XHR when the browser accepts the beacon', () => {
        mockedSendBeacon.mockReturnValue(true)

        sendBeaconRequest()

        expect(mockedXHR.send).not.toHaveBeenCalled()
    })
})
