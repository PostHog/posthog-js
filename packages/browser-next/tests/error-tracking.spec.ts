// @vitest-environment jsdom
import { createPostHog as createCore } from '../src/composition/npm/core'
import { createPostHog as createRoot } from '../src/composition/npm'
import { errorTracking } from '../src/products/error-tracking/error-tracking'
import type { ErrorTrackingExtension, ErrorTrackingOptions } from '../src/products/error-tracking/error-tracking'
import type { BrowserFetch, IPostHog, PostHogOptions, RemoteConfig, StorageLike } from '../src/core/types'

class MemoryStorage implements StorageLike {
    readonly values = new Map<string, string>()
    getItem(key: string): string | null {
        return this.values.get(key) ?? null
    }
    setItem(key: string, value: string): void {
        this.values.set(key, value)
    }
    removeItem(key: string): void {
        this.values.delete(key)
    }
}

interface CapturedEvent {
    event: string
    properties: Record<string, any>
}

const baseRemoteConfig: RemoteConfig = {
    supportedCompression: [],
    toolbarParams: {},
    toolbarVersion: 'toolbar',
    isAuthenticated: false,
    siteApps: [],
}

const collect = (sent: CapturedEvent[]): BrowserFetch => {
    return async (input, init = {}) => {
        if (String(input).includes('/i/v1/analytics/events')) {
            const { batch } = JSON.parse(String(init.body)) as { batch: Array<CapturedEvent & { uuid: string }> }
            sent.push(...batch)
            const results = Object.fromEntries(batch.map((event) => [event.uuid, { result: 'ok' }]))
            return new Response(JSON.stringify({ results }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        }
        return new Response('{}', { status: 404 })
    }
}

const clients: IPostHog[] = []

/** Serves remote configuration once the test delivers it, so it arrives after extension setup. */
const deferredRemoteConfig = (sent: CapturedEvent[]) => {
    let deliver!: (config: Partial<RemoteConfig>) => void
    const config = new Promise<Partial<RemoteConfig>>((resolve) => {
        deliver = resolve
    })
    const events = collect(sent)
    const fetch: BrowserFetch = async (input, init) =>
        new URL(String(input)).pathname.endsWith('/config')
            ? new Response(JSON.stringify({ ...baseRemoteConfig, ...(await config) }), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
              })
            : events(input, init)
    return { fetch, deliver }
}

/** Wrapper loading is a dynamic import; once the module is cached, a macrotask lets any pending load finish. */
const settleWrapperLoading = async () => {
    await import('@posthog/browser-common/exception-autocapture')
    await new Promise((resolve) => setTimeout(resolve, 0))
}

const baseOptions = (sent: CapturedEvent[], remoteConfig: Partial<RemoteConfig> = {}): PostHogOptions => ({
    projectToken: 'ph_errors',
    capturePageview: false,
    navigator: false,
    storage: new MemoryStorage(),
    fetch: collect(sent),
    remoteConfig: { ...baseRemoteConfig, ...remoteConfig },
    analytics: { flushAt: 100, flushInterval: 0 },
    flags: false,
})

const createWith = async (
    sent: CapturedEvent[],
    options: ErrorTrackingOptions = {},
    remoteConfig: Partial<RemoteConfig> = {},
    overrides: { [Key in keyof PostHogOptions]?: PostHogOptions[Key] | undefined } = {}
): Promise<{ posthog: IPostHog; tracking: ErrorTrackingExtension }> => {
    const tracking = errorTracking(options)
    const posthog = await createCore({
        ...baseOptions(sent, remoteConfig),
        extensions: [tracking],
        ...overrides,
    } as PostHogOptions)
    clients.push(posthog)
    return { posthog, tracking }
}

const exceptions = async (posthog: IPostHog, sent: CapturedEvent[]) => {
    await posthog.flush()
    // Typed loosely so tests can destructure captured events without index checks.
    return sent.filter((event) => event.event === '$exception').map((event) => event.properties) as any[]
}

const stepMessages = (properties: Record<string, any>) =>
    (properties.$exception_steps ?? []).map((step: Record<string, unknown>) => step.$message)

const extensionError = () => {
    const error = new Error('extension failure')
    error.stack = 'Error: extension failure\n    at run (chrome-extension://abcdef/content.js:1:2)'
    return error
}

let originalOnError: OnErrorEventHandler
let originalOnUnhandledRejection: typeof window.onunhandledrejection
const pageConsole = globalThis.console
let originalConsoleError: typeof pageConsole.error

beforeEach(() => {
    originalOnError = window.onerror
    originalOnUnhandledRejection = window.onunhandledrejection
    originalConsoleError = pageConsole.error
})

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.shutdown(0)))
    window.onerror = originalOnError
    window.onunhandledrejection = originalOnUnhandledRejection
    pageConsole.error = originalConsoleError
})

