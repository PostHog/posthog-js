import { window } from '@posthog/browser-common/utils/globals'
import { assignableWindow } from '../../../utils/globals'
import { createPosthogInstance, createRemoteConfig } from '../../helpers/posthog-instance'
import { PostHog } from '../../../posthog-core'
import { CaptureResult, PostHogConfig, RemoteConfig } from '../../../types'
import { ExceptionObserver } from '../../../extensions/exception-autocapture'
import { EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE } from '../../../constants'
import { RemoteConfigLoader } from '../../../remote-config'
import { isUndefined } from '@posthog/core'

describe('exception autocapture during startup', () => {
    let instance: PostHog | undefined
    let originalExtensions: typeof assignableWindow.__PosthogExtensions__
    const beforeSend = vi.fn((_event: CaptureResult | null): CaptureResult | null => null)
    const loadExternalDependency = vi.fn()

    beforeEach(() => {
        originalExtensions = assignableWindow.__PosthogExtensions__
        assignableWindow.__PosthogExtensions__ = { loadExternalDependency }
        vi.spyOn(RemoteConfigLoader.prototype, 'load').mockImplementation(() => {})
    })

    afterEach(() => {
        instance?.exceptionObserver?.dispose()
        instance = undefined
        assignableWindow.__PosthogExtensions__ = originalExtensions
        vi.restoreAllMocks()
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

    it.each([false, true, undefined])('falls back to cached enablement=%s when config fails', async (cachedEnabled) => {
        await init({ capture_exceptions: undefined })
        if (!isUndefined(cachedEnabled)) {
            instance!.persistence!.register({ [EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]: cachedEnabled })
        }
        triggerError()
        instance!._onRemoteConfig({ ok: false })
        triggerError()
        expect(beforeSend).toHaveBeenCalledTimes(cachedEnabled ? 2 : 0)
        expect(instance!.exceptionObserver!.isEnabled).toBe(!!cachedEnabled)
        remote(true)
        expect(beforeSend).toHaveBeenCalledTimes(cachedEnabled ? 2 : 0)
    })

    it.each([false, true])('uses cached enablement=%s when remote config is disabled', async (cachedEnabled) => {
        await init({ capture_exceptions: undefined, advanced_disable_flags: true })
        instance!.exceptionObserver!.dispose()
        instance!.persistence!.register({ [EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]: cachedEnabled })
        delete assignableWindow._POSTHOG_REMOTE_CONFIG?.[instance!.config.token]
        instance!.exceptionObserver = new ExceptionObserver(instance!)
        triggerError()
        expect(beforeSend).toHaveBeenCalledTimes(cachedEnabled ? 1 : 0)
        expect(instance!.exceptionObserver.isEnabled).toBe(cachedEnabled)
    })

    it('uses preloaded enablement even when remote config requests are disabled', async () => {
        await init({ capture_exceptions: undefined, advanced_disable_flags: true }, { autocaptureExceptions: true })
        triggerError()
        expect(beforeSend).not.toHaveBeenCalled()
        instance!._remoteConfigLoader = new RemoteConfigLoader(instance!)
        vi.mocked(instance!._remoteConfigLoader.load).mockRestore()
        instance!._remoteConfigLoader.load()
        expect(beforeSend).toHaveBeenCalledTimes(1)
    })

    it('settles missing enablement using the cache without overwriting a successful response', async () => {
        await init({ capture_exceptions: undefined })
        instance!.persistence!.register({ [EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE]: true })
        triggerError()
        instance!._onRemoteConfig({ ok: true, config: createRemoteConfig() })
        expect(beforeSend).toHaveBeenCalledTimes(1)
        instance!._onRemoteConfig({ ok: false })
        triggerError()
        expect(beforeSend).toHaveBeenCalledTimes(2)
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

    it('preserves occurrence-time properties and breadcrumbs without recalculating on drain', async () => {
        await init({ capture_exceptions: undefined })
        const originalUrl = window!.location.href
        instance!.pageViewManager.doPageView(new Date(), 'startup-pageview')
        instance!.addExceptionStep('before error')
        instance!.register({ screen: 'startup' })
        const calculate = vi.spyOn(instance!, 'calculateEventProperties')
        triggerError()
        expect(calculate).toHaveBeenCalledTimes(1)
        const captured = calculate.mock.results[0].value
        const context = {
            $current_url: captured.$current_url,
            $session_id: captured.$session_id,
            $window_id: captured.$window_id,
            $pageview_id: captured.$pageview_id,
            screen: 'startup',
            $exception_steps: [{ $message: 'before error', $timestamp: expect.any(String) }],
        }
        try {
            window!.history.pushState({}, '', '/after-startup')
            instance!.pageViewManager.doPageView(new Date(), 'later-pageview')
            instance!.addExceptionStep('after error')
            instance!.register({ screen: 'later' })
            calculate.mockClear()
            remote(true)
            expect(calculate).not.toHaveBeenCalled()
            expect(beforeSend.mock.calls[0][0]!.properties).toMatchObject(context)
            expect(beforeSend.mock.calls[0][0]!.properties.$exception_steps).toHaveLength(1)
        } finally {
            window!.history.replaceState({}, '', originalUrl)
        }
    })

    it('does not attach later breadcrumbs to an exception captured without steps', async () => {
        await init({ capture_exceptions: undefined })
        triggerError()
        instance!.addExceptionStep('after error')
        remote(true)
        expect(beforeSend.mock.calls[0][0]!.properties.$exception_steps).toEqual([])
    })

    it('preserves newer breadcrumbs after successfully sending a buffered exception', async () => {
        await init({ capture_exceptions: undefined })
        instance!.addExceptionStep('before error')
        triggerError()
        instance!.addExceptionStep('after error')
        beforeSend.mockImplementationOnce((event) => event)
        vi.spyOn(instance!, '_send_retriable_request').mockImplementation(() => {})
        remote(true)
        triggerError()
        expect(beforeSend.mock.calls[1][0]!.properties.$exception_steps).toEqual([
            { $message: 'after error', $timestamp: expect.any(String) },
        ])
    })

    it.each([false, true])('uses normal delivery and hooks with request_batching=%s', async (batching) => {
        await init({ capture_exceptions: undefined, request_batching: batching })
        const enqueue = vi.spyOn(instance!._requestQueue!, 'enqueue').mockImplementation(() => {})
        const send = vi.spyOn(instance!, '_send_retriable_request').mockImplementation(() => {})
        const captured = vi.fn()
        const unsubscribe = instance!.on('eventCaptured', captured)
        try {
            triggerError()
            expect(enqueue).not.toHaveBeenCalled()
            expect(send).not.toHaveBeenCalled()
            beforeSend.mockImplementationOnce((event) => event)
            remote(true)
            const delivery = batching ? enqueue : send
            expect(delivery).toHaveBeenCalledTimes(1)
            expect(batching ? send : enqueue).not.toHaveBeenCalled()
            expect(delivery.mock.calls[0][0]).toMatchObject({
                method: 'POST',
                batchKey: 'exceptionEvent',
                data: { event: '$exception', properties: { $exception_list: [{ value: 'startup error' }] } },
            })
            expect(captured).toHaveBeenCalledTimes(1)
            expect(captured.mock.calls[0][0]).toBe(delivery.mock.calls[0][0].data)
        } finally {
            unsubscribe()
        }
    })

    it('does not commit person-property bookkeeping while buffering', async () => {
        await init({ capture_exceptions: undefined, person_profiles: 'always' })
        const calculateSetOnce = vi.spyOn(instance!, '_calculate_set_once_properties')
        triggerError()
        expect(calculateSetOnce).not.toHaveBeenCalled()
        remote(true)
        expect(calculateSetOnce).toHaveBeenCalledTimes(1)
    })

    it('applies property sanitization once when preparing buffered exceptions', async () => {
        const sanitize = vi.fn((properties: CaptureResult['properties'], _event: string) => ({
            ...properties,
            sanitized: true,
        }))
        await init({ capture_exceptions: undefined, sanitize_properties: sanitize })
        sanitize.mockClear()
        triggerError()
        expect(sanitize).toHaveBeenCalledTimes(1)
        remote(true)
        expect(sanitize.mock.calls.filter(([, event]) => event === '$exception')).toHaveLength(1)
        expect(beforeSend.mock.calls[0][0]!.properties.sanitized).toBe(true)
    })

    it.each([
        { property_denylist: ['email'] },
        { sanitize_properties: (properties: CaptureResult['properties']) => ({ ...properties, email: undefined }) },
        { mask_personal_data_properties: true },
        { custom_personal_data_properties: ['email'] },
        { disable_capture_url_hashes: true },
    ])('discards snapshots when privacy configuration changes: %j', async (config) => {
        await init({ capture_exceptions: undefined })
        instance!.register({ email: 'user@example.test' })
        triggerError()
        instance!.set_config(config)
        remote(true)
        expect(beforeSend).not.toHaveBeenCalled()
        triggerError()
        expect(beforeSend).toHaveBeenCalledTimes(1)
    })

    it('discards snapshots when a caller mutates and resupplies the same privacy array', async () => {
        const denied: string[] = []
        await init({ capture_exceptions: undefined, property_denylist: denied })
        instance!.register({ email: 'user@example.test' })
        triggerError()
        denied.push('email')
        instance!.set_config({ property_denylist: denied })
        remote(true)
        expect(beforeSend).not.toHaveBeenCalled()
        triggerError()
        expect(beforeSend).toHaveBeenCalledTimes(1)
        expect(beforeSend.mock.calls[0][0]!.properties.email).toBeUndefined()
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

    it.each(['local', 'shared'] as const)('discards cookieless exceptions across %s opt-in', async (transition) => {
        await init({ capture_exceptions: undefined, cookieless_mode: 'on_reject', opt_out_capturing_by_default: true })
        triggerError()
        expect(beforeSend).not.toHaveBeenCalled()
        if (transition === 'local') {
            instance!.opt_in_capturing({ captureEventName: false })
        } else {
            // The consent store is shared; another tab's write bypasses this instance's reset hooks.
            instance!.consent.optInOut(true)
        }
        remote(true)
        expect(beforeSend).not.toHaveBeenCalled()
        triggerError()
        expect(beforeSend).toHaveBeenCalledTimes(1)
        expect(beforeSend.mock.calls[0][0]!.properties.$cookieless_mode).toBeUndefined()
    })

    it('discards regular exceptions across shared cookieless rejection', async () => {
        await init({ capture_exceptions: undefined, cookieless_mode: 'on_reject' })
        instance!.opt_in_capturing({ captureEventName: false })
        triggerError()
        instance!.consent.optInOut(false)
        remote(true)
        expect(beforeSend).not.toHaveBeenCalled()
    })

    it.each([false, true])(
        'discards snapshots across a shared reset, adopted before drain=%s',
        async (adoptBeforeDrain) => {
            const persistenceName = `startup-shared-reset-${adoptBeforeDrain}`
            await init({ capture_exceptions: undefined, cookieWinsOnConflict: true, persistence_name: persistenceName })
            instance!.identify('previous-user')
            instance!.register({ email: 'previous-user@example.test' })
            beforeSend.mockClear()
            triggerError()
            const other = await createPosthogInstance(undefined, {
                persistence_name: persistenceName,
                cookieWinsOnConflict: true,
                capture_exceptions: false,
                capture_pageview: false,
            })
            try {
                const consentBeforeReset = instance!.consent.consent
                other.reset()
                expect(instance!.consent.consent).toBe(consentBeforeReset)
                if (adoptBeforeDrain) {
                    instance!.capture('after shared reset')
                    beforeSend.mockClear()
                }
                remote(true)
                expect(beforeSend).not.toHaveBeenCalled()
                triggerError()
                expect(beforeSend).toHaveBeenCalledTimes(1)
                expect(beforeSend.mock.calls[0][0]!.properties.distinct_id).not.toBe('previous-user')
                expect(beforeSend.mock.calls[0][0]!.properties.email).toBeUndefined()
            } finally {
                other.exceptionObserver?.dispose()
                other.persistence?.clear()
            }
        }
    )

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

    it('wraps application handlers assigned after init when remote enablement arrives', async () => {
        const originalOnError = window!.onerror
        const originalRejection = window!.onunhandledrejection
        const onerror = vi.fn(() => true)
        const onrejection = vi.fn(() => false)
        try {
            await init({
                capture_exceptions: undefined,
                loaded: () => {
                    window!.onerror = onerror
                    window!.onunhandledrejection = onrejection
                },
            })
            remote(true)
            expect(triggerError()).toBe(true)
            expect(triggerRejection()).toBe(false)
            expect(beforeSend).toHaveBeenCalledTimes(2)
            expect(onerror).toHaveBeenCalledTimes(1)
            expect(onrejection).toHaveBeenCalledTimes(1)
        } finally {
            instance?.exceptionObserver?.dispose()
            window!.onerror = originalOnError
            window!.onunhandledrejection = originalRejection
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
