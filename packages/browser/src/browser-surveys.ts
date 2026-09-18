import type { PostHog } from './posthog-core'
import { PostHogSurveys } from '@posthog/browser-common/surveys'
import type { SurveysConfig, SurveysConfigSource, SurveysExtensionHost } from '@posthog/browser-common/surveys-config'
import type { SurveyRenderContext } from '@posthog/browser-common/survey-render-context'
import type { Client, Extension, ExtensionToken } from '@posthog/browser-common'
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

/** Released cores own survey orchestration; the lazy renderer only borrows their capabilities. */
class LegacySurveyClient extends BrowserClientAdapter {
    override readonly onEvent: Client['onEvent']
    constructor(instance: PostHog) {
        super(instance)
        this.onEvent = (handler) => ({
            dispose: instance._addCaptureHook((event, payload) => {
                if (payload) handler({ event, properties: payload.properties })
            }),
        })
    }

    override get canCapture(): boolean {
        // is_capturing was introduced in 1.260.0, alongside cookieless capture.
        return this.instance.is_capturing ? this.instance.is_capturing() : !this.instance.has_opted_out_capturing()
    }

    override get isOptedOut(): boolean {
        return this.instance.has_opted_out_capturing()
    }

    override getExtension<T extends Extension>(name: ExtensionToken<T>): T | undefined
    override getExtension<T extends Extension = Extension>(name: string): T | undefined
    override getExtension<T extends Extension = Extension>(name: string): T | undefined {
        // Old cores have the same scalar flags operations, but no shared extension registry.
        return (name === 'featureFlags'
            ? this.instance.featureFlags
            : name === 'autocapture'
              ? this.instance.autocapture
              : undefined) as unknown as T | undefined
    }
}

const legacyContexts = new WeakMap<PostHog, SurveyRenderContext>()

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
    let context = legacyContexts.get(instance)
    if (!context) {
        context = {
            client: new LegacySurveyClient(instance),
            get config() {
                return config.get()
            },
            surveys: instance.surveys,
        }
        legacyContexts.set(instance, context)
    }
    return context
}