describe('manual exception capture', () => {
    it('treats a null exception autocapture option from untyped configuration as unset', async () => {
        const sent: CapturedEvent[] = []
        const { tracking } = await createWith(sent, { captureExceptions: null } as unknown as ErrorTrackingOptions)
        await settleWrapperLoading()
        expect(window.onerror).toBe(originalOnError)
        expect(tracking.captureException(new Error('still works'))).toBe(true)
    })

    it('captures a handled exception with its type, message, stack and caller properties', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(sent)

        expect(tracking.captureException(new TypeError('boom'), { area: 'checkout' })).toBe(true)

        const [properties] = await exceptions(posthog, sent)
        const [exception] = properties.$exception_list
        expect(exception).toMatchObject({
            type: 'TypeError',
            value: 'boom',
            mechanism: { handled: true, type: 'generic', exception_id: 0 },
        })
        expect(exception.stacktrace.frames.length).toBeGreaterThan(0)
        expect(properties.$exception_level).toBe('error')
        expect(properties.area).toBe('checkout')
        expect(properties).not.toHaveProperty('$exception_source')
    })

    it('keeps SDK-owned exception properties when caller properties use the same keys', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(sent)

        tracking.captureException(new Error('real'), {
            $exception_list: [{ type: 'Fake', value: 'fake' }],
            $exception_level: 'debug',
            $exception_fingerprint: 'custom',
        })

        const [properties] = await exceptions(posthog, sent)
        expect(properties.$exception_list[0].value).toBe('real')
        expect(properties.$exception_level).toBe('error')
        expect(properties.$exception_fingerprint).toBe('custom')
    })

    it('normalizes non-standard thrown values', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(sent)

        expect(() => tracking.captureException('plain message')).not.toThrow()
        tracking.captureException({ message: 'object message' })

        const [fromString, fromObject] = await exceptions(posthog, sent)
        expect(fromString.$exception_list[0].value).toBe('plain message')
        expect(fromObject.$exception_list[0].value).toContain('object message')
    })

    it('ends the stack synthesized for a non-Error value at the application caller', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(sent)
        const reportFromApp = () => tracking.captureException('plain message')

        reportFromApp()

        const [properties] = await exceptions(posthog, sent)
        expect(properties.$exception_list[0].stacktrace.frames.at(-1).function).toBe('reportFromApp')
    })

    it('keeps every frame of a supplied stack that starts with a frame', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(sent)
        const stack = 'crash@https://example.test/app.js:40:2\nentry@https://example.test/app.js:10:2'
        const native = new Error('native')
        native.stack = stack

        tracking.captureException({ message: 'serialized', stack })
        tracking.captureException(native)

        const functions = (await exceptions(posthog, sent)).map((properties) =>
            properties.$exception_list[0].stacktrace.frames.map((frame: { function: string }) => frame.function)
        )
        expect(functions).toEqual([
            ['entry', 'crash'],
            ['entry', 'crash'],
        ])
    })

    it('drops exceptions thrown by the PostHog SDK', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(sent)
        const error = new Error('sdk failure')
        error.stack = 'Error: sdk failure\n    at run (https://us-assets.i.posthog.com/static/browser/0/script.js:1:2)'

        expect(tracking.captureException(error)).toBe(false)
        expect(await exceptions(posthog, sent)).toEqual([])
    })

    it('omits SDK-owned exception metadata supplied by the application', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(sent)
        posthog.register({ $debug_images: [{ debug_id: 'registered' }] })

        tracking.captureException(new Error('manual'), {
            $exception_source: 'browser.console',
            $exception_types: ['Fake'],
            area: 'checkout',
        })

        const [properties] = await exceptions(posthog, sent)
        expect(properties.area).toBe('checkout')
        expect(properties).not.toHaveProperty('$exception_source')
        expect(properties).not.toHaveProperty('$exception_types')
        expect(properties).not.toHaveProperty('$debug_images')
    })

    it('returns false when the event is dropped before it is queued', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(sent)

        expect(tracking.captureException(new Error('oversized'), { attachment: 'x'.repeat(8 * 1024 * 1024) })).toBe(
            false
        )
        expect(await exceptions(posthog, sent)).toEqual([])
    })

    it('lists the caught exception first and its cause last', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(sent)
        const root = new RangeError('root')
        const wrapper = new Error('wrapper', { cause: root })

        tracking.captureException(wrapper)

        const [properties] = await exceptions(posthog, sent)
        expect(properties.$exception_list.map((exception: { value: string }) => exception.value)).toEqual([
            'wrapper',
            'root',
        ])
        expect(properties.$exception_list[1].mechanism).toMatchObject({
            type: 'chained',
            source: 'cause',
            parent_id: 0,
        })
    })

    it('does nothing while capture is opted out', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(sent)
        posthog.optOut()

        expect(tracking.captureException(new Error('denied'))).toBe(false)

        expect(await exceptions(posthog, sent)).toEqual([])
    })

    it('drops exceptions thrown by browser extensions unless configured to capture them', async () => {
        const dropped: CapturedEvent[] = []
        const captured: CapturedEvent[] = []
        const dropping = await createWith(dropped)
        const capturing = await createWith(captured, { captureExtensionExceptions: true })

        expect(dropping.tracking.captureException(extensionError())).toBe(false)
        expect(capturing.tracking.captureException(extensionError())).toBe(true)

        expect(await exceptions(dropping.posthog, dropped)).toEqual([])
        expect(await exceptions(capturing.posthog, captured)).toHaveLength(1)
    })

    it('captures extension exceptions when remote configuration allows them', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(
            sent,
            {},
            { errorTracking: { captureExtensionExceptions: true } }
        )

        expect(tracking.captureException(extensionError())).toBe(true)
        expect(await exceptions(posthog, sent)).toHaveLength(1)
    })

    it('drops exceptions matching remote suppression rules and records why', async () => {
        const sent: CapturedEvent[] = []
        const storage = new MemoryStorage()
        const suppressionRules = [
            {
                type: 'OR' as const,
                values: [
                    { key: '$exception_types' as const, operator: 'exact' as const, value: 'NoisyError', type: 'x' },
                ],
            },
        ]
        const { posthog, tracking } = await createWith(sent, {}, { errorTracking: { suppressionRules } }, { storage })
        const noisy = new Error('noise')
        noisy.name = 'NoisyError'

        expect(tracking.captureException(noisy)).toBe(false)
        tracking.captureException(new Error('kept'))

        const [properties] = await exceptions(posthog, sent)
        expect(properties.$exception_list[0].value).toBe('kept')
        expect(stepMessages(properties)).toEqual(['Exception dropped: matched a suppression rule'])

        // Saved rules apply before remote configuration resolves.
        const restored = await createWith(sent, {}, {}, { storage, remoteConfig: undefined, fetch: false })
        expect(restored.tracking.captureException(noisy)).toBe(false)
        expect(restored.tracking.captureException(new Error('kept'))).toBe(true)
    })
})

