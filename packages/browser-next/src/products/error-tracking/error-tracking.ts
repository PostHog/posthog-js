import { EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE } from '@posthog/browser-common/constants'
import {
    ERROR_TRACKING_CAPTURE_EXTENSION_EXCEPTIONS,
    ERROR_TRACKING_SUPPRESSION_RULES,
    addExceptionStep,
    buildErrorPropertiesBuilder,
    createExceptionRateLimiter,
    createExceptionStepsBuffer,
    exceptionRateLimitKey,
    getExceptionDrop,
    isStackOverflowError,
    resolveExceptionAutocaptureConfig,
    withExceptionContext,
} from '@posthog/browser-common/error-tracking'
import type { ErrorWrappingFunctions } from '@posthog/browser-common/exception-autocapture'
import type { Client, Disposable, ErrorTrackingSuppressionRule } from '@posthog/browser-common'
import type { IPostHog } from '../../core/types'
import type { ErrorTrackingExtension } from './error-tracking-internal'
import {
    snapshotErrorTrackingOptions,
    type ErrorTrackingOptions,
    type ExceptionAutocaptureOptions,
} from './error-tracking-options'

export type { ErrorTrackingOptions, ExceptionAutocaptureOptions, ExceptionStepsOptions } from './error-tracking-options'
export type { ErrorTrackingExtension } from './error-tracking-internal'

type CaptureFn = Parameters<ErrorWrappingFunctions['wrapOnError']>[0]
type ExceptionProperties = Record<string, unknown> & { $exception_list?: unknown }
type ExceptionSource = 'browser.window_onerror' | 'browser.unhandledrejection' | 'browser.console'

interface ActiveErrorTracking {
    readonly client: IPostHog
    readonly logger: Client['logger']
    readonly rateLimiter: ReturnType<typeof createExceptionRateLimiter>
}

// The browser-next logger writes its prefix as a separate first console argument.
const DIAGNOSTIC_PREFIX = /^\[PostHog\](?: |$)/

const toAutocaptureConfig = (
    value: boolean | ExceptionAutocaptureOptions | undefined
): Parameters<typeof resolveExceptionAutocaptureConfig>[0] => {
    if (value === null) return undefined
    if (typeof value !== 'object') return value
    return {
        capture_unhandled_errors: value.captureUnhandledErrors === true,
        capture_unhandled_rejections: value.captureUnhandledRejections === true,
        capture_console_errors: value.captureConsoleErrors === true,
    }
}

