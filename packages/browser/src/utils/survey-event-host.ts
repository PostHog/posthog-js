import type { PostHog } from '../posthog-core'
import type { SurveyEventHost } from '@posthog/browser-common/survey-event-host'

export const createSurveyEventHost = (instance?: PostHog): SurveyEventHost => ({
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
