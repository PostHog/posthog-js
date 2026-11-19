import type { Client, Disposable } from '@posthog/browser-common'
import { PostHogSurveys, SurveyEventName, SurveyEventProperties } from '@posthog/browser-common/surveys'
import { type SurveysConfigSource, type SurveysManager } from '@posthog/browser-common/surveys-config'
import type { SurveyRenderContext } from '@posthog/browser-common/survey-render-context'
import { DEFAULT_DISPLAY_SURVEY_OPTIONS, setSurveySeenOnLocalStorage } from '@posthog/browser-common/utils/survey-utils'
import { SurveyEventReceiver } from '@posthog/browser-common/survey-event-receiver'
import { getTargetingUrl } from '@posthog/browser-common/utils/url-targeting-utils'
import type { AnalyticsTeardownSubscription } from '../analytics/analytics-internal'
import { analyticsOf } from '../analytics/analytics-of'
import type { FlagsExtension } from '../flags/flags-internal'
import type { FeatureFlags } from '../flags/flags-token'
import type { SurveysExtension } from './surveys-internal'
import type { IPostHog } from '../../core/types'
import {
    snapshotSurveysOptions,
    type SurveysOptions,
    type SurveyCallback,
    type Survey,
    type SurveyRenderReason,
} from './surveys-options'

type Renderer = { generateSurveys(host: SurveyRenderContext, enabled: boolean): SurveysManager | undefined }

// Captured events after which matching surveys can change: URL targeting, cooldowns and seen state.
const MATCHING_CONDITION_EVENTS: readonly string[] = [
    '$pageview',
    SurveyEventName.SHOWN,
    SurveyEventName.DISMISSED,
    SurveyEventName.SENT,
]

