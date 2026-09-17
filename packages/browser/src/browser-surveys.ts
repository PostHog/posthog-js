import { addEventListener } from '@posthog/browser-common/utils/general-utils'
import { SurveyEventName } from './posthog-surveys-types'
import type { PostHog } from './posthog-core'
import { PostHogSurveys } from '@posthog/browser-common/surveys'
import type { SurveysConfig, SurveysConfigSource, SurveysExtensionHost } from './surveys-config'
import { assignableWindow, window } from './utils/globals'
import { SurveyEventReceiver } from './utils/survey-event-receiver'

class BrowserSurveysConfigSource implements SurveysConfigSource {
    constructor(private readonly _instance: PostHog) {}

    get(): SurveysConfig {
        const config = this._instance.config
        return {
            disableSurveys: config.disable_surveys,
            cookielessMode: !!config.cookieless_mode,
            advancedEnableSurveys: config.advanced_enable_surveys,
            requestTimeoutMs: config.surveys_request_timeout_ms,
        }
    }

    getExtensions(): SurveysExtensionHost | undefined {
        const extensions = assignableWindow?.__PosthogExtensions__
        if (!extensions) {
            return
        }
        const { generateSurveys, loadExternalDependency } = extensions
        return {
            generateSurveys: generateSurveys
                ? (isSurveysEnabled) => generateSurveys(this._instance, isSurveysEnabled)
                : undefined,
            loadExternalDependency: loadExternalDependency
                ? (callback) => loadExternalDependency(this._instance, 'surveys', callback)
                : undefined,
        }
    }

    createEventReceiver(onActivationChanged: () => void): SurveyEventReceiver {
        return new SurveyEventReceiver(this._instance, onActivationChanged)
    }

    onMatchingConditionsChanged(callback: () => void): () => void {
        const unsubscribeCapture = this._instance._addCaptureHook((event) => {
            // Capture hooks run from `eventCaptured`, after `PostHog.capture` has applied
            // survey seen-state for dismissal/submission lifecycle events. Re-evaluate here
            // so untargeted surveys are removed immediately as well as event/action surveys.
            if (
                event === '$pageview' ||
                event === SurveyEventName.SHOWN ||
                event === SurveyEventName.DISMISSED ||
                event === SurveyEventName.SENT
            ) {
                callback()
            }
        })
        // Rendering updates cooldown state even when shown-event telemetry is suppressed.
        const onShown = () => callback()
        addEventListener(window, 'PHSurveyShown', onShown)
        // onFeatureFlags may synchronously deliver its cached value while registering.
        // The subscription establishes its own initial value after these hooks are attached.
        let listening = false
        const unsubscribeFlags = this._instance.onFeatureFlags(() => {
            if (listening) {
                callback()
            }
        })
        listening = true
        return () => {
            listening = false
            unsubscribeCapture()
            unsubscribeFlags()
            window?.removeEventListener('PHSurveyShown', onShown)
        }
    }
}

/** Browser-v1 compatibility wrapper for the shared surveys extension. */
export class BrowserSurveys extends PostHogSurveys {
    declare _surveyEventReceiver: SurveyEventReceiver | null

    constructor(instance: PostHog) {
        super(new BrowserSurveysConfigSource(instance))
    }
}
