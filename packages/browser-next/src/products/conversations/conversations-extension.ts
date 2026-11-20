import type { ConversationsRemoteConfig, Disposable } from '@posthog/browser-common'
import { STORED_PERSON_PROPERTIES_KEY } from '@posthog/browser-common/constants'
import type {
    ConversationsHost,
    ConversationsIdentity,
    ConversationsManager,
} from '@posthog/browser-common/conversations-renderer'
import type { BrowserState } from '../../core/state/state'
import type { IPostHog } from '../../core/types'
import { analyticsOf } from '../analytics/analytics-core'
import { alias } from '../analytics/person'
import type {
    ConversationsExtension,
    ConversationsOptions,
    ConversationsTheme,
    ConversationsUnavailableReason,
} from './conversations-options'

type Renderer = typeof import('@posthog/browser-common/conversations-renderer')

const NOT_AVAILABLE = 'Conversations not available yet.'

export const loadConversationsRenderer = (): Promise<Renderer> =>
    import('@posthog/browser-common/conversations-renderer')

const stateOf = (posthog: IPostHog): BrowserState | undefined =>
    (posthog as unknown as { _state?: BrowserState })._state

const isIdentified = (posthog: IPostHog): boolean => stateOf(posthog)?.isIdentified === true

/** The current page URL without its fragment, which can carry tokens. */
const currentUrl = (): string | undefined => {
    try {
        return globalThis.location?.href.split('#')[0]
    } catch {
        return undefined
    }
}

/**
 * Like posthog-js, widget state lives under its own `ph_conv_<token>` local storage key, read on every access. The
 * widget session ID grants access to tickets, so it survives `storage: false`, other tabs' writes and an upgrade
 * from posthog-js.
 */
const localStorage = (): Storage | undefined => {
    try {
        return globalThis.localStorage
    } catch {
        return undefined
    }
}

/** Removes the widget state that `getConversationsStorageKey()` in the renderer chunk names. */
const removeStoredWidget = (token: string): void => {
    try {
        localStorage()?.removeItem('ph_conv_' + token)
    } catch {
        // Without usable storage there is no widget state to remove.
    }
}

/**
 * Starts the client with a verified identity, as posthog-js bootstraps `identity_distinct_id`: a visitor without
 * earlier sessions takes the ID without an `$identify` event, while one with earlier anonymous activity is identified
 * so that activity is linked. An identity that differs from an already identified person is ignored.
 */
const bootstrapIdentity = (posthog: IPostHog, distinctId: string): void => {
    const analytics = analyticsOf(posthog)
    const state = stateOf(posthog)
    if (!analytics || !state || !distinctId || distinctId === posthog.distinctId) return
    if (state.isIdentified) {
        posthog.logger.warn(
            'The conversations identity differs from the identified person. The existing identity is preserved. ' +
                'Call reset() before switching users.'
        )
    } else if (state.sessionId !== undefined) {
        // A persisted session means events were captured under the anonymous ID.
        posthog.identify(distinctId)
    } else {
        const previousDistinctId = state.distinctId
        state.identify(distinctId)
        analytics._identifyPublisher.publish({
            distinctId,
            previousDistinctId,
            wasIdentified: false,
            set: undefined,
            setOnce: undefined,
        })
    }
}