describe('exception steps', () => {
    it('attaches steps oldest first and keeps them for later exceptions', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(sent)

        tracking.addExceptionStep('A', { screen: 'cart' })
        tracking.addExceptionStep('B')
        tracking.captureException(new Error('first'))
        tracking.addExceptionStep('C')
        tracking.captureException(new Error('second'))

        const [first, second] = await exceptions(posthog, sent)
        expect(stepMessages(first)).toEqual(['A', 'B'])
        expect(first.$exception_steps[0]).toMatchObject({ $message: 'A', screen: 'cart' })
        expect(typeof first.$exception_steps[0].$timestamp).toBe('string')
        expect(stepMessages(second)).toEqual(['A', 'B', 'C'])
    })

    it('keeps steps across reset', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(sent)

        tracking.addExceptionStep('before reset')
        posthog.reset()
        tracking.captureException(new Error('after reset'))

        const [properties] = await exceptions(posthog, sent)
        expect(stepMessages(properties)).toEqual(['before reset'])
    })

    it('does not attach steps recorded while capture is denied', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(sent)

        tracking.addExceptionStep('before')
        posthog.optOut()
        tracking.addExceptionStep('denied')
        posthog.optIn()
        tracking.addExceptionStep('after')
        tracking.captureException(new Error('boom'))

        const [properties] = await exceptions(posthog, sent)
        expect(stepMessages(properties)).toEqual(['before', 'after'])
    })

    it('ignores invalid messages and strips reserved fields', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(sent)

        tracking.addExceptionStep('')
        tracking.addExceptionStep(42 as unknown as string)
        tracking.addExceptionStep('valid', { $message: 'override', $timestamp: 1, kept: true })
        tracking.captureException(new Error('boom'))

        const [properties] = await exceptions(posthog, sent)
        expect(properties.$exception_steps).toHaveLength(1)
        expect(properties.$exception_steps[0]).toMatchObject({ $message: 'valid', kept: true })
        expect(properties.$exception_steps[0].$timestamp).not.toBe(1)
    })

    it('does not replace steps supplied by the caller', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(sent)
        const supplied = [{ $message: 'supplied', $timestamp: '2025-01-01T00:00:00.000Z' }]

        tracking.addExceptionStep('buffered')
        tracking.captureException(new Error('boom'), { $exception_steps: supplied })

        const [properties] = await exceptions(posthog, sent)
        expect(properties.$exception_steps).toEqual(supplied)
    })

    it('evicts the oldest steps beyond the byte budget', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(sent, { exceptionSteps: { maxBytes: 150 } })

        tracking.addExceptionStep('first step', { padding: 'x'.repeat(40) })
        tracking.addExceptionStep('second step', { padding: 'x'.repeat(40) })
        tracking.captureException(new Error('boom'))

        const [properties] = await exceptions(posthog, sent)
        expect(stepMessages(properties)).toEqual(['second step'])
    })

    it('records and attaches nothing when disabled', async () => {
        const sent: CapturedEvent[] = []
        const { posthog, tracking } = await createWith(sent, { exceptionSteps: { enabled: false } })

        tracking.addExceptionStep('ignored')
        tracking.captureException(new Error('boom'))

        const [properties] = await exceptions(posthog, sent)
        expect(properties).not.toHaveProperty('$exception_steps')
    })
})

