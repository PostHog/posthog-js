import { isUndefined } from '@posthog/core'
import { createPosthogInstance } from './helpers/posthog-instance'
import { PostHog } from '../posthog-core'

const responseState = vi.hoisted(() => ({ status: undefined as number | undefined }))

vi.mock('@posthog/browser-common/utils/globals', async (importOriginal) => {
    const original = await importOriginal<typeof import('@posthog/browser-common/utils/globals')>()
    return {
        ...original,
        fetch: undefined,
        CompressionStream: undefined,
        navigator: { sendBeacon: vi.fn(() => true) },
        XMLHttpRequest: vi.fn(() => {
            const xhr = {
                open: vi.fn(),
                setRequestHeader: vi.fn(),
                send: vi.fn(),
                readyState: 0,
                status: 0,
                responseText: '{}',
                onreadystatechange: undefined as (() => void) | undefined,
            }
            xhr.send.mockImplementation(() => {
                if (!isUndefined(responseState.status)) {
                    xhr.readyState = 4
                    xhr.status = responseState.status
                    xhr.onreadystatechange?.()
                }
            })
            return xhr
        }),
    }
})

describe.each([true, false])('unbatched capture retries without fetch (request_batching: %s)', (request_batching) => {
    let posthog: PostHog

    beforeEach(async () => {
        responseState.status = undefined
        posthog = await createPosthogInstance(undefined, { request_batching })
        posthog.set_config({ before_send: (event) => event })
    })

    afterEach(() => {
        posthog._retryQueue?.unload()
    })

    it.each([0, 503])('retains an event for retry after status %s on an active page', (status) => {
        responseState.status = status
        expect(posthog._isPageUnloading).toBe(false)
        expect(posthog._retryQueue?.length).toBe(0)

        posthog.capture('conversion', {}, request_batching ? { send_instantly: true } : undefined)

        expect(posthog._retryQueue?.length).toBe(1)
    })
})