/** Callers pass a snapshot of the options they received. */
export const createConversations = (
    options: ConversationsOptions,
    load: () => Promise<Renderer>
): ConversationsExtension => {
    let client: IPostHog | undefined
    let disposed = false
    // Undefined until remote configuration says whether the project enables conversations.
    let enabled: boolean | undefined
    let remoteConfig: ConversationsRemoteConfig | undefined
    let remoteConfigOk: boolean | undefined
    let manager: ConversationsManager | undefined
    let initializing = false
    let loadFailed = false
    // Bumped by reset, opt-out and disposal so a renderer that finishes loading afterwards starts over.
    let generation = 0
    // open() or close() before the manager exists.
    let pendingPanelAction: 'open' | 'close' | undefined
    // Every setTheme() patch merged together, applied to managers created later. Reset keeps it.
    let theme: ConversationsTheme | undefined
    let identity: ConversationsIdentity | undefined = options.identity
    const subscriptions: Disposable[] = []

    const createHost = (posthog: IPostHog): ConversationsHost => ({
        _getDistinctId: () => posthog.distinctId,
        _getSessionId: () => posthog.session?.sessionId,
        _getSessionReplayUrl: () => undefined,
        _getCurrentUrl: currentUrl,
        _isIdentified: () => isIdentified(posthog),
        _getPersonProperties: () => posthog.kv.get<Record<string, unknown>>(STORED_PERSON_PROPERTIES_KEY),
        _getRegisteredProperty: (name) => posthog.getProperty(name),
        _getIdentity: () => identity,
        _getTheme: () => options.theme,
        _capture: (event, properties) => {
            posthog.capture(event, properties)
        },
        _sendRequest: ({ path, method, data, headers, timestampMode, callback }) => {
            const url = timestampMode ? `${path}${path.includes('?') ? '&' : '?'}_=${Date.now()}` : path
            // posthog-js's default deadline, so a stalled request fails instead of holding a poll open.
            posthog.sendRequest(url, { method, headers, timeoutMs: 60_000, ...(data ? { body: data } : {}) }).then(
                (response) => callback(response),
                (error: unknown) => callback({ statusCode: 0, error })
            )
        },
        _onIdentify: (listener) => {
            const subscription = posthog.onIdentify(() => listener())
            return () => subscription.dispose()
        },
        _stylesheetContext: options.prepareStylesheet,
    })

    const applyPendingPanelAction = (): void => {
        const action = pendingPanelAction
        pendingPanelAction = undefined
        if (action === 'open') manager?.open()
        else if (action === 'close') manager?.close()
    }

    const complete = (renderer: Renderer, posthog: IPostHog, config: ConversationsRemoteConfig): void => {
        let created: ConversationsManager | undefined
        try {
            const active = renderer.initConversations(
                () =>
                    (created = new renderer.ConversationsManager(
                        config,
                        createHost(posthog),
                        new renderer.ConversationsPersistence(
                            renderer.getConversationsStorageKey(posthog.projectToken),
                            localStorage
                        )
                    ))
            )
            loadFailed = false
            if (active !== created) {
                // The page has one widget. Only the client that created it controls and destroys it.
                posthog.logger.warn('Another PostHog client on this page already shows conversations.')
                return
            }
            manager = active
        } catch (error) {
            manager = undefined
            loadFailed = true
            posthog.logger.error('Error completing conversations initialization', error)
            return
        }
        if (theme) manager.setTheme(theme)
        applyPendingPanelAction()
    }

    const loadIfEnabled = (): void => {
        const posthog = client
        if (!posthog || manager || initializing || disposed || !enabled) return
        const config = remoteConfig
        if (!config?.token) {
            posthog.logger.error('Conversations enabled but missing token in remote config.')
            return
        }
        initializing = true
        const started = generation
        load().then(
            (renderer) => {
                initializing = false
                if (disposed) return
                if (started !== generation) return loadIfEnabled()
                complete(renderer, posthog, config)
            },
            (error: unknown) => {
                initializing = false
                if (disposed) return
                loadFailed = true
                posthog.logger.error('Could not load conversations', error)
            }
        )
    }

    const unload = (): void => {
        generation++
        manager?.destroy()
        manager = undefined
    }

    const onRemoteConfig = (ok: boolean, value: boolean | ConversationsRemoteConfig | undefined): void => {
        remoteConfigOk = ok
        if (!ok) return
        if (value === undefined || value === null) {
            pendingPanelAction = undefined
            return
        }
        // The project setting is either a flag or the widget configuration.
        remoteConfig = value === true || value === false ? undefined : value
        enabled = remoteConfig ? remoteConfig.enabled : value === true
        if (!enabled) pendingPanelAction = undefined
        loadIfEnabled()
    }

    const withManager = async <T>(operation: (manager: ConversationsManager) => Promise<T>): Promise<T | null> => {
        if (!manager) {
            client?.logger.warn(NOT_AVAILABLE)
            return null
        }
        return operation(manager)
    }

    return {
        name: 'conversations',
        setup: async (posthog: IPostHog) => {
            client = posthog
            await posthog.kv.initialize()
            if (disposed) return
            // As in posthog-js, the identity seeds the distinct ID only when setup bootstrap supplies none.
            if (identity && !(posthog as unknown as { _hasBootstrapDistinctId?: boolean })._hasBootstrapDistinctId) {
                bootstrapIdentity(posthog, identity.distinctId)
            }
            subscriptions.push(
                posthog.onReset(() => {
                    // Reset starts a fresh widget session for the next visitor, without a verified identity.
                    if (manager) manager.reset()
                    // Without a widget, for example while opted out or loading, the previous session is still stored.
                    else removeStoredWidget(posthog.projectToken)
                    manager = undefined
                    generation++
                    identity = undefined
                    loadFailed = false
                    pendingPanelAction = undefined
                    loadIfEnabled()
                }),
                posthog.onRemoteConfig((result) =>
                    onRemoteConfig(
                        result.ok,
                        result.ok
                            ? (result.config.conversations as boolean | ConversationsRemoteConfig | undefined)
                            : undefined
                    )
                )
            )
        },
        show: () => {
            if (!manager) {
                client?.logger.warn('Conversations not loaded yet.')
                return
            }
            manager.show()
        },
        hide: () => {
            if (pendingPanelAction === 'open') pendingPanelAction = undefined
            manager?.hide()
        },
        open: () => {
            if (!manager) {
                // The renderer loads after remote configuration. Keep the request instead of dropping it.
                pendingPanelAction = 'open'
                return
            }
            pendingPanelAction = undefined
            manager.open()
        },
        close: () => {
            if (!manager) {
                pendingPanelAction = 'close'
                return
            }
            pendingPanelAction = undefined
            manager.close()
        },
        setTheme: (patch) => {
            theme = { ...theme, ...patch, dark: { ...theme?.dark, ...patch?.dark } }
            manager?.setTheme(patch)
        },
        isAvailable: () => enabled === true && !!manager,
        getUnavailableReason: (): ConversationsUnavailableReason | null => {
            if (enabled === true && manager) return null
            if (remoteConfigOk === false) return 'remote_config_failed'
            if (enabled === undefined) return remoteConfigOk ? 'disabled_in_project' : 'remote_config_pending'
            if (!enabled) return 'disabled_in_project'
            if (!remoteConfig?.token) return 'missing_token'
            if (initializing) return 'initializing'
            if (loadFailed) return 'load_failed'
            return 'not_loaded'
        },
        isVisible: () => manager?.isVisible() ?? false,
        sendMessage: (message, userTraits, newTicket) =>
            withManager((current) => current.sendMessage(message, userTraits, newTicket)),
        getMessages: (ticketId, after) => withManager((current) => current.getMessages(ticketId, after)),
        markAsRead: (ticketId) => withManager((current) => current.markAsRead(ticketId)),
        getTickets: (ticketOptions) => withManager((current) => current.getTickets(ticketOptions)),
        requestRestoreLink: (email) => withManager((current) => current.requestRestoreLink(email)),
        restoreFromToken: (restoreToken) => withManager((current) => current.restoreFromToken(restoreToken)),
        restoreFromUrlToken: () => withManager((current) => current.restoreFromUrlToken()),
        getCurrentTicketId: () => manager?.getCurrentTicketId() ?? null,
        getWidgetSessionId: () => manager?.getWidgetSessionId() ?? null,
        setIdentity: (distinctId, hash) => {
            identity = { distinctId, hash }
            const posthog = client
            if (posthog && !disposed) {
                // Link the verified ID to the current person, as posthog-js does.
                if (distinctId === posthog.distinctId) posthog.identify(distinctId)
                else alias(posthog, distinctId)
            }
            manager?.setIdentity()
        },
        clearIdentity: () => {
            identity = undefined
            manager?.clearIdentity()
        },
        dispose: () => {
            if (disposed) return
            disposed = true
            for (const subscription of subscriptions.splice(0)) subscription.dispose()
            unload()
        },
    }
}
