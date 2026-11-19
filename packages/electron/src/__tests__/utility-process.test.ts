import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { UtilityProcess } from 'electron'
import { attachUtilityProcess } from '../utility/attach'
import { PostHog } from '../utility'
import { envelope, UTILITY_TIMEOUT_MS } from '../utility/protocol'
import type { Command, Properties, State } from '../shared/protocol'

function utilityClient(port: EventEmitter): PostHog {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'parentPort')
    Object.defineProperty(process, 'parentPort', { configurable: true, value: port })
    try {
        return new PostHog()
    } finally {
        if (descriptor) Object.defineProperty(process, 'parentPort', descriptor)
        else Reflect.deleteProperty(process, 'parentPort')
    }
}

function harness(execute?: (command: Command, authorize: () => void) => Promise<void>) {
    const child = Object.assign(new EventEmitter(), {
        postMessage: vi.fn((data: unknown) => queueMicrotask(() => port.emit('message', { data }))),
    })
    const port = Object.assign(new EventEmitter(), {
        postMessage: vi.fn((data: unknown) => queueMicrotask(() => child.emit('message', data))),
    })
    let state: State = {
        revision: 1,
        generation: 0,
        flagRevision: 1,
        distinctId: 'anonymous',
        anonymousId: 'anonymous',
        sessionId: 'session',
        optedOut: false,
        featureFlags: { test: 'variant' },
        featureFlagPayloads: {},
    }
    const contexts: Properties[] = []
    const removed = vi.fn()
    const registration = attachUtilityProcess(
        child as unknown as UtilityProcess,
        async (command, context, generation, authorize) => {
            authorize()
            if (command.type !== 'hello' && generation !== state.generation) throw new Error('Stale PostHog identity')
            contexts.push(context)
            await execute?.(command, authorize)
            if (command.type === 'identify')
                state = {
                    ...state,
                    revision: state.revision + 1,
                    generation: state.generation + 1,
                    distinctId: command.distinctId,
                }
        },
        () => state,
        removed
    )
    const client = utilityClient(port)
    return {
        child,
        port,
        registration,
        client,
        contexts,
        removed,
        publish: (change: Partial<State>) => {
            state = { ...state, ...change, revision: state.revision + 1 }
            registration.publish(state)
        },
    }
}