export const createSurveys = (options: SurveysOptions, load: () => Promise<Renderer>): SurveysExtension => {
    const config = snapshotSurveysOptions(options)
    let elementSelectors = new Set<string>()
    let eventReceiver: SurveyEventReceiver | undefined
    const replaceTriggers = (surveys: Survey[]) => eventReceiver?.replace(surveys)
    let client: IPostHog | undefined
    let runtimeHost: SurveyRenderContext | undefined
    let remoteEnabled = false
    let manual = false
    let disposed = false
    const pendingEligibility = new Set<(reason: SurveyRenderReason) => void>()
    let manager: SurveysManager | undefined
    let renderer: Renderer | undefined
    let loading: Promise<Renderer> | undefined
    let remoteSubscription: Disposable | undefined
    let resetSubscription: Disposable | undefined
    let seenSubscription: Disposable | undefined
    const getFlagsContext = () => (client?.featureFlags as FlagsExtension | undefined)?.getSurveyContext?.()
    const reset = () => {
        shared.reset()
    }
    const loadRenderer = () => (loading ??= load().then((value) => (renderer = value)))
    const source: SurveysConfigSource = {
        get: () => ({
            disableSurveys: disposed,
            cookielessMode: false,
            advancedEnableSurveys: manual,
            requestTimeoutMs: config.requestTimeoutMs ?? 10000,
            prefillFromUrl: config.prefillFromUrl ?? false,
            automaticDisplay: config.automaticDisplay ?? true,
            featureFlagEvaluation: getFlagsContext()?.remoteEvaluation ?? false,
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
        onMatchingConditionsChanged: (callback) => {
            const subscriptions: Disposable[] = []
            if (client) {
                subscriptions.push(
                    client.onEvent(({ event }) => {
                        if (MATCHING_CONDITION_EVENTS.includes(event)) callback()
                    })
                )
            }
            // Rendering updates cooldown state even when shown-event telemetry is not captured.
            const onShown = () => callback()
            // oxlint-disable-next-line posthog-js/no-add-event-listener
            if (typeof window !== 'undefined') window.addEventListener('PHSurveyShown', onShown)
            // onFeatureFlags can deliver its current value while subscribing; the shared subscription
            // establishes its own initial value, so only later flag changes notify.
            let listening = false
            let stopped = false
            const subscribeToFlags = (flags: FeatureFlags) => {
                subscriptions.push(
                    flags.onFeatureFlags(() => {
                        if (listening) callback()
                    })
                )
                listening = true
            }
            const flags = client?.featureFlags
            if (flags) subscribeToFlags(flags)
            else if (client) {
                // Flags installed after this subscription can still change the matching set.
                void client.resolveExtension('featureFlags').then(
                    (installed) => {
                        if (stopped || !installed) return
                        subscribeToFlags(installed)
                        callback()
                    },
                    () => {}
                )
            }
            return () => {
                stopped = true
                listening = false
                subscriptions.splice(0).forEach((subscription) => subscription.dispose())
                if (typeof window !== 'undefined') window.removeEventListener('PHSurveyShown', onShown)
            }
        },
    }
    const shared = new (class extends PostHogSurveys {
        protected override _createEventReceiver(value: Client, onActivationChanged?: () => void): SurveyEventReceiver {
            eventReceiver = new SurveyEventReceiver(
                value,
                this,
                {
                    getActionUrl: () => (runtimeHost ? getTargetingUrl(runtimeHost) : undefined),
                    setElementSelectors: (selectors) => {
                        elementSelectors = new Set(selectors)
                        client?.autocapture?.setElementSelectors(new Set(elementSelectors))
                    },
                },
                onActivationChanged
            )
            return eventReceiver
        }
        protected override _registerSurveyTriggers(surveys: Survey[]): void {
            replaceTriggers(surveys)
        }
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
    const subscribe = (callback: SurveyCallback, listen: (notify: SurveyCallback) => () => void): Disposable => {
        let active = true
        const notify = deliver((surveys, context) => {
            if (active) callback(surveys, context)
        })
        const unsubscribe = listen(notify)
        if (!client || typeof document === 'undefined') {
            notify([], { isLoaded: false, error: 'Survey renderer unavailable' })
        } else if (!disposed) {
            manual = true
            try {
                // Loading delivers the initial result; shared initialization owns load failures as well as success.
                shared.loadIfEnabled()
            } catch (error) {
                client.logger.error('Survey renderer loading failed', error)
            }
        }
        return {
            dispose: () => {
                active = false
                unsubscribe()
            },
        }
    }
    let teardownSubscription: AnalyticsTeardownSubscription | undefined
    const pagehide = () => {
        if (!teardownSubscription?.deliveryAvailable) shared.handlePageUnload()
    }
    return {
        name: 'surveys',
        setup: async (value: IPostHog) => {
            client = value
            await value.kv.initialize()
            if (disposed) return
            resetSubscription = value.onReset(reset)
            // Like posthog-js capture, record seen state for any captured dismissal or response, including
            // those from an application's own survey UI. Registered first so matching re-evaluation sees it.
            seenSubscription = value.onEvent(({ event, properties }) => {
                if (event !== SurveyEventName.DISMISSED && event !== SurveyEventName.SENT) return
                const id = properties[SurveyEventProperties.SURVEY_ID]
                const iteration = properties[SurveyEventProperties.SURVEY_ITERATION]
                if (typeof id !== 'string') return
                setSurveySeenOnLocalStorage({
                    id,
                    // oxlint-disable-next-line posthog-js/no-direct-number-check
                    current_iteration: typeof iteration === 'number' ? iteration : null,
                })
            })
            runtimeHost = {
                client: value,
                get config() {
                    return source.get()
                },
                surveys: shared,
            }
            remoteSubscription = value.onRemoteConfig((result) => {
                if (result.ok) {
                    const surveys = result.config.surveys
                    remoteEnabled = surveys === true || (Array.isArray(surveys) && surveys.length > 0)
                    if (remoteEnabled && !disposed) manager?.startAutomaticDisplay?.()
                }
            })
            await shared.setup(value)
            if (disposed) {
                shared.dispose()
                return
            }
            teardownSubscription = analyticsOf(value)?.onBeforeTeardown(() => shared.handlePageUnload())
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
            new Promise<SurveyRenderReason>((resolve, reject) => {
                const finish = (reason: SurveyRenderReason) => {
                    pendingEligibility.delete(finish)
                    resolve(reason)
                }
                if (disposed) {
                    finish({ visible: false, disabledReason: 'Surveys unavailable' })
                    return
                }
                pendingEligibility.add(finish)
                void (async (): Promise<SurveyRenderReason> => {
                    if (!(await ensureRenderer()))
                        return { visible: false, disabledReason: 'Survey renderer unavailable' }
                    return shared.canRenderSurveyAsync(id, forceReload ?? false)
                })().then(finish, (error) => {
                    pendingEligibility.delete(finish)
                    reject(error)
                })
            }),
        onSurveysLoaded: (callback) => subscribe(callback, (notify) => shared.onSurveysLoaded(notify)),
        onActiveMatchingSurveysChanged: (callback) =>
            subscribe(callback, (notify) => shared.onActiveMatchingSurveysChanged(notify)),
        getElementSelectors: () => new Set(elementSelectors),
        cancelPendingSurvey: (id) => {
            if (!disposed) shared.cancelPendingSurvey(id)
        },
        reset,
        dispose: () => {
            if (disposed) return
            disposed = true
            elementSelectors.clear()
            try {
                client?.autocapture?.setElementSelectors(new Set())
            } catch (error) {
                client?.logger.error('Failed to clear survey action selectors', error)
            }
            for (const finish of pendingEligibility) {
                finish({ visible: false, disabledReason: 'Surveys unavailable' })
            }
            remoteSubscription?.dispose()
            resetSubscription?.dispose()
            seenSubscription?.dispose()
            if (typeof window !== 'undefined') window.removeEventListener('pagehide', pagehide)
            teardownSubscription?.dispose()
            shared.dispose()
        },
    }
}
