import { window } from '@posthog/browser-common/utils/globals'
import { assignableWindow } from '../../../utils/globals'
import { createPosthogInstance, createRemoteConfig } from '../../helpers/posthog-instance'
import { PostHog } from '../../../posthog-core'
import { PostHogConfig } from '../../../types'

describe('exception autocapture during startup', () => {
    let instance: PostHog | undefined
    let originalExtensions: typeof assignableWindow.__PosthogExtensions__
    const beforeSend = vi.fn(() => null)
    const loadExternalDependency = vi.fn()

    beforeEach(() => {
        originalExtensions = assignableWindow.__PosthogExtensions__
        assignableWindow.__PosthogExtensions__ = { loadExternalDependency }
    })

    afterEach(() => {
        instance?.exceptionObserver?.['_stopCapturing']()
        instance = undefined
        assignableWindow.__PosthogExtensions__ = originalExtensions
    })

    const triggerError = () =>
        window!.onerror?.call(window, 'startup error', 'app.js', 1, 1, new Error('startup error'))
    const triggerRejection = () =>
        window!.onunhandledrejection?.call(window, {
            reason: new TypeError('Importing a module script failed.'),
        } as PromiseRejectionEvent)

    const init = async (config: Partial<PostHogConfig> = {}) => {
        instance = await createPosthogInstance(undefined, {
            capture_exceptions: true,
            before_send: beforeSend,
            ...config,
        })
    }

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

    it('waits for remote enablement when capture_exceptions is unspecified', async () => {
        await init({ capture_exceptions: undefined })
        triggerError()
        triggerRejection()
        expect(beforeSend).not.toHaveBeenCalled()

        instance!._onRemoteConfig({ ok: true, config: createRemoteConfig({ autocaptureExceptions: true }) })
        triggerError()
        expect(beforeSend).toHaveBeenCalledTimes(1)
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
