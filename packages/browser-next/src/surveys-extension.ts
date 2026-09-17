import { STORED_PERSON_PROPERTIES_KEY } from '@posthog/browser-common/constants'
import type { Client, Disposable, KeyValueStore } from '@posthog/browser-common'
import { PostHogSurveys } from '@posthog/browser-common/surveys'
import { type SurveysConfigSource, type SurveysManager } from '@posthog/browser-common/surveys-config'
import type { SurveyRenderContext } from '@posthog/browser-common/survey-render-context'
import { DEFAULT_DISPLAY_SURVEY_OPTIONS } from '@posthog/browser-common/utils/survey-utils'
import type { AnalyticsExtension, AnalyticsTeardownSubscription } from './analytics-internal'
import type { SurveysExtension, SurveysHost } from './surveys-internal'
import {
    snapshotSurveysOptions,
    type SurveysOptions,
    type SurveyCallback,
    type SurveyRenderReason,
} from './surveys-options'
import { SurveysStorage } from './surveys-storage'

type Renderer = { generateSurveys(host: SurveyRenderContext, enabled: boolean): SurveysManager | undefined }

export const createSurveys = (options: SurveysOptions, load: () => Promise<Renderer>): SurveysExtension => {
    const config = snapshotSurveysOptions(options)
    let host: SurveysHost | undefined
    let client: Client | undefined
    let storage: SurveysStorage | undefined
    let runtimeHost: SurveyRenderContext | undefined
    let remoteEnabled = false
    let manual = false
    let disposed = false
    let finishDisposal!: () => void
    const disposal = new Promise<SurveyRenderReason>((resolve) => {
        finishDisposal = () => resolve({ visible: false, disabledReason: 'Surveys unavailable' })
    })
    let manager: SurveysManager | undefined
    let renderer: Renderer | undefined
    let loading: Promise<Renderer> | undefined
    let remoteSubscription: Disposable | undefined
    const loadRenderer = () => (loading ??= load().then((value) => (renderer = value)))
    const source: SurveysConfigSource = {
        get: () => ({
            disableSurveys: disposed,
            cookielessMode: false,
            advancedEnableSurveys: manual,
            requestTimeoutMs: config.requestTimeoutMs ?? 10000,
            prefillFromUrl: config.prefillFromUrl ?? false,
            automaticDisplay: config.automaticDisplay ?? true,
            featureFlagEvaluation: host?.getFlagsContext?.()?.remoteEvaluation ?? false,
            overrideLanguage: config.overrideDisplayLanguage,
            get_current_url: config.getCurrentUrl,
            prepareStylesheet: config.prepareStylesheet,
        }),
        getExtensions: () => ({
            generateSurveys:
                renderer && runtimeHost
                    ? () => {
                          manager = renderer!.generateSurveys(runtimeHost!, remoteEnabled)
                          if (!manager) throw new Error('Survey rendering requires a document')
                          return manager
                      }
                    : undefined,
            loadExternalDependency: (callback) => {
                void loadRenderer()
                    .then(() => {
                        if (!disposed) callback()
                    })
                    .catch((error) => {
                        loading = undefined
                        if (!disposed) callback(error)
                    })
            },
        }),

    }
    const shared = new (class extends PostHogSurveys {
        override loadIfEnabled(): void {
            if ((remoteEnabled || manual) && typeof document !== 'undefined') super.loadIfEnabled()
        }
    })(source)
    const ensureRenderer = async (): Promise<boolean> => {
        if (disposed || !client || typeof document === 'undefined') return false
        manual = true
        try {
            await loadRenderer()
            if (disposed) return false
            shared.loadIfEnabled()
            return true
        } catch (error) {
            loading = undefined
            client.logger.error('Survey renderer loading failed', error)
            return false
        }
    }
    const deliver =
        (callback: SurveyCallback): SurveyCallback =>
        (surveys, context) => {
            if (disposed) return
            try {
                callback(surveys, context)
            } catch (error) {
                client?.logger.error('Survey callback failed', error)
            }
        }
    const run = (callback: SurveyCallback, action: (callback: SurveyCallback) => void) => {
        const notify = deliver(callback)
        void ensureRenderer().then((ready) => {
            if (disposed) return
            try {
                if (ready) action(notify)
                else notify([], { isLoaded: false, error: 'Survey renderer unavailable' })
            } catch (error) {
                client?.logger.error('Survey operation failed', error)
            }
        })
    }
    let teardownSubscription: AnalyticsTeardownSubscription | undefined
    const pagehide = () => {
        if (!teardownSubscription?.deliveryAvailable) shared.handlePageUnload()
    }
    return {
        name: 'surveys',
        initialize: (value) => {
            host = value
        },
        setup: async (value) => {
            client = value
            storage = new SurveysStorage(host)
            await storage.kv.initialize()
            if (disposed) return
            const scoped = Object.create(value) as Client
            Object.defineProperty(scoped, 'kv', { value: storage.kv })
            const renderClient = Object.create(scoped) as Client
            const read = (key: string) => key === STORED_PERSON_PROPERTIES_KEY
                ? host?.getFlagsContext?.()?.personProperties
                : storage!.kv.get(key)
            const renderKv: KeyValueStore = {
                ...storage.kv,
                get: ((keys: string | readonly string[]) => typeof keys === 'string'
                    ? read(keys)
                    : Object.fromEntries(keys.map((key) => [key, read(key)]))) as KeyValueStore['get'],
            }
            Object.defineProperty(renderClient, 'kv', { value: renderKv })
            runtimeHost = { client: renderClient, get config() { return source.get() }, surveys: shared, storage }
            remoteSubscription = value.onRemoteConfig((result) => {
                if (result.ok) {
                    const surveys = result.config.surveys
                    remoteEnabled = surveys === true || (Array.isArray(surveys) && surveys.length > 0)
                    if (remoteEnabled && !disposed) manager?.startAutomaticDisplay?.()
                }
            })
            await shared.setup(scoped)
            if (disposed) {
                shared.dispose()
                return
            }
            teardownSubscription = client
                .getExtension<AnalyticsExtension>('analytics')
                ?.onBeforeTeardown?.(() => shared.handlePageUnload())
            // A missing delivery driver can admit abandonment, but cannot send during unload.
            // oxlint-disable-next-line posthog-js/no-add-event-listener
            if (typeof window !== 'undefined') window.addEventListener('pagehide', pagehide)
        },
        getSurveys: (callback, forceReload) => run(callback, (notify) => shared.getSurveys(notify, forceReload)),
        getActiveMatchingSurveys: (callback, forceReload) =>
            run(callback, (notify) => shared.getActiveMatchingSurveys(notify, forceReload)),
        displaySurvey: (id, settings) =>
            run(
                () => {},
                () =>
                    shared.getSurveys(() => {
                        if (!disposed) shared.displaySurvey(id, { ...DEFAULT_DISPLAY_SURVEY_OPTIONS, ...settings })
                    })
            ),
        canRenderSurvey: (id, forceReload) =>
            Promise.race([
                disposal,
                (async (): Promise<SurveyRenderReason> => {
                    if (!(await ensureRenderer()))
                        return { visible: false, disabledReason: 'Survey renderer unavailable' }
                    return shared.canRenderSurveyAsync(id, forceReload ?? false)
                })(),
            ]),
        onSurveysLoaded: (callback) => {
            let active = true
            const unsubscribe = shared.onSurveysLoaded((surveys, context) => {
                if (active) deliver(callback)(surveys, context)
            })
            void ensureRenderer()
            return {
                dispose: () => {
                    active = false
                    unsubscribe()
                },
            }
        },
        cancelPendingSurvey: (id) => {
            if (!disposed) shared.cancelPendingSurvey(id)
        },
        reset: () => {
            manager?.clearInMemoryInProgressSurveyState?.()
            shared._surveyEventReceiver?.reset()
            storage?.reset()
        },
        dispose: () => {
            disposed = true
            finishDisposal()
            remoteSubscription?.dispose()
            if (typeof window !== 'undefined') window.removeEventListener('pagehide', pagehide)
            teardownSubscription?.dispose()
            shared.dispose()
            storage?.dispose()
        },
    }
}
