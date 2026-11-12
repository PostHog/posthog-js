import { window } from '@posthog/browser-common/utils/globals'
import { assignableWindow } from '../../../utils/globals'
import { createPosthogInstance, createRemoteConfig } from '../../helpers/posthog-instance'
import { PostHog } from '../../../posthog-core'
import { CaptureResult, PostHogConfig, RemoteConfig } from '../../../types'
import { ExceptionObserver } from '../../../extensions/exception-autocapture'
import { EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE } from '../../../constants'

describe('exception autocapture during startup', () => {
    let instance: PostHog | undefined
    let originalExtensions: typeof assignableWindow.__PosthogExtensions__
    const beforeSend = vi.fn((_event: CaptureResult | null) => null)
    const loadExternalDependency = vi.fn()

    beforeEach(() => {
        originalExtensions = assignableWindow.__PosthogExtensions__
        assignableWindow.__PosthogExtensions__ = { loadExternalDependency }
    })

    afterEach(() => {
        instance?.exceptionObserver?.dispose()
        instance = undefined
        assignableWindow.__PosthogExtensions__ = originalExtensions
    })

    const triggerError = () =>
        window!.onerror?.call(window, 'startup error', 'app.js', 1, 1, new Error('startup error'))
    const triggerRejection = () =>
        window!.onunhandledrejection?.call(window, {
            reason: new TypeError('Importing a module script failed.'),
        } as PromiseRejectionEvent)

    const init = async (config: Partial<PostHogConfig> = {}, remoteConfig: Partial<RemoteConfig> = {}) => {
        instance = await createPosthogInstance(
            undefined,
            {
                capture_exceptions: true,
                capture_pageview: false,
                before_send: beforeSend,
                ...config,
            },
            remoteConfig
        )
    }

    const remote = (enabled: boolean) =>
        instance!._onRemoteConfig({ ok: true, config: createRemoteConfig({ autocaptureExceptions: enabled }) })

    it('captures startup errors and rejections before any external script can load', async () => {
        await init({
            loaded: () => {
                triggerError()
                triggerRejection()
            },
        })

        expect(beforeSend).toHaveBeenCalledTimes(2)
        expect(beforeSend.mock.calls).toMatchObject([
            [
                {
                    event: '$exception',
                    properties: { $exception_list: [{ value: 'startup error', mechanism: { handled: false } }] },
                },
            ],
            [
                {
                    event: '$exception',
                    properties: {
                        $exception_list: [
                            {
                                type: 'TypeError',
                                value: 'Importing a module script failed.',
                                mechanism: { handled: false },
                            },
                        ],
                    },
                },
            ],
        ])
        expect(loadExternalDependency.mock.calls.some(([, name]) => name === 'exception-autocapture')).toBe(false)
    })

    it('only installs the configured startup handlers', async () => {
        const originalOnError = window!.onerror
        await init({ capture_exceptions: { capture_unhandled_rejections: true } })

        expect(window!.onerror).toBe(originalOnError)
        triggerRejection()
        expect(beforeSend).toHaveBeenCalledTimes(1)
    })

    it('buffers startup errors and rejections until remote enablement, then drains exactly once', async () => {
        await init({ capture_exceptions: undefined })
        triggerError()
        triggerRejection()
        expect(beforeSend).not.toHaveBeenCalled()

        remote(true)
        expect(beforeSend).toHaveBeenCalledTimes(2)
        remote(true)
        expect(beforeSend).toHaveBeenCalledTimes(2)
        triggerError()
        expect(beforeSend).toHaveBeenCalledTimes(3)
    })

    it('discards pending exceptions when remote config disables capture', async () => {
        await init({ capture_exceptions: undefined })
        triggerError()
        remote(false)
        triggerRejection()
        remote(true)
        expect(beforeSend).not.toHaveBeenCalled()
        triggerError()
        expect(beforeSend).toHaveBeenCalledTimes(1)
    })

    it.each([false, true])('waits for fresh remote config despite cached enablement=%s', async (cachedEnabled) => {
        await init({ capture_exceptions: undefined })
        instance!.exceptionObserver!.dispose()
        instance!.persistence!.register({ [EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]: cachedEnabled })
        instance!.exceptionObserver = new ExceptionObserver(instance!)
        triggerError()
        expect(beforeSend).not.toHaveBeenCalled()

        instance!.exceptionObserver.onRemoteConfig({
            ok: true,
            config: createRemoteConfig({ autocaptureExceptions: true }),
        })
        expect(beforeSend).toHaveBeenCalledTimes(1)
    })

    it('keeps pending exceptions when config fails or omits enablement', async () => {
        await init({ capture_exceptions: undefined })
        triggerError()
        instance!._onRemoteConfig({ ok: false })
        instance!._onRemoteConfig({ ok: true, config: createRemoteConfig() })
        expect(beforeSend).not.toHaveBeenCalled()
        remote(true)
        expect(beforeSend).toHaveBeenCalledTimes(1)
    })

    it('caps the startup buffer at 100 exceptions', async () => {
        await init({ capture_exceptions: undefined })
        const send = vi.spyOn(instance!.exceptions!, 'sendExceptionEvent').mockReturnValue(undefined)
        for (let i = 0; i < 105; i++) {
            const error = new Error(`startup error ${i}`)
            error.name = `StartupError${i}`
            window!.onerror?.call(window, error.message, 'app.js', 1, 1, error)
        }
        expect(beforeSend).not.toHaveBeenCalled()
        remote(true)
        expect(send).toHaveBeenCalledTimes(100)
    })

    it('applies newly received suppression rules before draining', async () => {
        await init({ capture_exceptions: undefined })
        triggerError()
        triggerRejection()
        instance!._onRemoteConfig({
            ok: true,
            config: createRemoteConfig({
                autocaptureExceptions: true,
                errorTracking: {
                    suppressionRules: [
                        {
                            type: 'AND',
                            values: [
                                {
                                    key: '$exception_values',
                                    operator: 'exact',
                                    value: 'startup error',
                                    type: 'error_tracking_issue_property',
                                },
                            ],
                        },
                    ],
                },
            }),
        })
        expect(beforeSend).toHaveBeenCalledTimes(1)
    })

    it('keeps each buffered exception’s original timestamp', async () => {
        await init({ capture_exceptions: undefined })
        const occurredAt = new Date('2026-01-01T00:00:00Z')
        vi.useFakeTimers()
        vi.setSystemTime(occurredAt)
        try {
            triggerError()
            vi.setSystemTime(new Date('2026-01-01T00:01:00Z'))
            remote(true)
            expect(beforeSend.mock.calls[0][0]!.timestamp).toEqual(occurredAt)
        } finally {
            vi.useRealTimers()
        }
    })

    it('drains only the event types enabled by an explicit object config', async () => {
        await init({ capture_exceptions: undefined })
        triggerError()
        triggerRejection()
        instance!.set_config({ capture_exceptions: { capture_unhandled_rejections: true } })
        expect(beforeSend).toHaveBeenCalledTimes(1)
    })

    it('drops pending exceptions on explicit disablement', async () => {
        await init({ capture_exceptions: undefined })
        triggerError()
        instance!.set_config({ capture_exceptions: false })
        instance!.set_config({ capture_exceptions: true })
        expect(beforeSend).not.toHaveBeenCalled()
    })

    it('does not retain exceptions captured without consent', async () => {
        await init({ capture_exceptions: undefined, opt_out_capturing_by_default: true })
        triggerError()
        instance!.opt_in_capturing({ captureEventName: false })
        remote(true)
        expect(beforeSend).not.toHaveBeenCalled()
    })

    it('clears pending exceptions when consent is revoked', async () => {
        await init({ capture_exceptions: undefined })
        triggerError()
        instance!.opt_out_capturing()
        instance!.opt_in_capturing({ captureEventName: false })
        remote(true)
        expect(beforeSend).not.toHaveBeenCalled()
    })

    it('clears pending cookieless exceptions on explicit opt-out', async () => {
        await init({ capture_exceptions: undefined, opt_out_capturing_by_default: true, cookieless_mode: 'on_reject' })
        triggerError()
        instance!.opt_out_capturing()
        remote(true)
        expect(beforeSend).not.toHaveBeenCalled()
        triggerError()
        expect(beforeSend).toHaveBeenCalledTimes(1)
    })

    it('clears pending exceptions on identity reset', async () => {
        await init({ capture_exceptions: undefined })
        triggerError()
        instance!.reset()
        remote(true)
        expect(beforeSend).not.toHaveBeenCalled()
    })

    it('stops draining if a capture callback resets identity', async () => {
        await init({ capture_exceptions: undefined })
        triggerError()
        triggerRejection()
        beforeSend.mockImplementationOnce(() => {
            instance!.reset()
            return null
        })
        remote(true)
        expect(beforeSend).toHaveBeenCalledTimes(1)
    })

    it('clears pending exceptions and restores handlers on shutdown', async () => {
        const originalOnError = window!.onerror
        await init({ capture_exceptions: undefined })
        triggerError()
        await instance!.shutdown()
        remote(true)
        expect(window!.onerror).toBe(originalOnError)
        expect(beforeSend).not.toHaveBeenCalled()
    })

    it('installs startup handlers even when other extensions initialize asynchronously', async () => {
        await init({
            __preview_deferred_init_extensions: true,
            loaded: () => {
                triggerError()
                triggerRejection()
            },
        })
        expect(beforeSend).toHaveBeenCalledTimes(2)
    })

    it('does not remove another instance’s handlers when remotely disabled', async () => {
        await init({ capture_exceptions: undefined })
        const otherBeforeSend = vi.fn(() => null)
        const other = await createPosthogInstance(undefined, { capture_exceptions: true, before_send: otherBeforeSend })
        try {
            remote(false)
            triggerError()
            expect(otherBeforeSend).toHaveBeenCalledTimes(1)
            expect(beforeSend).not.toHaveBeenCalled()
            instance!.set_config({ capture_exceptions: true })
            triggerRejection()
            expect(otherBeforeSend).toHaveBeenCalledTimes(2)
            expect(beforeSend).toHaveBeenCalledTimes(1)
        } finally {
            other.exceptionObserver!.dispose()
        }
    })

    it('stops capturing when disabled through set_config', async () => {
        await init()
        instance!.set_config({ capture_exceptions: false })
        triggerError()
        triggerRejection()
        expect(beforeSend).not.toHaveBeenCalled()
    })

    it('does not deliver startup errors while opted out', async () => {
        await init({ opt_out_capturing_by_default: true })
        triggerError()
        triggerRejection()
        expect(beforeSend).not.toHaveBeenCalled()
    })
})
