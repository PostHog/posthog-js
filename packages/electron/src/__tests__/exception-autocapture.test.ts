import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PostHog, type RendererOptions } from '../renderer'
import { createExceptionObserver } from '../shared/exception-autocapture'
import type { Bridge, State } from '../shared/protocol'

// Node EventTarget exercises listener ownership; real browser events are covered by the installed Electron fixture.
class TestErrorEvent extends Event {
    get [Symbol.toStringTag]() {
        return 'ErrorEvent'
    }
    constructor(
        readonly error?: unknown,
        readonly message = 'fallback',
        readonly filename = 'file:///app.js',
        readonly lineno = 12,
        readonly colno = 3
    ) {
        super('error', { cancelable: true })
    }
}
class TestRejectionEvent extends Event {
    get [Symbol.toStringTag]() {
        return 'PromiseRejectionEvent'
    }
    constructor(readonly reason: unknown) {
        super('unhandledrejection', { cancelable: true })
    }
}

let target: EventTarget
let clients: PostHog[]
beforeEach(() => {
    target = new EventTarget()
    clients = []
    vi.stubGlobal('window', target)
    vi.stubGlobal('ErrorEvent', TestErrorEvent)
})
afterEach(() => {
    for (const client of clients) client.dispose()
    vi.unstubAllGlobals()
    vi.useRealTimers()
})
function harness(options: RendererOptions = {}, initialState: Partial<State> = {}) {
    let state: State = {
        revision: 1,
        generation: 0,
        flagRevision: 0,
        distinctId: 'user',
        anonymousId: 'anon',
        sessionId: 'session',
        optedOut: false,
        featureFlags: {},
        featureFlagPayloads: {},
        ...initialState,
    }
    let notify: (state: State) => void = () => {}
    const bridge: Bridge = {
        subscribe: (callback) => {
            notify = callback
            return vi.fn()
        },
        request: vi.fn(async () => ({ ok: true as const, state })),
    }
    const client = new PostHog(bridge, options)
    clients.push(client)
    return {
        client,
        bridge,
        consent: (optedOut: boolean) => {
            state = { ...state, revision: state.revision + 1, optedOut }
            notify(state)
        },
        disable: () => {
            state = { ...state, revision: state.revision + 1, disabled: true }
            notify(state)
        },
        commands: () =>
            vi
                .mocked(bridge.request)
                .mock.calls.map(([request]) => request.command)
                .filter((command) => command.type === 'exception'),
    }
}