describe('exception autocapture', () => {
    const waitForWrapped = async (read: () => unknown, original: unknown) =>
        vi.waitFor(() => expect(read()).not.toBe(original))

    it('captures unhandled errors and rejections as unhandled exceptions when enabled', async () => {
        const sent: CapturedEvent[] = []
        const previous = vi.fn(() => true)
        window.onerror = previous
        const { posthog } = await createWith(sent, { captureExceptions: true })
        await waitForWrapped(() => window.onerror, previous)

        expect(window.onerror!('Script error', 'https://example.test/app.js', 1, 2, new TypeError('thrown'))).toBe(true)
        expect(previous).toHaveBeenCalledOnce()
        // jsdom has no PromiseRejectionEvent; the coercer also accepts an event carrying `detail.reason`.
        const rejection = new CustomEvent('unhandledrejection', { detail: { reason: new Error('rejected') } })
        window.onunhandledrejection!(rejection as unknown as PromiseRejectionEvent)

        const [error, rejected] = await exceptions(posthog, sent)
        expect(error.$exception_list[0]).toMatchObject({
            type: 'TypeError',
            value: 'thrown',
            mechanism: { handled: false },
        })
        expect(error.$exception_source).toBe('browser.window_onerror')
        expect(rejected.$exception_list[0]).toMatchObject({ value: 'rejected', mechanism: { handled: false } })
        expect(rejected.$exception_source).toBe('browser.unhandledrejection')
    })

    it('captures console errors only when selected, ignoring SDK diagnostics', async () => {
        const sent: CapturedEvent[] = []
        const consoleError = vi.fn()
        pageConsole.error = consoleError
        const { posthog } = await createWith(sent, { captureExceptions: { captureConsoleErrors: true } })
        await waitForWrapped(() => pageConsole.error, consoleError)

        pageConsole.error('[PostHog] [Error tracking]', 'internal diagnostic')
        pageConsole.error(new Error('logged'))

        const captured = await exceptions(posthog, sent)
        expect(captured).toHaveLength(1)
        expect(captured[0].$exception_list[0]).toMatchObject({ value: 'logged', mechanism: { type: 'onconsole' } })
        expect(captured[0].$exception_source).toBe('browser.console')
        expect(consoleError).toHaveBeenCalledTimes(2)
        expect((pageConsole.error as unknown as { __rrweb_original__: unknown }).__rrweb_original__).toBe(consoleError)
        expect(window.onerror).toBe(originalOnError)
    })

    it('rate limits automatically captured exceptions per type', async () => {
        const sent: CapturedEvent[] = []
        const { posthog } = await createWith(sent, { captureExceptions: true })
        await waitForWrapped(() => window.onerror, originalOnError)

        for (let index = 0; index < 12; index++) window.onerror!('boom', undefined, 0, 0, new TypeError(`${index}`))
        window.onerror!('boom', undefined, 0, 0, new RangeError('other type'))

        const captured = await exceptions(posthog, sent)
        expect(captured.filter((properties) => properties.$exception_list[0].type === 'TypeError')).toHaveLength(9)
        expect(captured.filter((properties) => properties.$exception_list[0].type === 'RangeError')).toHaveLength(1)
    })

    it('follows remote configuration when not configured locally and remembers it', async () => {
        const sent: CapturedEvent[] = []
        const storage = new MemoryStorage()
        await createWith(sent, {}, { autocaptureExceptions: true }, { storage })
        await waitForWrapped(() => window.onerror, originalOnError)
        await Promise.all(clients.splice(0).map((client) => client.shutdown(0)))
        expect(window.onerror).toBe(originalOnError)

        await createWith(sent, {}, {}, { storage, remoteConfig: undefined, fetch: false })
        await waitForWrapped(() => window.onerror, originalOnError)
    })

    it('lets local configuration override remote enablement', async () => {
        const sent: CapturedEvent[] = []
        const { tracking } = await createWith(sent, { captureExceptions: false }, { autocaptureExceptions: true })
        await settleWrapperLoading()

        expect(window.onerror).toBe(originalOnError)
        tracking.startExceptionAutocapture()
        await waitForWrapped(() => window.onerror, originalOnError)
        tracking.stopExceptionAutocapture()
        expect(window.onerror).toBe(originalOnError)
    })

    it('does not install handlers whose loading was superseded', async () => {
        const sent: CapturedEvent[] = []
        const { tracking } = await createWith(sent, { captureExceptions: false })

        tracking.startExceptionAutocapture()
        tracking.stopExceptionAutocapture()
        await settleWrapperLoading()

        expect(window.onerror).toBe(originalOnError)
    })

    it('keeps handlers installed after its own when remote configuration repeats the setting', async () => {
        const sent: CapturedEvent[] = []
        const remote = deferredRemoteConfig(sent)
        const { posthog } = await createWith(
            sent,
            { captureExceptions: true },
            {},
            { remoteConfig: undefined, fetch: remote.fetch }
        )
        await waitForWrapped(() => window.onerror, originalOnError)
        const ours = window.onerror!
        const later = vi.fn((...args: Parameters<OnErrorEventHandlerNonNull>) => ours(...args))
        window.onerror = later

        remote.deliver({ autocaptureExceptions: true })
        await posthog.getRemoteConfig()
        await settleWrapperLoading()

        expect(window.onerror).toBe(later)
        window.onerror('boom', undefined, 0, 0, new Error('after remote configuration'))
        expect(await exceptions(posthog, sent)).toHaveLength(1)
    })

    it('starts and stops when remote configuration changes after setup', async () => {
        const sent: CapturedEvent[] = []
        const storage = new MemoryStorage()
        const enabling = deferredRemoteConfig(sent)
        const first = await createWith(sent, {}, {}, { storage, remoteConfig: undefined, fetch: enabling.fetch })
        await settleWrapperLoading()
        expect(window.onerror).toBe(originalOnError)

        enabling.deliver({ autocaptureExceptions: true })
        await first.posthog.getRemoteConfig()
        await waitForWrapped(() => window.onerror, originalOnError)
        await first.posthog.shutdown(0)

        const disabling = deferredRemoteConfig(sent)
        const second = await createWith(sent, {}, {}, { storage, remoteConfig: undefined, fetch: disabling.fetch })
        await waitForWrapped(() => window.onerror, originalOnError)
        disabling.deliver({ autocaptureExceptions: false })
        await second.posthog.getRemoteConfig()

        expect(window.onerror).toBe(originalOnError)
    })

    it('captures nothing and spends no rate-limit tokens while opted out', async () => {
        const sent: CapturedEvent[] = []
        const { posthog } = await createWith(sent, { captureExceptions: true })
        await waitForWrapped(() => window.onerror, originalOnError)

        posthog.optOut()
        for (let index = 0; index < 12; index++) window.onerror!('boom', undefined, 0, 0, new TypeError('denied'))
        posthog.optIn()
        for (let index = 0; index < 9; index++) window.onerror!('boom', undefined, 0, 0, new TypeError('allowed'))

        const captured = await exceptions(posthog, sent)
        expect(captured.map((properties) => properties.$exception_list[0].value)).toEqual(Array(9).fill('allowed'))
    })

    it('restores the page handlers on shutdown', async () => {
        const sent: CapturedEvent[] = []
        const { posthog } = await createWith(sent, { captureExceptions: true })
        await waitForWrapped(() => window.onunhandledrejection, originalOnUnhandledRejection)

        await posthog.shutdown(0)

        expect(window.onerror).toBe(originalOnError)
        expect(window.onunhandledrejection).toBe(originalOnUnhandledRejection)
    })
})

