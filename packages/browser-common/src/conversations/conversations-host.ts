import type { ConversationsTheme } from '@posthog/types'

import type { StylesheetPreparationContext } from '../utils/stylesheet-loader'

/** A server-signed identity. The SDK forwards it and never signs anything in the browser. */
export interface ConversationsIdentity {
    /** The verified distinct ID. */
    readonly distinctId: string
    /** HMAC-SHA256 of `distinctId`, signed with the Secret API key from Support settings. */
    readonly hash: string
    /** Additional server-signed claims, forwarded only with `distinctId` and `hash`. */
    readonly claims?: Readonly<Record<string, { value: string; hash: string }>> | undefined
}

/** Response passed to {@link ConversationsHost._sendRequest} callbacks. */
export interface ConversationsResponse {
    readonly statusCode: number
    readonly json?: any
    readonly error?: unknown
}

export interface ConversationsRequest {
    /** Path on the API host, including any query string. */
    readonly path: string
    readonly method: 'GET' | 'POST'
    readonly data?: Record<string, any>
    readonly headers: Record<string, string>
    /** Add a cache-busting timestamp to the query string. */
    readonly timestampMode?: 'query'
    readonly callback: (response: ConversationsResponse) => void
}

/**
 * SDK dependencies of the shared conversations manager. Each SDK adapts its own client; the manager owns
 * requests, polling, widget rendering and its persisted state. Members start with `_` so bundles that mangle
 * private properties, like posthog-js's, shorten them.
 */
export interface ConversationsHost {
    _getDistinctId(): string
    _getSessionId(): string | undefined
    /** Replay URL for the current session, when the SDK records sessions. */
    _getSessionReplayUrl(): string | undefined
    /** The current page URL, shaped by the SDK's URL capture policy. */
    _getCurrentUrl(): string | undefined
    _isIdentified(): boolean
    /** Person properties the SDK stored locally, such as those set by identification. */
    _getPersonProperties(): Record<string, any> | undefined
    /** A registered event property. */
    _getRegisteredProperty(name: string): unknown
    /** The verified identity, if one is set. Read on every request. */
    _getIdentity(): ConversationsIdentity | undefined
    /** The theme configured at initialization. */
    _getTheme(): ConversationsTheme | undefined
    _capture(event: string, properties?: Record<string, unknown>): void
    _sendRequest(request: ConversationsRequest): void
    /** Subscribe to identification. Returns an unsubscribe function. */
    _onIdentify(listener: () => void): () => void
    readonly _stylesheetContext?: StylesheetPreparationContext | undefined
}
