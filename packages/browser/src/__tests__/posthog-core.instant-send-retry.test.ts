import { isUndefined } from '@posthog/core'
import { createPosthogInstance } from './helpers/posthog-instance'
import { PostHog } from '../posthog-core'

const responseState = vi.hoisted(() => ({ status: undefined as number | undefined, bodies: [] as string[] }))

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
            xhr.send.mockImplementation((body: string) => {
                responseState.bodies.push(body)
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

// unbatched captures without fetch go out as base64 form data, batched ones as plain JSON
const decodeSentBody = (body: string): Record<string, any> => {
    if (body.indexOf('data=') !== 0) {
        return JSON.parse(body)
    }
    return JSON.parse(Buffer.from(decodeURIComponent(body.slice('data='.length)), 'base64').toString())
}

describe.each([true, false])('unbatched capture retries without fetch (request_batching: %s)', (request_batching) => {
    let posthog: PostHog

    beforeEach(async () => {
        responseState.status = undefined
        responseState.bodies = []
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

    it('retries with the sent_at of the first attempt, so the server can deduplicate the copy', () => {
        vi.useFakeTimers()
        responseState.status = 503

        posthog.capture('conversion', {}, request_batching ? { send_instantly: true } : undefined)

        // past the first backoff delay, which is 3 seconds plus up to 50% jitter
        vi.advanceTimersByTime(15000)

        const sentAtOfEachAttempt = responseState.bodies
            .map(decodeSentBody)
            .filter((body) => body.batch?.[0]?.event === 'conversion')
            .map((body) => body.sent_at)
        expect(sentAtOfEachAttempt.length).toBeGreaterThan(1)
        expect(new Set(sentAtOfEachAttempt)).toEqual(new Set([sentAtOfEachAttempt[0]]))
        expect(sentAtOfEachAttempt[0]).toEqual(expect.any(String))
    })
})
