import errorWrappingFunctions from '../entrypoints/exception-autocapture'
import { ExceptionObserver } from '../extensions/exception-autocapture'
import { defaultConfig, PostHog } from '../posthog-core'
import { PostHogExceptions } from '../posthog-exceptions'
import { PostHogPersistence } from '../posthog-persistence'
import { ErrorTracking } from '@posthog/core'

// Synthetic fixtures, not device recordings.
// iOS controls come from posthog-exceptions.test.ts. Application near misses are invented
// to constrain the filter: mentioning a Java error is not proof of WebView noise.
const facebookMessages = [
    'Java exception was raised during method invocation',
    'Java object is gone',
    'Error invoking postMessage: Java exception was raised during method invocation',
    'Error invoking postMessage: Java object is gone',
]
const applicationMessages = [
    'Java exception was raised during method invocation of checkout.submit',
    'Java object is gone from the checkout cache',
    'Error invoking postMessage: Java object is gone from the checkout cache',
    'Error invoking postMessage: Java exception was raised during method invocation of checkout.submit',
    'Checkout failed: Java object is gone',
    'Checkout failed: Java exception was raised during method invocation',
    'Checkout failed: Error invoking postMessage: Java object is gone',
    'Checkout failed: Error invoking postMessage: Java exception was raised during method invocation',
    'Checkout failed: payment token is missing',
]

describe.each(['message-only onerror', 'Error-object onerror'] as const)('mobile noise: %s', (inputKind) => {
    let exceptions: PostHogExceptions
    let config: ReturnType<typeof defaultConfig>
    let persistence: PostHogPersistence
    let capture: ReturnType<typeof vi.fn>
    let received: ReturnType<typeof vi.fn>
    let unwrap: () => void
    const pageUrl = 'https://example.com/checkout.js'

    beforeEach(() => {
        config = {
            ...defaultConfig(),
            persistence: 'memory' as const,
            capture_exceptions: false,
        }
        persistence = new PostHogPersistence(config)
        persistence.clear()
        capture = vi.fn().mockReturnValue({ uuid: 'test-uuid', event: '$exception', properties: {} })
        // The PostHog shell and final delivery are mocked. The property builder, wrapper,
        // observer/rate limiter, persistence, and exception suppression are real source.
        const posthog = {
            config,
            persistence,
            get_property: (key: string) => persistence.get_property(key),
            capture,
        } as unknown as PostHog
        exceptions = new PostHogExceptions(posthog)
        posthog.exceptions = exceptions
        const observer = new ExceptionObserver(posthog)
        received = vi.fn((properties: ErrorTracking.ErrorProperties) => observer.captureException(properties))
        unwrap = errorWrappingFunctions.wrapOnError(received)
    })

    afterEach(() => {
        unwrap?.()
        persistence.clear()
    })

    function report(value: string, type = 'Error') {
        let error: Error | undefined
        if (inputKind === 'Error-object onerror') {
            error = new Error(value)
            error.name = type
            error.stack = `${type}: ${value}\n    at checkout (${pageUrl}:37:42346)`
        }
        window.onerror!(`${type}: ${value}`, pageUrl, 37, 42346, error)
        // Assert that the real wrapper/coercer reached the observer with the intended
        // value and a page frame before judging any absence of final capture.
        expect(received).toHaveBeenCalledTimes(1)
        expect(received.mock.calls[0][0].$exception_list[0]).toMatchObject({
            type,
            value,
            stacktrace: { frames: [expect.objectContaining({ filename: pageUrl })] },
        })
    }

    it.each(facebookMessages)('drops Facebook WebView noise: %s', (value) => {
        report(value)
        expect(capture).not.toHaveBeenCalled()
    })

    it.each(applicationMessages)('captures application near miss: %s', (value) => {
        report(value)
        expect(capture).toHaveBeenCalledTimes(1)
        expect(capture).toHaveBeenCalledWith('$exception', received.mock.calls[0][0], expect.anything())
    })

    it.each([
        ['ReferenceError', "Can't find variable: __firefox__"],
        ['TypeError', "undefined is not an object (evaluating 'window.__gCrWeb.something')"],
    ])('existing mobile filter drops %s: %s', (type, value) => {
        report(value, type)
        expect(capture).not.toHaveBeenCalled()
    })

    describe.each([
        { client: undefined, server: true, shouldCapture: true },
        { client: true, server: false, shouldCapture: true },
        { client: false, server: true, shouldCapture: false },
    ])('extension capture override: client=$client, server=$server', ({ client, server, shouldCapture }) => {
        it.each(facebookMessages)('respects the override for: %s', (value) => {
            config.error_tracking.captureExtensionExceptions = client
            exceptions.onRemoteConfig({
                ok: true,
                config: { supportedCompression: [], errorTracking: { captureExtensionExceptions: server } },
            })
            report(value)
            if (shouldCapture) {
                expect(capture).toHaveBeenCalledTimes(1)
                expect(capture).toHaveBeenCalledWith('$exception', received.mock.calls[0][0], expect.anything())
            } else {
                expect(capture).not.toHaveBeenCalled()
            }
        })
    })
})