describe('renderer exception autocapture', () => {
    it('is off by default and installs once after readiness, then removes only its listeners', async () => {
        const add = vi.spyOn(target, 'addEventListener')
        const host = vi.fn()
        target.addEventListener('error', host)
        const defaults = harness()
        await defaults.client.ready()
        expect(add).toHaveBeenCalledTimes(1)
        const enabled = harness({ enableExceptionAutocapture: true })
        expect(add).toHaveBeenCalledTimes(1)
        await enabled.client.ready()
        await enabled.client.ready()
        expect(add).toHaveBeenCalledTimes(3)
        enabled.client.dispose()
        enabled.client.dispose()
        const event = new TestErrorEvent(new Error('after dispose'))
        expect(target.dispatchEvent(event)).toBe(true)
        expect(host).toHaveBeenCalledTimes(1)
        expect(enabled.commands()).toEqual([])
        expect(defaults.commands()).toEqual([])
        const replacement = harness({ enableExceptionAutocapture: true })
        await replacement.client.ready()
        target.dispatchEvent(new TestErrorEvent(new TypeError('replacement')))
        await replacement.client.flush()
        expect(replacement.commands()).toHaveLength(1)
    })

    it('passes raw error/rejection events through core with stacks, mechanisms and canonical sources', async () => {
        const { client, commands } = harness({ enableExceptionAutocapture: true })
        await client.ready()
        const error = new TypeError('renderer throw')
        error.stack =
            'TypeError: renderer throw\n    at crash (file:///app.js:42:3)\n    at entry (file:///app.js:10:1)'
        const event = new TestErrorEvent(error)
        const rejection = new TestRejectionEvent(new RangeError('renderer rejection'))
        expect(target.dispatchEvent(event)).toBe(true)
        expect(target.dispatchEvent(rejection)).toBe(true)
        target.dispatchEvent(new Event('error')) // Resource load failure, not JS.
        await client.captureException(new Error('manual'))
        await client.flush()
        expect(event.defaultPrevented).toBe(false)
        expect(rejection.defaultPrevented).toBe(false)
        const captured = commands()
        expect(captured).toHaveLength(3)
        expect(captured[0]).toMatchObject({
            properties: {
                $exception_source: 'browser.window_onerror',
                $exception_list: [
                    {
                        type: 'TypeError',
                        value: 'renderer throw',
                        mechanism: { type: 'onerror', handled: false },
                        stacktrace: {
                            frames: [
                                { function: 'entry', lineno: 10 },
                                { function: 'crash', lineno: 42 },
                            ],
                        },
                    },
                ],
            },
        })
        expect(captured[1]).toMatchObject({
            properties: {
                $exception_source: 'browser.unhandledrejection',
                $exception_list: [
                    {
                        type: 'RangeError',
                        value: 'renderer rejection',
                        mechanism: { type: 'onunhandledrejection', handled: false },
                    },
                ],
            },
        })
        expect(captured[2]).toMatchObject({
            properties: { $exception_list: [{ mechanism: { type: 'generic', handled: true } }] },
        })
        expect(captured[2].properties).not.toHaveProperty('$exception_source')
    })

    it('uses core location-only ErrorEvent and primitive rejection coercion', async () => {
        const { client, commands } = harness({ enableExceptionAutocapture: true })
        await client.ready()
        target.dispatchEvent(new TestErrorEvent(undefined, 'location error'))
        target.dispatchEvent(new TestRejectionEvent('primitive rejection'))
        await client.flush()
        expect(commands()[0]).toMatchObject({
            properties: {
                $exception_list: [
                    {
                        value: 'location error',
                        stacktrace: { frames: [{ filename: 'file:///app.js', lineno: 12, colno: 3 }] },
                    },
                ],
            },
        })
        expect(commands()[1]).toMatchObject({
            properties: {
                $exception_list: [
                    {
                        type: 'UnhandledRejection',
                        value: 'Non-Error promise rejection captured with value: primitive rejection',
                    },
                ],
            },
        })
    })

    it('does not touch opted-out getters or bridge error data, and resumes after opt-in', async () => {
        const { client, bridge, consent, commands } = harness({ enableExceptionAutocapture: true })
        await client.ready()
        consent(true)
        const getter = vi.fn(() => {
            throw new Error('must not inspect')
        })
        const event = new TestErrorEvent()
        Object.defineProperty(event, 'error', { get: getter })
        const rejection = new TestRejectionEvent(null)
        Object.defineProperty(rejection, 'reason', { get: getter })
        target.dispatchEvent(event)
        target.dispatchEvent(rejection)
        await client.captureException(Object.defineProperty({}, 'message', { get: getter }))
        await Promise.resolve()
        expect(getter).not.toHaveBeenCalled()
        expect(bridge.request).toHaveBeenCalledTimes(1)
        consent(false)
        target.dispatchEvent(new TestErrorEvent(new Error('allowed')))
        await client.flush()
        expect(commands()).toHaveLength(1)
    })

    it('does not inspect or serialize disabled errors while preserving consent and utility commands', async () => {
        const { client, bridge, commands } = harness({ enableExceptionAutocapture: true }, { disabled: true })
        const host = vi.fn()
        target.addEventListener('error', host)
        await client.ready()
        const getter = vi.fn(() => new Error('private error'))
        const event = new TestErrorEvent()
        Object.defineProperty(event, 'error', { get: getter })
        const rejection = new TestRejectionEvent(null)
        Object.defineProperty(rejection, 'reason', { get: getter })
        expect(target.dispatchEvent(event)).toBe(true)
        expect(target.dispatchEvent(rejection)).toBe(true)
        await client.captureException(Object.defineProperty({}, 'message', { get: getter }), {
            get privateProperty() {
                return getter().message
            },
        })
        await Promise.resolve()
        expect(getter).not.toHaveBeenCalled()
        expect(commands()).toEqual([])
        expect(bridge.request).toHaveBeenCalledTimes(1)
        expect(host).toHaveBeenCalledTimes(1)
        expect(event.defaultPrevented).toBe(false)
        expect(rejection.defaultPrevented).toBe(false)
        expect(client.optedOut).toBe(false)
        expect(client.hasOptedOutCapturing()).toBe(false)
        expect(client.getState()).toMatchObject({ disabled: true, optedOut: false })
        await client.optIn()
        await client.captureException(new Error('still disabled'))
        await client.flush()
        expect(commands()).toEqual([])
        expect(vi.mocked(bridge.request).mock.calls.map(([request]) => request.command.type)).toEqual([
            'hello',
            'optIn',
            'flush',
        ])
    })

    it('does not inspect automatic or manual error data while opt-out is pending', async () => {
        const { client, bridge, commands } = harness({ enableExceptionAutocapture: true })
        await client.ready()
        const normal = vi.mocked(bridge.request).getMockImplementation()!
        let release!: () => void
        const held = new Promise<void>((resolve) => {
            release = resolve
        })
        vi.mocked(bridge.request).mockImplementationOnce(async (request) => {
            await held
            return normal(request)
        })
        const withdrawing = client.optOut()
        const getter = vi.fn(() => new Error('private during withdrawal'))
        const event = new TestErrorEvent()
        Object.defineProperty(event, 'error', { get: getter })
        const rejection = new TestRejectionEvent(null)
        Object.defineProperty(rejection, 'reason', { get: getter })
        let manual: Promise<void> | undefined
        try {
            target.dispatchEvent(event)
            target.dispatchEvent(rejection)
            manual = client.captureException(Object.defineProperty({}, 'message', { get: getter }))
            await Promise.resolve()
            expect(getter).not.toHaveBeenCalled()
        } finally {
            release()
            await withdrawing
            await manual
        }
        expect(commands()).toEqual([])
    })

    it('rechecks disabled state before dispatching queued exception IPC', async () => {
        const { client, bridge, disable } = harness({ enableExceptionAutocapture: true })
        await client.ready()
        target.dispatchEvent(new TestErrorEvent(new Error('allowed at observation')))
        disable()
        await Promise.resolve()
        await Promise.resolve()
        expect(bridge.request).toHaveBeenCalledTimes(1)
    })

    it('rechecks consent before dispatching queued exception IPC', async () => {
        const { client, bridge, consent } = harness({ enableExceptionAutocapture: true })
        await client.ready()
        target.dispatchEvent(new TestErrorEvent(new Error('allowed at observation')))
        consent(true)
        await Promise.resolve()
        await Promise.resolve()
        expect(bridge.request).toHaveBeenCalledTimes(1)
    })

    it('does not inspect browser globals during default Node-only initialization', async () => {
        const inspect = vi.fn(() => {
            throw new Error('browser globals unavailable')
        })
        vi.stubGlobal('window', new Proxy({}, { get: inspect }))
        const { client } = harness()
        await client.ready()
        expect(inspect).not.toHaveBeenCalled()
    })

    it('swallows coercion and rejected IPC failures without new global errors', async () => {
        const { client, bridge } = harness({ enableExceptionAutocapture: true })
        await client.ready()
        const malformed = new TestErrorEvent()
        Object.defineProperty(malformed, 'error', {
            get: () => {
                throw new Error('bad accessor')
            },
        })
        expect(() => target.dispatchEvent(malformed)).not.toThrow()
        vi.mocked(bridge.request).mockRejectedValueOnce(new Error('stale identity'))
        target.dispatchEvent(new TestRejectionEvent(new Error('rejected IPC')))
        await new Promise((resolve) => setTimeout(resolve, 5))
        expect(bridge.request).toHaveBeenCalledTimes(2)
    })
})

