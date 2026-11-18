import { AUTOCAPTURE_DISABLED_SERVER_SIDE, WEB_VITALS_ENABLED_SERVER_SIDE } from '@posthog/browser-common/constants'
import { SURVEYS } from '@posthog/browser-common/surveys-config'
import type { DeepReadonly } from '@posthog/browser-common'
import { snapshotAutocaptureOptions } from '../../products/autocapture/autocapture-options'
import { snapshotSurveysOptions } from '../../products/surveys/surveys-options'
import { snapshotLogsOptions } from '../../products/logs/logs-options'
import { snapshotTracingHeadersOptions } from '../../products/tracing-headers/tracing-headers-options'
import type { BrowserExtension } from '../../core/context/browser-client'
import type { IPostHog, PostHogOptions, RemoteConfig } from '../../core/types'
import type { WebVitalsOptions } from '../../products/web-vitals/web-vitals-options'
import type { AutomaticExtension, ExtensionLoader } from '../../core/extensions/registry'

type Activation = AutomaticExtension<IPostHog>['activate']
interface ProductDefinition {
    load: ExtensionLoader<IPostHog>
    activate?: Activation | undefined
}
interface ProductComposition {
    extensions: BrowserExtension[]
    loaders: Record<string, ExtensionLoader<IPostHog>>
    automatic: AutomaticExtension<IPostHog>[]
    loadingErrors: Array<[string, unknown]>
}

const activateFromSignals =
    (hasSaved: (host: IPostHog) => boolean, enabled: (config: DeepReadonly<RemoteConfig>) => boolean): Activation =>
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

const configureFlags = (options: PostHogOptions): ProductDefinition | undefined => {
    const configuration = options?.flags
    if (configuration === false) return
    const snapshot = configuration && JSON.parse(JSON.stringify(configuration))
    return { load: () => import('../../products/flags/flags').then(({ flags }) => flags(snapshot)) }
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

const configureWebVitals = (options: PostHogOptions): ProductDefinition | undefined => {
    const configuration = options?.webVitals
    if (configuration === false || configuration?.enabled === false) return
    const snapshot: WebVitalsOptions | undefined = configuration && JSON.parse(JSON.stringify(configuration))
    return {
        load: () => import('../../products/web-vitals/web-vitals').then(({ webVitals }) => webVitals(snapshot)),
        activate:
            snapshot?.enabled === true
                ? undefined
                : activateFromSignals(
                      (host) => host.kv.get(WEB_VITALS_ENABLED_SERVER_SIDE) === true,
                      ({ capturePerformance }) =>
                          typeof capturePerformance === 'object' && capturePerformance?.web_vitals === true
                  ),
    }
}

const configureTracingHeaders = (options: PostHogOptions): ProductDefinition | undefined => {
    const snapshot = snapshotTracingHeadersOptions(options?.tracingHeaders)
    if (!snapshot) return
    return {
        load: () =>
            import('../../products/tracing-headers/tracing-headers').then(({ tracingHeaders }) =>
                tracingHeaders(snapshot)
            ),
    }
}

export const createProductComposition = (options: PostHogOptions): ProductComposition => {
    const composition: ProductComposition = {
        extensions: [...(options?.extensions ?? [])],
        loaders: {},
        automatic: [],
        loadingErrors: [],
    }
    registerProduct(composition, 'featureFlags', 'flags', () => configureFlags(options))
    registerProduct(composition, 'logs', 'logs', () => configureLogs(options))
    registerProduct(composition, 'surveys', 'surveys', () => configureSurveys(options))
    registerProduct(composition, 'autocapture', 'autocapture', () => configureAutocapture(options))
    registerProduct(composition, 'webVitals', 'web vitals', () => configureWebVitals(options))
    registerProduct(composition, 'tracingHeaders', 'tracing headers', () => configureTracingHeaders(options))
    return composition
}
