import { AUTOCAPTURE_DISABLED_SERVER_SIDE } from '@posthog/browser-common/constants'
import { SURVEYS } from '@posthog/browser-common/surveys-config'
import type { DeepReadonly } from '@posthog/browser-common'
import { snapshotAutocaptureOptions } from '../../products/autocapture/autocapture-options'
import { snapshotSurveysOptions } from '../../products/surveys/surveys-options'
import { snapshotLogsOptions } from '../../products/logs/logs-options'
import { snapshotAutomaticAnalyticsOptions } from '../../products/analytics/analytics-options'
import type { AutomaticAnalyticsOptions } from '../../products/analytics/analytics-options'
import type { IPostHogInternal, BrowserExtension } from '../../core/context/browser-client'
import type { PostHogOptions, RemoteConfig } from '../../core/types'
import type { AutomaticExtension, ExtensionLoader } from '../../core/extensions/registry'

type Activation = AutomaticExtension<IPostHogInternal>['activate']
interface ProductDefinition {
    load: ExtensionLoader<IPostHogInternal>
    activate?: Activation | undefined
}
interface ProductComposition {
    extensions: BrowserExtension[]
    loaders: Record<string, ExtensionLoader<IPostHogInternal>>
    automatic: AutomaticExtension<IPostHogInternal>[]
    loadingErrors: Array<[string, unknown]>
}

const activateFromSignals =
    (
        hasSaved: (host: IPostHogInternal) => boolean,
        enabled: (config: DeepReadonly<RemoteConfig>) => boolean
    ): Activation =>
    (host, acquire) => {
        let loading: ReturnType<typeof acquire> | undefined
        host.onRemoteConfig((result) => {
            if (result.ok && enabled(result.config)) loading = acquire()
        })
        return hasSaved(host) ? acquire() : loading
    }

const registerProduct = (
    composition: ProductComposition,
    name: string,
    label: string,
    configure: () => ProductDefinition | undefined
): void => {
    if (composition.extensions.some((extension) => extension.name === name)) return
    try {
        const definition = configure()
        if (definition) {
            composition.loaders[name] = definition.load
            composition.automatic.push({ name, activate: definition.activate ?? ((_host, acquire) => acquire()) })
        }
    } catch (error) {
        composition.loadingErrors.push([label, error])
    }
}

const configureAnalytics = (options: PostHogOptions, composition: ProductComposition): AutomaticAnalyticsOptions => {
    let configuration: PostHogOptions['analytics']
    if (composition.extensions.some((extension) => extension.name === 'analytics')) configuration = false
    else {
        try {
            configuration = options?.analytics
        } catch {
            /* Product defaults remain available. */
        }
    }
    const snapshot = snapshotAutomaticAnalyticsOptions(configuration || {})
    if (configuration !== false) {
        composition.loaders.analytics = () =>
            import('../../products/analytics/automatic-analytics').then(({ analytics }) => analytics(snapshot))
    }
    return snapshot
}

const configureFlags = (options: PostHogOptions): ProductDefinition | undefined => {
    const configuration = options?.flags
    if (configuration === false) return
    const snapshot = configuration && JSON.parse(JSON.stringify(configuration))
    return { load: () => import('../../products/flags/flags').then(({ featureFlags }) => featureFlags(snapshot)) }
}

const configureLogs = (options: PostHogOptions): ProductDefinition | undefined => {
    const configuration = options?.logs
    if (configuration === false) return
    const snapshot = snapshotLogsOptions(configuration)
    return {
        load: () => import('../../products/logs/logs').then(({ logs }) => logs(snapshot)),
        activate:
            configuration === undefined
                ? activateFromSignals(
                      (host) => host.kv.get('consoleCaptureEnabled') === true,
                      (config) => config.logs?.captureConsoleLogs === true
                  )
                : undefined,
    }
}

const configureSurveys = (options: PostHogOptions): ProductDefinition | undefined => {
    const configuration = options?.surveys
    if (configuration === false) return
    const snapshot = snapshotSurveysOptions(configuration)
    return {
        load: () => import('../../products/surveys/automatic-surveys').then(({ surveys }) => surveys(snapshot)),
        activate:
            configuration === undefined
                ? activateFromSignals(
                      (host) => {
                          const cached = host.kv.get(SURVEYS)
                          return Array.isArray(cached) && cached.length > 0
                      },
                      (config) =>
                          config.surveys === true || (Array.isArray(config.surveys) && config.surveys.length > 0)
                  )
                : undefined,
    }
}

const configureAutocapture = (options: PostHogOptions): ProductDefinition | undefined => {
    const configuration = options?.autocapture
    if (configuration === false) return
    const snapshot = snapshotAutocaptureOptions(configuration)
    return {
        load: () => import('../../products/autocapture/autocapture').then(({ autocapture }) => autocapture(snapshot)),
        activate:
            configuration === undefined
                ? activateFromSignals(
                      (host) => host.kv.get(AUTOCAPTURE_DISABLED_SERVER_SIDE) === false,
                      (config) => config.autocapture_opt_out === false
                  )
                : undefined,
    }
}

export const createProductComposition = (options: PostHogOptions): ProductComposition => {
    const composition: ProductComposition = {
        extensions: [...(options?.extensions ?? [])],
        loaders: {},
        automatic: [],
        loadingErrors: [],
    }
    const analyticsOptions = configureAnalytics(options, composition)
    // Acquire during startup so Core starts eager delivery before factory readiness.
    if (analyticsOptions.load === 'eager') {
        composition.automatic.push({ name: 'analytics', activate: (_host, acquire) => acquire() })
    }
    registerProduct(composition, 'featureFlags', 'flags', () => configureFlags(options))
    registerProduct(composition, 'logs', 'logs', () => configureLogs(options))
    registerProduct(composition, 'surveys', 'surveys', () => configureSurveys(options))
    registerProduct(composition, 'autocapture', 'autocapture', () => configureAutocapture(options))
    return composition
}
