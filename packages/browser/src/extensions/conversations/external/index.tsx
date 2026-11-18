import { stripUrlHash } from '@posthog/core'
import type { ConversationsRemoteConfig } from '@posthog/browser-common'
import {
    ConversationsManager as SharedConversationsManager,
    initConversations as initSharedConversations,
} from '@posthog/browser-common/conversations-renderer'
import type { ConversationsHost } from '@posthog/browser-common/conversations-renderer'
import { window } from '@posthog/browser-common/utils/globals'
import { PostHog } from '../../../posthog-core'
import { STORED_PERSON_PROPERTIES_KEY } from '../../../constants'
import { ConversationsPersistence } from './persistence'
import type { ConversationsManager as ConversationsManagerInterface } from '../posthog-conversations'

/** Adapts a posthog-js instance to the shared conversations manager. */
export const createConversationsHost = (posthog: PostHog): ConversationsHost => ({
    _getDistinctId: () => posthog.get_distinct_id(),
    _getSessionId: () => posthog.get_session_id(),
    _getSessionReplayUrl: () => posthog.get_session_replay_url({ withTimestamp: true, timestampLookBack: 30 }),
    _getCurrentUrl: () => {
        const href = window?.location?.href
        return posthog.config.disable_capture_url_hashes ? stripUrlHash(href) : href
    },
    _isIdentified: () => posthog._isIdentified(),
    _getPersonProperties: () => posthog.get_property(STORED_PERSON_PROPERTIES_KEY) as Record<string, any> | undefined,
    _getRegisteredProperty: (name) => posthog.persistence?.props?.[name],
    _getIdentity: () => {
        const { identity_distinct_id: distinctId, identity_hash: hash, identity_claims: claims } = posthog.config
        return distinctId && hash ? { distinctId, hash, claims } : undefined
    },
    _getTheme: () => posthog.config.conversations?.theme,
    _capture: (...args) => {
        posthog.capture(...args)
    },
    _sendRequest: (request) =>
        posthog._send_request({ ...request, url: posthog.requestRouter.endpointFor('api', request.path) }),
    _onIdentify: (listener) =>
        posthog.on('eventCaptured', (event: any) => {
            if (event.event === '$identify') {
                listener()
            }
        }),
    _stylesheetContext: posthog,
})

export class ConversationsManager extends SharedConversationsManager implements ConversationsManagerInterface {
    constructor(config: ConversationsRemoteConfig, posthog: PostHog) {
        super(config, createConversationsHost(posthog), new ConversationsPersistence(posthog))
    }
}

/**
 * Initialize the conversations widget.
 * This is the entry point called from the lazy-loaded bundle.
 *
 * The toolbar's internal PostHog instance is excluded upstream (see loadIfEnabled),
 * so the page's single manager always belongs to the customer's main instance.
 */
export function initConversations(config: ConversationsRemoteConfig, posthog: PostHog): ConversationsManager {
    return initSharedConversations(() => new ConversationsManager(config, posthog)) as ConversationsManager
}
