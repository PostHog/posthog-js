import type { PostHog } from './posthog-core'
import { PostHogSurveys } from '@posthog/browser-common/surveys'
import type { SurveysConfig, SurveysConfigSource, SurveysExtensionHost } from '@posthog/browser-common/surveys-config'
import type { SurveyRenderContext } from '@posthog/browser-common/survey-render-context'
import { assignableWindow } from './utils/globals'
import { BrowserClientAdapter } from './extensions/browser-client'

class BrowserSurveysConfigSource implements SurveysConfigSource {
    constructor(private readonly _instance?: PostHog) {}

    get(): SurveysConfig {
        const config = this._instance?.config
        return {
            disableSurveys: !!config?.disable_surveys,
            cookielessMode: !!config?.cookieless_mode,
            advancedEnableSurveys: !!config?.advanced_enable_surveys,
            requestTimeoutMs: config?.surveys_request_timeout_ms ?? 10000,
            prefillFromUrl: !!config?.surveys?.prefillFromUrl,
            automaticDisplay: !config?.disable_surveys_automatic_display,
            featureFlagEvaluation: !config?.advanced_disable_feature_flags,
            overrideLanguage: config?.override_display_language,
            prepareStylesheet: config?.prepare_external_dependency_stylesheet,
            get_current_url: config?.get_current_url,
            uiHost: this._instance?.requestRouter?.endpointFor('ui', ''),
        }
    }

    getExtensions(): SurveysExtensionHost | undefined {
        const extensions = assignableWindow?.__PosthogExtensions__
        if (!extensions || !this._instance) return
        const instance = this._instance
        const { generateSurveys, loadExternalDependency } = extensions
        return {
            generateSurveys: generateSurveys
                ? (isSurveysEnabled) => generateSurveys(instance, isSurveysEnabled)
                : undefined,
            loadExternalDependency: loadExternalDependency
                ? (callback) => loadExternalDependency(instance, 'surveys', callback)
                : undefined,
        }
    }
}

/** Browser-v1 configuration and lazy-loading adapter for the shared surveys extension. */
export class BrowserSurveys extends PostHogSurveys {
    constructor(instance: PostHog) {
        super(new BrowserSurveysConfigSource(instance))
    }
}

const compatibilityContexts = new WeakMap<PostHog, SurveyRenderContext>()

/** Called by the lazy bundle and preview entrypoint, never as a modern pre-setup fallback. */
export function getSurveyRenderContext(instance?: PostHog): SurveyRenderContext | undefined {
    const config = new BrowserSurveysConfigSource(instance)
    if (!instance)
        return {
            get config() {
                return config.get()
            },
        }
    if (instance.surveys?.getRenderContext) return instance.surveys.getRenderContext()
    let context = compatibilityContexts.get(instance)
    if (!context) {
        // Older posthog-js cores can load a newer surveys bundle. Adapt their existing
        // instances for lookup only; the core retains ownership of setup and disposal.
        context = {
            client: new BrowserClientAdapter(instance),
            get config() {
                return config.get()
            },
            surveys: instance.surveys,
        }
        compatibilityContexts.set(instance, context)
    }
    return context
}
