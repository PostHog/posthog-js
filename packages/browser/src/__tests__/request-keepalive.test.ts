import { request } from '../request'
import { Compression, OtlpLogsPayload, RequestWithOptions } from '../types'
import { PostHogLogs } from '../posthog-logs'
import type { PostHog } from '../posthog-core'
import { fetch, navigator } from '@posthog/browser-common/utils/globals'
import { gzipSync, strToU8 } from 'fflate'

vi.mock('@posthog/browser-common/utils/globals', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@posthog/browser-common/utils/globals')>()),
    fetch: vi.fn(),
    navigator: { sendBeacon: vi.fn(() => false) },
    AbortController: globalThis.AbortController,
    CompressionStream: undefined,
}))

const mockedFetch = vi.mocked(fetch!)
const threshold = 64 * 1024 * 0.8
const data = '😀'.repeat(7500) // 30,002 encoded bytes, not 15,002 UTF-16 code units
const deferred = <T>() => {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}
const tick = async () => {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve()
    }
}

describe('request fetch aggregate keepalive', () => {
    let pending: ReturnType<typeof deferred<Response>>[]
    let bodies: ReturnType<typeof deferred<string>>[]
    const send = (overrides: Partial<RequestWithOptions> = {}) =>
        request({ url: 'https://example.com/e/', method: 'POST', data, ...overrides })
    const keepalives = () => mockedFetch.mock.calls.map(([, init]) => init?.keepalive)

    beforeEach(() => {
        vi.useFakeTimers()
        pending = []
        bodies = []
        mockedFetch.mockImplementation(() => {
            const response = deferred<Response>()
            pending.push(response)
            return response.promise
        })
    })

    afterEach(async () => {
        vi.restoreAllMocks()
        pending.forEach((response) => response.resolve({ status: 200, text: () => Promise.resolve('{}') } as Response))
        bodies.forEach((body) => body.resolve('{}'))
        await tick()
        vi.useRealTimers()
    })

    it('shares encoded bytes across endpoints and replenishes only after consuming the response body', async () => {
        const callback = vi.fn()
        send({ callback })
        send({ url: 'https://other.example.com/ingest/s/' })
        send()
        expect(keepalives()).toEqual([true, false, false])
        const body = deferred<string>()
        bodies.push(body)
        pending[0].resolve({ status: 200, text: () => body.promise } as Response)
        await tick()
        send()
        expect(keepalives()).toEqual([true, false, false, false])
        expect(callback).not.toHaveBeenCalled()
        body.resolve('{"ok":true}')
        await tick()
        expect(callback).toHaveBeenCalledTimes(1)
        expect(callback).toHaveBeenCalledWith({ statusCode: 200, text: '{"ok":true}', json: { ok: true } })
        send()
        expect(keepalives()).toEqual([true, false, false, false, true])
    })

    it.each(['success', 'reject', 'sync throw', 'text reject', 'text throw'])(
        'releases before a callback starts the next request on %s',
        async (outcome) => {
            const error = new TypeError('Failed to fetch')
            const callback = vi.fn(() => send())
            if (outcome === 'sync throw') {
                mockedFetch.mockImplementationOnce(() => {
                    throw error
                })
            }
            send({ callback })
            if (outcome === 'reject') {
                pending[0].reject(error)
            } else if (outcome !== 'sync throw') {
                pending[0].resolve({
                    status: 200,
                    text: () => {
                        if (outcome === 'text throw') {
                            throw error
                        }
                        return outcome === 'text reject' ? Promise.reject(error) : Promise.resolve('{}')
                    },
                } as Response)
            }
            await tick()
            expect(callback).toHaveBeenCalledTimes(1)
            expect(callback).toHaveBeenCalledWith(
                outcome === 'success' ? { statusCode: 200, text: '{}', json: {} } : { statusCode: 0, error }
            )
            // The callback's request is still pending: repeated cleanup must not release its bytes.
            send()
            expect(keepalives()).toEqual([true, true, false])
        }
    )

    it('releases before the logs batch promise resumes sequential sends', async () => {
        const logs = new PostHogLogs({
            config: { token: 'test-token' },
            requestRouter: { endpointFor: () => 'https://example.com/i/v1/logs' },
            // Exercise the real logs callback/Promise bridge with uncompressed request bodies.
            _send_request: (options: RequestWithOptions) => request({ ...options, compression: undefined }),
        } as unknown as PostHog)
        const payload: OtlpLogsPayload = {
            resourceLogs: [
                {
                    resource: { attributes: [] },
                    scopeLogs: [
                        {
                            scope: { name: 'test' },
                            logRecords: [
                                {
                                    timeUnixNano: '1',
                                    observedTimeUnixNano: '1',
                                    severityNumber: 9,
                                    severityText: 'INFO',
                                    body: { stringValue: data },
                                    attributes: [],
                                },
                            ],
                        },
                    ],
                },
            ],
        }
        try {
            const sendBatches = async () => {
                for (let i = 0; i < 3; i++) {
                    await logs['_sendLogsBatch'](payload)
                }
            }
            const sent = sendBatches()
            for (let i = 0; i < 3; i++) {
                pending[i].resolve({ status: 200, text: () => Promise.resolve('{}') } as Response)
                await tick()
            }
            await sent
            expect(keepalives()).toEqual([true, true, true])
        } finally {
            logs.dispose()
        }
    })

    it('preserves callback error handling without releasing the next request twice', async () => {
        const error = new Error('callback failed')
        const callback = vi.fn().mockImplementationOnce(() => {
            send()
            throw error
        })
        send({ callback })
        pending[0].resolve({ status: 200, text: () => Promise.resolve('{}') } as Response)
        await tick()
        expect(callback.mock.calls).toEqual([[{ statusCode: 200, text: '{}', json: {} }], [{ statusCode: 0, error }]])
        send()
        expect(keepalives()).toEqual([true, true, false])
    })

    it.each([undefined, Compression.Base64, Compression.GZipJS])('uses encoded bytes for %s', (compression) => {
        // Incompressible enough to exercise gzip's byte budget with a bounded number of requests.
        const payload = Array.from({ length: 2000 }, (_, i) => `${i * 982451653}😀`).join('')
        send({ data: payload, compression })
        const body = mockedFetch.mock.calls[0][1]!.body!
        const size = new Blob([body as BlobPart]).size
        if (compression === Compression.GZipJS) {
            expect(size).toBe(gzipSync(strToU8(JSON.stringify(payload)), { mtime: 0 }).byteLength)
        }
        const count = Math.ceil(threshold / size) + 1
        for (let i = 1; i < count; i++) {
            send({ data: payload, compression })
        }
        expect(keepalives()).toEqual(Array.from({ length: count }, (_, i) => (i + 1) * size < threshold))
    })

    it.each(['reject', 'sync throw', 'text reject', 'text throw'])('releases once on %s', async (failure) => {
        const error = new TypeError('Failed to fetch')
        const callback = vi.fn()
        if (failure === 'sync throw') {
            mockedFetch.mockImplementationOnce(() => {
                throw error
            })
        }
        send({ callback })
        if (failure === 'reject') {
            pending[0].reject(error)
        } else if (failure === 'text reject' || failure === 'text throw') {
            pending[0].resolve({
                status: 200,
                text: () => {
                    if (failure === 'text throw') {
                        throw error
                    }
                    return Promise.reject(error)
                },
            } as Response)
        }
        await tick()
        expect(callback).toHaveBeenCalledTimes(1)
        expect(callback).toHaveBeenCalledWith({ statusCode: 0, error })
        send()
        send()
        expect(keepalives()).toEqual([true, true, false])
    })

    it('retains the reservation until a timed-out fetch actually rejects', async () => {
        send({ timeout: 10 })
        vi.advanceTimersByTime(10)
        expect(mockedFetch.mock.calls[0][1]!.signal!.aborted).toBe(true)
        send()
        expect(keepalives()).toEqual([true, false])
        pending[0].reject(new DOMException('aborted', 'AbortError'))
        await tick()
        send()
        expect(keepalives()).toEqual([true, false, true])
    })

    it('does not release when a patched abort throws before terminating fetch (#4898)', async () => {
        const error = new Error('patched abort')
        vi.spyOn(globalThis.AbortController.prototype, 'abort').mockImplementation(() => {
            throw error
        })
        send({ timeout: 10 })
        // Containing this pre-existing throw is separate work in #4898.
        expect(() => vi.advanceTimersByTime(10)).toThrow(error)
        send()
        expect(keepalives()).toEqual([true, false])
        pending[0].resolve({ status: 200, text: () => Promise.resolve('{}') } as Response)
        await tick()
        send()
        send()
        expect(keepalives()).toEqual([true, false, true, false])
    })

    it('handles empty bodies without poisoning the byte budget', () => {
        send({ data: undefined })
        send()
        send()
        expect(keepalives()).toEqual([true, true, false])
    })

    it.each([undefined, NaN, Infinity, -1])(
        'uses ordinary fetch for an unknown or invalid encoded size: %s',
        (estimatedSize) => {
            send({
                _encodedBody: { body: new Blob(['unknown']), contentType: 'text/plain', estimatedSize },
            } as any)
            send()
            send()
            expect(keepalives()).toEqual([false, true, false])
        }
    )

    it('retains bytes through timeout after headers until the response body rejects', async () => {
        const body = deferred<string>()
        bodies.push(body)
        send({ timeout: 10 })
        pending[0].resolve({ status: 200, text: () => body.promise } as Response)
        await tick()
        vi.advanceTimersByTime(10)
        send()
        expect(keepalives()).toEqual([true, false])
        body.reject(new DOMException('aborted', 'AbortError'))
        await tick()
        send()
        expect(keepalives()).toEqual([true, false, true])
    })

    it('preserves supported fetch options and honors runtime opt-out without reserving bytes', () => {
        send({ fetchOptions: { cache: 'no-store', next: { revalidate: 0 }, keepalive: false } as any })
        expect(mockedFetch.mock.calls[0][1]).toMatchObject({ cache: 'no-store', next: { revalidate: 0 } })
        send()
        send({ fetchOptions: { keepalive: true } as any })
        expect(keepalives()).toEqual([false, true, false])
    })

    it('does not allow runtime fetch options to bypass beacon rejection fallback', () => {
        send({ transport: 'sendBeacon', fetchOptions: { keepalive: true } as any })
        expect(navigator!.sendBeacon).toHaveBeenCalled()
        send()
        expect(keepalives()).toEqual([false, true])
    })

    it('does not guess sizes of runtime overridden bodies or enable keepalive on overridden GETs', () => {
        send({ fetchOptions: { body: new Blob(['custom']), keepalive: true } as any })
        send({ fetchOptions: { method: 'GET', body: undefined, keepalive: true } as any })
        send()
        expect(keepalives()).toEqual([false, false, true])
    })
})