/** Include error tracking statically instead of loading the product at initialization. */
export const errorTracking = (options: ErrorTrackingOptions = {}): ErrorTrackingExtension => {
    const config = snapshotErrorTrackingOptions(options)
    const builder = buildErrorPropertiesBuilder()
    const { enabled, maxBytes } = config.exceptionSteps ?? {}
    const steps = createExceptionStepsBuffer({
        ...(enabled === undefined ? {} : { enabled }),
        ...(maxBytes === undefined ? {} : { max_bytes: maxBytes }),
    })
    const subscriptions: Disposable[] = []
    let active: ActiveErrorTracking | undefined
    let disposed = false
    let suppressionRules: readonly ErrorTrackingSuppressionRule[] = []
    let remoteCaptureExtensionExceptions = false
    let remoteAutocapture = false
    let autocapture = config.captureExceptions
    let autocaptureGeneration = 0
    // Resolved sources that are installed or loading; empty when automatic capture is stopped.
    let autocaptureSources = ''
    const unwrap: Array<() => void> = []

    const send = (
        { client, logger }: ActiveErrorTracking,
        properties: ExceptionProperties,
        capturePostHogExceptions = false
    ): boolean => {
        try {
            const drop = getExceptionDrop(
                properties.$exception_list,
                {
                    suppressionRules,
                    captureExtensionExceptions: config.captureExtensionExceptions ?? remoteCaptureExtensionExceptions,
                    capturePostHogExceptions,
                },
                logger
            )
            if (drop) {
                if (steps) addExceptionStep(steps, drop.step, undefined, logger)
                logger.info(drop.log)
                return false
            }
            return client.capture('$exception', withExceptionContext(properties, steps, logger))
        } catch (error) {
            if (!isStackOverflowError(error)) {
                logger.error('Failed to capture exception event. Dropping this exception.', error)
            }
            return false
        }
    }

    const captureAutomatically =
        (source: ExceptionSource): CaptureFn =>
        (properties) => {
            // Never throws or logs errors: console.error may be wrapped and would re-enter this capture.
            try {
                const current = active
                if (!current?.client.canCapture) return
                const type = exceptionRateLimitKey(properties)
                if (current.rateLimiter.consumeRateLimit(type)) {
                    current.logger.info('Skipping exception capture because of client rate limiting.', {
                        exception: type,
                    })
                    return
                }
                send(current, { ...properties, $exception_source: source })
            } catch {
                // Automatic capture must never throw into the page.
            }
        }

    const stopAutocapture = (): void => {
        autocaptureGeneration++
        autocaptureSources = ''
        for (const restore of unwrap.splice(0)) restore()
    }

    const startAutocapture = (
        wrappers: ErrorWrappingFunctions,
        sources: ReturnType<typeof resolveExceptionAutocaptureConfig>,
        logger: Client['logger']
    ): void => {
        try {
            if (sources.capture_unhandled_errors) {
                unwrap.push(wrappers.wrapOnError(captureAutomatically('browser.window_onerror')))
            }
            if (sources.capture_unhandled_rejections) {
                unwrap.push(wrappers.wrapUnhandledRejection(captureAutomatically('browser.unhandledrejection')))
            }
            if (sources.capture_console_errors) {
                unwrap.push(wrappers.wrapConsoleError(captureAutomatically('browser.console')))
            }
        } catch (error) {
            logger.error('Exception autocapture failed to start', error)
            stopAutocapture()
        }
    }

    const refreshAutocapture = (): void => {
        const current = active
        const sources = resolveExceptionAutocaptureConfig(toAutocaptureConfig(autocapture), remoteAutocapture)
        const key = [
            sources.capture_unhandled_errors,
            sources.capture_unhandled_rejections,
            sources.capture_console_errors,
        ].join()
        // Reinstalling unchanged handlers would drop wrappers installed after ours and miss errors meanwhile.
        if (current && key === autocaptureSources) return
        stopAutocapture()
        if (!current || !Object.values(sources).some(Boolean)) return
        autocaptureSources = key
        let window: unknown
        try {
            window = globalThis.window
        } catch {
            // An unavailable window disables automatic capture.
        }
        if (!window) {
            current.logger.info('Exception autocapture requires a window')
            return
        }
        const generation = autocaptureGeneration
        import('@posthog/browser-common/exception-autocapture')
            .then(({ createErrorWrappingFunctions }) => {
                if (active !== current || generation !== autocaptureGeneration) return
                startAutocapture(
                    createErrorWrappingFunctions({ builder, window, diagnosticPrefix: DIAGNOSTIC_PREFIX }),
                    sources,
                    current.logger
                )
            })
            .catch((error: unknown) => {
                // Allow a later refresh to retry.
                if (generation === autocaptureGeneration) autocaptureSources = ''
                current.logger.error('Exception autocapture failed to load', error)
            })
    }

    return {
        name: 'errorTracking',
        setup: (client: IPostHog) => {
            if (disposed) return
            const logger = client.logger.createLogger('[Error tracking]')
            const savedRules = client.kv.get(ERROR_TRACKING_SUPPRESSION_RULES)
            suppressionRules = Array.isArray(savedRules) ? savedRules : []
            remoteCaptureExtensionExceptions = client.kv.get(ERROR_TRACKING_CAPTURE_EXTENSION_EXCEPTIONS) === true
            remoteAutocapture = client.kv.get(EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE) === true
            let started = false
            subscriptions.push(
                client.onRemoteConfig((result) => {
                    if (!result.ok) return
                    const remote = result.config
                    if ('errorTracking' in remote) {
                        const rules = remote.errorTracking?.suppressionRules
                        suppressionRules = Array.isArray(rules) ? rules : []
                        remoteCaptureExtensionExceptions = remote.errorTracking?.captureExtensionExceptions === true
                        client.kv.set({
                            [ERROR_TRACKING_SUPPRESSION_RULES]: suppressionRules,
                            [ERROR_TRACKING_CAPTURE_EXTENSION_EXCEPTIONS]: remoteCaptureExtensionExceptions,
                        })
                    }
                    if ('autocaptureExceptions' in remote) {
                        remoteAutocapture = !!remote.autocaptureExceptions
                        client.kv.set(EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE, remoteAutocapture)
                        if (started) refreshAutocapture()
                    }
                })
            )
            active = { client, logger, rateLimiter: createExceptionRateLimiter(config, logger) }
            started = true
            refreshAutocapture()
        },
        captureException: (error, properties) => {
            try {
                const current = active
                if (!current?.client.canCapture) return false
                // The builder would trim the first line of every stack of a non-Error value, including one the
                // caller supplied. Trim only the SDK frame from the fallback stack and parse every stack whole.
                const syntheticException = new Error('PostHog syntheticException')
                syntheticException.stack = (syntheticException.stack ?? '').split('\n').slice(1).join('\n')
                const exceptionProperties = builder.buildFromUnknown(error, {
                    syntheticException,
                    skipFirstLines: 0,
                    mechanism: { handled: true },
                })
                // A synthetic exception's stack is the SDK's fallback or one supplied with a non-Error value, not a
                // throw site, so its frames do not show that the SDK threw it.
                const synthetic = exceptionProperties.$exception_list[0]?.mechanism?.synthetic === true
                // SDK-owned exception properties take precedence over caller properties.
                return send(current, { ...properties, ...exceptionProperties }, synthetic)
            } catch {
                // Do not log: console.error may be wrapped and would re-enter exception capture.
                return false
            }
        },
        addExceptionStep: (message, properties) => {
            // Record only with capture permission, so a step recorded while denied is never sent after opt-in.
            const current = active
            if (steps && current?.client.canCapture) addExceptionStep(steps, message, properties, current.logger)
        },
        startExceptionAutocapture: (sources) => {
            if (disposed) return
            autocapture = sources ?? true
            refreshAutocapture()
        },
        stopExceptionAutocapture: () => {
            if (disposed) return
            autocapture = false
            refreshAutocapture()
        },
        dispose: () => {
            disposed = true
            subscriptions.splice(0).forEach((subscription) => subscription.dispose())
            stopAutocapture()
            steps?.clear()
            active?.rateLimiter.stop()
            active = undefined
        },
    }
}
