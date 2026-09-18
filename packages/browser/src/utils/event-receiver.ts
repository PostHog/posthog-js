import { EventReceiver as SharedEventReceiver } from '@posthog/browser-common/survey-event-receiver-base'
import type { EventTriggerable } from '@posthog/browser-common/survey-event-receiver-base'
import type { PostHog } from '../posthog-core'
import type { SurveyEventHost } from '@posthog/browser-common/survey-event-host'
const createEventReceiverHost = (instance?: PostHog): SurveyEventHost => ({
    get subscribeCapture() {
        return instance?._addCaptureHook
            ? (listener: Parameters<NonNullable<SurveyEventHost['subscribeCapture']>>[0]) =>
                  instance._addCaptureHook(listener)
            : undefined
    },
    subscribeSession: (listener) => instance?.onSessionId?.(listener) ?? (() => {}),
    getSessionId: () => instance?.get_session_id?.(),
    getProperty: (key) => instance?.persistence?.props[key],
    setElementSelectors: (selectors) => instance?.autocapture?.setElementSelectors(selectors),
})

export type { EventTriggerable, ActivationOutcome } from '@posthog/browser-common/survey-event-receiver-base'

export abstract class EventReceiver<T extends EventTriggerable> extends SharedEventReceiver<T> {
    protected readonly _instance: PostHog
    constructor(instance: PostHog) {
        super(createEventReceiverHost(instance))
        this._instance = instance
        this._subscribeSession()
    }
}
