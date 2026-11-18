import {
    AUTOCAPTURE_DISABLED_SERVER_SIDE,
    EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE,
    WEB_VITALS_ENABLED_SERVER_SIDE,
} from '@posthog/browser-common/constants'
import { SURVEYS } from '@posthog/browser-common/surveys-config'
import type { DeepReadonly } from '@posthog/browser-common'
import { snapshotAutocaptureOptions } from '../../products/autocapture/autocapture-options'
import { snapshotSurveysOptions } from '../../products/surveys/surveys-options'
import { snapshotLogsOptions } from '../../products/logs/logs-options'
import { snapshotTracingHeadersOptions } from '../../products/tracing-headers/tracing-headers-options'
import { snapshotConversationsOptions } from '../../products/conversations/conversations-options'
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

const configureErrorTracking = (options: PostHogOptions): ProductDefinition | undefined => {
    const configuration = options?.errorTracking
    if (configuration === false) return
    const snapshot = configuration && JSON.parse(JSON.stringify(configuration))
    return {
        load: () =>
            import('../../products/error-tracking/error-tracking').then(({ errorTracking }) => errorTracking(snapshot)),
        activate:
            configuration === undefined
                ? activateFromSignals(
                      (host) => host.kv.get(EXCEPTION_CAPTURE_ENABLED_SERVER_SIDE) === true,
                      (config) => !!config.autocaptureExceptions
                  )
                : undefined,
    }
}

const configureConversations = (options: PostHogOptions): ProductDefinition | undefined => {
    const configuration = options?.conversations
    if (configuration === false) return
    const snapshot = snapshotConversationsOptions(configuration)
    return {
        load: () =>
            import('../../products/conversations/conversations-extension').then(
                ({ createConversations, loadConversationsRenderer }) =>
                    createConversations(snapshot, loadConversationsRenderer)
            ),
        activate:
            configuration === undefined
                ? activateFromSignals(
                      () => false,
                      ({ conversations }) =>
                          conversations === true ||
                          (typeof conversations === 'object' && conversations?.enabled === true)
                  )
                : undefined,
    }
}

const isToolbarAuthorization = (state: string, decode: (value: string) => string): boolean => {
    try {
        return JSON.parse(decode(decodeURIComponent(state)))?.action === 'ph_authorize'
    } catch {
        return false
    }
}

// Read the toolbar signals when the client is created, before an application router can replace the URL hash.
const configureToolbar = (options: PostHogOptions): ProductDefinition | undefined => {
    const configuration = options?.toolbar
    if (configuration === false) return
    const snapshot = { ...configuration }
    let stateHash: string | null = null
    let signal = false
    try {
        // Inline equivalents of the shared toolbar helpers keep the toolbar module out of the initial chunk.
        const hash = globalThis.location?.hash ?? ''
        stateHash = /(?:^|[#&?])__posthog=([^&]*)/.exec(hash)?.[1] || /(?:^|[#&?])state=([^&]*)/.exec(hash)?.[1] || null
        // Only a toolbar authorization counts, so an unrelated `state` parameter such as OAuth's loads nothing.
        signal =
            (!!stateHash &&
                (isToolbarAuthorization(stateHash, atob) || isToolbarAuthorization(stateHash, (value) => value))) ||
            !!globalThis.localStorage?.getItem('_postHogToolbarParams')
    } catch {
        // Unavailable location or storage leaves the toolbar to explicit loading.
    }
    return {
        load: () =>
            import('../../products/toolbar/toolbar-extension').then(({ createToolbar }) =>
                createToolbar(snapshot, stateHash)
            ),
        activate: (_host, acquire) => {
            // Initialization does not wait for the toolbar.
            if (signal) void acquire()
        },
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
    registerProduct(composition, 'errorTracking', 'error tracking', () => configureErrorTracking(options))
    registerProduct(composition, 'conversations', 'conversations', () => configureConversations(options))
    registerProduct(composition, 'toolbar', 'toolbar', () => configureToolbar(options))
    return composition
}
