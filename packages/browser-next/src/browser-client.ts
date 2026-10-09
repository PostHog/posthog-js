import type { Client, DeepReadonly, Listener } from '@posthog/browser-common'

export interface IdentifyInfo {
    readonly distinctId: string
    readonly previousDistinctId: string
    readonly wasIdentified: boolean
    readonly set: DeepReadonly<Record<string, unknown>> | undefined
    readonly setOnce: DeepReadonly<Record<string, unknown>> | undefined
}

export interface GroupInfo {
    readonly type: string
    readonly key: string
    readonly changed: boolean
    readonly properties: DeepReadonly<Record<string, unknown>> | undefined
}

/** Host capabilities supplied to browser-next extensions during setup. */
export interface BrowserClient extends Client {
    /** Fires after identification or person-property updates, independently of capture consent. Does not replay. */
    readonly onIdentify: Listener<IdentifyInfo>
    /** Fires after group membership or property updates, independently of capture consent. Does not replay. */
    readonly onGroup: Listener<GroupInfo>
    /** Fires after local identity and persisted extension state are reset. Does not replay. */
    readonly onReset: Listener<void>
}