describe('automatic error tracking loading', () => {
    const createRootWith = async (
        options: { [Key in keyof PostHogOptions]?: PostHogOptions[Key] | undefined },
        remoteConfig: Partial<RemoteConfig> = {}
    ) => {
        const sent: CapturedEvent[] = []
        const posthog = await createRoot({ ...baseOptions(sent, remoteConfig), ...options } as PostHogOptions)
        clients.push(posthog)
        return posthog
    }

    it('installs error tracking when configured explicitly', async () => {
        const posthog = await createRootWith({ errorTracking: {} })

        expect(posthog.errorTracking?.captureException(new Error('boom'))).toBe(true)
    })

    it('installs error tracking when remote configuration enables exception autocapture', async () => {
        const posthog = await createRootWith({}, { autocaptureExceptions: true })

        expect(posthog.errorTracking).toBeDefined()
    })

    it('installs error tracking from the saved remote setting before remote configuration loads', async () => {
        const storage = new MemoryStorage()
        const first = await createRootWith({ storage }, { autocaptureExceptions: true })
        await first.shutdown(0)

        const restored = await createRootWith({ storage, remoteConfig: undefined, fetch: false })

        expect(restored.errorTracking).toBeDefined()
    })

    it('loads error tracking on explicit resolution', async () => {
        const posthog = await createRootWith({})
        expect(posthog.errorTracking).toBeUndefined()

        const tracking = await posthog.resolveExtension('errorTracking')

        expect(posthog.errorTracking).toBe(tracking)
        expect(tracking?.captureException(new Error('boom'))).toBe(true)
    })

    it('does not install error tracking without a signal or when disabled', async () => {
        const unconfigured = await createRootWith({})
        const disabled = await createRootWith({ errorTracking: false }, { autocaptureExceptions: true })

        expect(unconfigured.errorTracking).toBeUndefined()
        expect(disabled.errorTracking).toBeUndefined()
    })
})