describe('safe exception observer', () => {
    it('bounds error storms with the shared limiter and refills without inspecting errors', () => {
        vi.useFakeTimers()
        const capture = vi.fn(async () => {})
        const observe = createExceptionObserver(() => true, capture)
        for (let i = 0; i < 1000; i++) observe({}, 'onerror', 'browser.window_onerror')
        expect(capture.mock.calls.length).toBeGreaterThan(0)
        expect(capture.mock.calls.length).toBeLessThanOrEqual(10)
        vi.advanceTimersByTime(2000)
        observe({}, 'onerror', 'browser.window_onerror')
        expect(capture.mock.calls.length).toBeGreaterThan(9)
    })
    it('guards synchronous reentry and contains synchronous and async failures', async () => {
        const capture = vi.fn(() => {
            observe({}, 'onerror', 'browser.window_onerror')
            throw new Error('reporting failed')
        })
        const observe = createExceptionObserver(() => true, capture)
        expect(() => observe({}, 'onerror', 'browser.window_onerror')).not.toThrow()
        expect(capture).toHaveBeenCalledTimes(1)
        const reject = createExceptionObserver(
            () => true,
            async () => {
                throw new Error('async failed')
            }
        )
        reject({}, 'onerror', 'browser.window_onerror')
        await Promise.resolve()
    })
})