describe('utilityProcess transport', () => {
    it('keeps repeated and concurrent ready calls idempotent before capture and flush', async () => {
        const h = harness()
        try {
            await Promise.all([h.client.ready(), h.client.ready()])
            await h.client.ready()
            await h.client.capture('after-ready')
            await h.client.flush()
            expect(h.contexts).toHaveLength(3)
            expect(h.removed).not.toHaveBeenCalled()
            h.client.dispose()
            await expect(h.client.ready()).rejects.toThrow('disposed')
        } finally {
            h.client.dispose()
            h.registration.dispose()
        }
    })

    it('recovers from a supported sequential facade burst after the rate window resets', async () => {
        let now = 0
        vi.spyOn(performance, 'now').mockImplementation(() => now)
        const h = harness()
        try {
            await h.client.ready()
            const errors: string[] = []
            for (let i = 0; i < 110; i++) {
                await h.client.capture(`burst-${i}`).catch((error: Error) => errors.push(error.message))
            }
            expect(errors.length).toBeGreaterThan(0)
            expect(new Set(errors)).toEqual(new Set(['PostHog utility rate limit exceeded']))
            expect(h.removed).not.toHaveBeenCalled()
            now = 1000
            await h.client.capture('after-window-reset')
            await h.client.flush()
            expect(h.contexts.length).toBeGreaterThan(2)
        } finally {
            h.client.dispose()
            h.registration.dispose()
        }
    })

    it('consumes authenticated pending-limit rejections without losing protocol order', async () => {
        let now = 0
        vi.spyOn(performance, 'now').mockImplementation(() => now)
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const h = harness(async (command) => {
            if (command.type === 'capture') await gate
        })
        try {
            await h.client.ready()
            const hello = h.port.postMessage.mock.calls
                .map(([value]) => value as Record<string, any>)
                .find((value) => value.kind === 'request')!
            const send = (sequence: number, command: Command) => {
                now += 20
                h.child.emit('message', { ...hello, request: { ...hello.request, sequence, command } })
            }
            const response = (sequence: number) =>
                h.child.postMessage.mock.calls
                    .map(([value]) => value as Record<string, any>)
                    .find((value) => value.kind === 'response' && value.sequence === sequence)?.response
            for (let sequence = 2; sequence <= 101; sequence++) send(sequence, { type: 'capture', event: 'pending' })
            send(102, { type: 'capture', event: 'over-capacity' })
            expect(response(102)).toEqual({ ok: false, error: 'Too many pending PostHog utility requests' })
            expect(h.contexts).toHaveLength(101)
            release()
            await vi.waitFor(() => expect(response(101)?.ok).toBe(true))
            send(103, { type: 'flush' })
            await vi.waitFor(() => expect(response(103)?.ok).toBe(true))
            expect(h.removed).not.toHaveBeenCalled()
        } finally {
            release()
            h.client.dispose()
            h.registration.dispose()
        }
    })

    it('delivers outbound JSON payload keys without weakening inbound command restrictions', async () => {
        const h = harness()
        try {
            await h.client.ready()
            const payload = JSON.parse('{"constructor":{"prototype":true},"__proto__":{"canary":1}}')
            h.publish({ featureFlagPayloads: { test: payload } })
            await Promise.resolve()
            expect(h.removed).not.toHaveBeenCalled()
            expect(h.client.getFeatureFlagPayload('test')).toEqual(payload)
            await h.client.capture('still-connected')
            const request = h.port.postMessage.mock.calls
                .map(([value]) => value as Record<string, any>)
                .find((value) => value.kind === 'request')!
            h.child.emit('message', {
                ...request,
                request: {
                    ...request.request,
                    sequence: 3,
                    command: { type: 'capture', event: 'unsafe', properties: payload },
                },
            })
            expect(h.removed).toHaveBeenCalledOnce()
            expect(h.contexts).toHaveLength(2)
        } finally {
            h.client.dispose()
            h.registration.dispose()
        }
    })

    it.each([
        { test: 'x'.repeat(256 * 1024) },
        { test: Array.from({ length: 21 }).reduce<unknown>((value) => [value], null) },
    ])('retains outbound state size and depth bounds', async (featureFlagPayloads) => {
        const h = harness()
        try {
            await h.client.ready()
            h.publish({ featureFlagPayloads: featureFlagPayloads as State['featureFlagPayloads'] })
            await Promise.resolve()
            expect(h.removed).toHaveBeenCalledOnce()
            await expect(h.client.flush()).rejects.toThrow('closed')
        } finally {
            h.client.dispose()
            h.registration.dispose()
        }
    })

    it('requires a new main registration rather than restarting a disposed facade in the same child', async () => {
        const h = harness()
        await h.client.ready()
        await h.client.capture('before-dispose')
        h.client.dispose()
        const replacement = utilityClient(h.port)
        await expect(replacement.ready()).rejects.toThrow('Out-of-order')
        replacement.dispose()
        h.registration.dispose()
    })

    it('uses parent raw messages and child event.data, coordinated state and a stable owner-assigned context', async () => {
        const h = harness()
        await h.client.ready()
        await h.client.identify('alice')
        await h.client.capture('work', { $utility_process_id: 'spoof', $electron_process: 'main' })
        expect(h.client.getDistinctId()).toBe('alice')
        expect(h.contexts.every((context) => context.$electron_process === 'utility')).toBe(true)
        expect(new Set(h.contexts.map((context) => context.$utility_process_id)).size).toBe(1)
        expect(h.contexts[0].$utility_process_id).not.toBe('spoof')
        h.publish({ optedOut: true })
        await Promise.resolve()
        expect(h.client.hasOptedOutCapturing()).toBe(true)
        const count = h.contexts.length
        await h.client.capture('blocked')
        expect(h.contexts).toHaveLength(count)
        h.client.dispose()
        h.registration.dispose()
        expect(h.removed).toHaveBeenCalledOnce()
        expect(h.child.listenerCount('message')).toBe(0)
        expect(h.port.listenerCount('message')).toBe(0)
    })

    it('rejects outstanding and queued facade operations when main closes the registration', async () => {
        let release!: () => void
        const h = harness(async (command, authorize) => {
            if (command.type !== 'capture') return
            await new Promise<void>((resolve) => {
                release = resolve
            })
            authorize()
        })
        await h.client.ready()
        const pending = h.client.capture('pending')
        const queued = h.client.flush()
        const rejected = Promise.all([
            expect(pending).rejects.toThrow('closed'),
            expect(queued).rejects.toThrow('closed'),
        ])
        await vi.waitFor(() => expect(release).toBeTypeOf('function'))
        h.registration.dispose()
        await rejected
        release()
        h.client.dispose()
    })

    it('removes each child source on unexpected exit without affecting another child', async () => {
        const first = harness(),
            second = harness()
        await Promise.all([first.client.ready(), second.client.ready()])
        first.child.emit('exit', 1)
        await Promise.resolve()
        await expect(first.client.flush()).rejects.toThrow('closed')
        await second.client.capture('still-running')
        expect(first.removed).toHaveBeenCalledOnce()
        expect(second.removed).not.toHaveBeenCalled()
        first.client.dispose()
        second.client.dispose()
        second.registration.dispose()
    })

    it.each([
        {
            kind: 'request',
            token: 'spoof',
            request: { version: 1, sequence: 1, generation: 0, command: { type: 'hello' } },
        },
        { kind: 'connect', padding: 'x'.repeat(256 * 1024) },
        { kind: 'connect', version: 2 },
    ])('closes malformed or unauthenticated SDK messages', async (bad) => {
        const h = harness()
        await h.client.ready()
        h.child.emit('message', envelope(bad))
        await Promise.resolve()
        expect(h.removed).toHaveBeenCalledOnce()
        await expect(h.client.flush()).rejects.toThrow('closed')
        h.client.dispose()
    })

    it('rejects duplicate and skipped request sequence numbers', async () => {
        const h = harness()
        await h.client.ready()
        const sent = h.port.postMessage.mock.calls
            .map(([value]) => value as Record<string, any>)
            .find((value) => value.kind === 'request')!
        h.child.emit('message', {
            ...sent,
            request: { ...sent.request, sequence: 3, command: { type: 'capture', event: 'skip' } },
        })
        h.child.emit('message', sent)
        await Promise.resolve()
        expect(h.contexts).toHaveLength(1)
        expect(
            h.child.postMessage.mock.calls.some(([value]) => (value as any).response?.error?.includes('Out-of-order'))
        ).toBe(true)
        h.client.dispose()
        h.registration.dispose()
    })

    it('bounds request rate and ignores unrelated application messages', async () => {
        const h = harness()
        await h.client.ready()
        h.child.emit('message', { application: 'unrelated' })
        expect(h.removed).not.toHaveBeenCalled()
        for (let i = 0; i < 101; i++) h.child.emit('message', envelope({ kind: 'connect' }))
        expect(h.removed).toHaveBeenCalledOnce()
        h.client.dispose()
    })

    it('does not advance the handshake after an invalid first command', async () => {
        const sent: Record<string, any>[] = []
        const child = Object.assign(new EventEmitter(), { postMessage: (data: Record<string, any>) => sent.push(data) })
        const execute = vi.fn()
        const registration = attachUtilityProcess(child as unknown as UtilityProcess, execute, vi.fn(), vi.fn())
        child.emit('message', envelope({ kind: 'connect' }))
        const token = sent[0].token
        for (const sequence of [1, 2])
            child.emit(
                'message',
                envelope({
                    kind: 'request',
                    token,
                    request: {
                        version: 1,
                        sequence,
                        generation: 0,
                        command: { type: 'capture', event: 'no-handshake' },
                    },
                })
            )
        expect(execute).not.toHaveBeenCalled()
        registration.dispose()
    })

    it('rejects only the timed-out request and keeps the connection for later work', async () => {
        vi.useFakeTimers()
        try {
            let finishFlush!: () => void
            const h = harness(async (command) => {
                if (command.type === 'flush') await new Promise<void>((resolve) => (finishFlush = resolve))
            })
            await h.client.ready()
            const flush = expect(h.client.flush()).rejects.toThrow('timed out')
            await vi.advanceTimersByTimeAsync(UTILITY_TIMEOUT_MS)
            await flush
            // The owner finishes the original delivery after the caller stopped waiting.
            finishFlush()
            await vi.advanceTimersByTimeAsync(0)
            await expect(h.client.capture('after-slow-flush')).resolves.toBeUndefined()
            expect(h.removed).not.toHaveBeenCalled()
            expect(h.contexts).toHaveLength(3)
            h.client.dispose()
            h.registration.dispose()
        } finally {
            vi.useRealTimers()
        }
    })

    it('ignores a late response for a timed-out request', async () => {
        vi.useFakeTimers()
        try {
            let finishCapture!: () => void
            let first = true
            const h = harness(async (command) => {
                if (command.type === 'capture' && first) {
                    first = false
                    await new Promise<void>((resolve) => (finishCapture = resolve))
                }
            })
            await h.client.ready()
            const slow = expect(h.client.capture('slow')).rejects.toThrow('timed out')
            await vi.advanceTimersByTimeAsync(UTILITY_TIMEOUT_MS)
            await slow
            const next = h.client.capture('next')
            finishCapture()
            await vi.advanceTimersByTimeAsync(0)
            await expect(next).resolves.toBeUndefined()
            expect(h.removed).not.toHaveBeenCalled()
            h.client.dispose()
            h.registration.dispose()
        } finally {
            vi.useRealTimers()
        }
    })

    it('expires registration of an already exited or never-started child', async () => {
        vi.useFakeTimers()
        try {
            const child = Object.assign(new EventEmitter(), { postMessage: vi.fn() })
            const removed = vi.fn()
            attachUtilityProcess(child as unknown as UtilityProcess, vi.fn(), vi.fn(), removed)
            expect(child.listenerCount('message')).toBe(1)
            await vi.advanceTimersByTimeAsync(UTILITY_TIMEOUT_MS)
            expect(removed).toHaveBeenCalledOnce()
            expect(child.listenerCount('message')).toBe(0)
            expect(child.listenerCount('exit')).toBe(0)
        } finally {
            vi.useRealTimers()
        }
    })

    it('never accepts another child connection token', async () => {
        const first = harness(),
            second = harness()
        await Promise.all([first.client.ready(), second.client.ready()])
        const request = first.port.postMessage.mock.calls
            .map(([data]) => data as Record<string, any>)
            .find((data) => data.kind === 'request')!
        second.child.emit('message', request)
        expect(second.removed).toHaveBeenCalledOnce()
        expect(first.removed).not.toHaveBeenCalled()
        expect(second.contexts).toHaveLength(1)
        first.client.dispose()
        second.client.dispose()
        first.registration.dispose()
    })

    it('times out when no registered owner responds and releases listeners', async () => {
        vi.useFakeTimers()
        try {
            const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() })
            const facade = utilityClient(port)
            const ready = expect(facade.ready()).rejects.toThrow('timed out')
            await vi.advanceTimersByTimeAsync(UTILITY_TIMEOUT_MS)
            await ready
            expect(port.listenerCount('message')).toBe(0)
            facade.dispose()
        } finally {
            vi.useRealTimers()
        }
    })
})
