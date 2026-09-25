import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendRequest, type RequestRuntime } from '../src/request'
import type { BrowserFetch } from '../src/types'

const runtime = (fetch: BrowserFetch): RequestRuntime => [
    {
        api: 'https://api.example.com/posthog',
        flags: 'https://flags.example.com/proxy',
    },
    'ph_test',
    fetch,
    undefined,
]

const abortableFetch = () =>
    vi.fn<Parameters<BrowserFetch>, ReturnType<BrowserFetch>>(async (_, init) => {
        const signal = init?.signal
        return new Promise<Response>((_, reject) => {
            if (signal?.aborted) {
                reject(signal.reason)
            } else {
                // oxlint-disable-next-line posthog-js/no-add-event-listener
                signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
            }
        })
    })

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('control-plane requests', () => {
    it.each([false, true])('times out with an external signal: %s', async (external) => {
        vi.useFakeTimers()
        const controller = new AbortController()
        const fetch = abortableFetch()
        const result = sendRequest(
            runtime(fetch),
            '/endpoint',
            { timeoutMs: 5 },
            undefined,
            external ? controller.signal : undefined
        )
        await vi.advanceTimersByTimeAsync(5)
        await expect(result).resolves.toMatchObject({ statusCode: 0 })
        expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
        expect(controller.signal.aborted).toBe(false)
        expect(vi.getTimerCount()).toBe(0)
    })

    it.each([false, true])('honors an external signal already aborted: %s', async (alreadyAborted) => {
        vi.useFakeTimers()
        const controller = new AbortController()
        const reason = new Error('cancelled')
        if (alreadyAborted) controller.abort(reason)
        const fetch = abortableFetch()
        const remove = vi.spyOn(controller.signal, 'removeEventListener')
        const result = sendRequest(runtime(fetch), '/endpoint', { timeoutMs: 100 }, undefined, controller.signal)
        if (!alreadyAborted) controller.abort(reason)
        await expect(result).resolves.toMatchObject({ statusCode: 0, error: reason })
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
        expect(vi.getTimerCount()).toBe(0)
    })

    it.each([undefined, 0])('does not schedule a timeout for %s', async (timeoutMs) => {
        vi.useFakeTimers()
        const controller = new AbortController()
        const result = sendRequest(
            runtime(abortableFetch()),
            '/endpoint',
            timeoutMs === undefined ? {} : { timeoutMs },
            undefined,
            controller.signal
        )
        expect(vi.getTimerCount()).toBe(0)
        controller.abort()
        await expect(result).resolves.toMatchObject({ statusCode: 0 })
    })

    it.each([false, true])('cleans up after fetch failure: %s', async (fails) => {
        vi.useFakeTimers()
        const controller = new AbortController()
        const remove = vi.spyOn(controller.signal, 'removeEventListener')
        const fetch = vi.fn<Parameters<BrowserFetch>, ReturnType<BrowserFetch>>(async () => {
            if (fails) throw new Error('network error')
            return new Response('{}')
        })
        await sendRequest(runtime(fetch), '/endpoint', { timeoutMs: 100 }, undefined, controller.signal)
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
        expect(vi.getTimerCount()).toBe(0)
        controller.abort()
        expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
    })

    it('retains external cancellation when AbortController is unavailable', async () => {
        const controller = new AbortController()
        vi.stubGlobal('AbortController', undefined)
        const fetch = abortableFetch()
        const result = sendRequest(runtime(fetch), '/endpoint', { timeoutMs: 5 }, undefined, controller.signal)
        controller.abort()
        await expect(result).resolves.toMatchObject({ statusCode: 0 })
        expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
    })
})
