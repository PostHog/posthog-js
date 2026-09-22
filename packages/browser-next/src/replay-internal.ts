import type { Extension } from '@posthog/browser-common'
import type { ReplayRecorderHost } from '@posthog/browser-common/replay/host'
import type { RequestRuntime } from './request'
import type { StorageLike } from './types'

/** The shared session owner only; recorder eligibility and implementation remain replay-owned. */
export type ReplaySessionHost = Pick<
    ReplayRecorderHost,
    'sessionActive' | 'sessionTimeoutMs' | 'checkSession' | 'onSessionChange' | 'canDrainOnStop'
>

export interface ReplayHostContext {
    runtime: RequestRuntime
    persistenceKey: string
    pendingStorage: StorageLike | undefined
    canDeliver(): boolean
    refreshRemoteConfig(): void
}

export interface ReplayExtension extends Extension {
    initialize(host: ReplaySessionHost, context: ReplayHostContext): void
    /** Connect pending subscriptions after configured peer extensions have installed. */
    connectFlags?(): void
    consentChanged?(allowed: boolean): void
    beforeReset?(): void
    afterReset?(): void
    flush?(shutdown?: boolean): Promise<void>
}
