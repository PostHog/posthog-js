import type { PostHog } from './posthog-core'
import { PostHogSurveys } from '@posthog/browser-common/surveys'
import type { SurveysConfig, SurveysConfigSource, SurveysExtensionHost } from './surveys-config'
import { assignableWindow } from './utils/globals'
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

    createEventReceiver(): SurveyEventReceiver {
        return new SurveyEventReceiver(this._instance)
    }
}

/** Browser-v1 compatibility wrapper for the shared surveys extension. */
export class BrowserSurveys extends PostHogSurveys {
    declare _surveyEventReceiver: SurveyEventReceiver | null

    constructor(instance: PostHog) {
        super(new BrowserSurveysConfigSource(instance))
    }
}
