import type { Extension } from '@posthog/browser-common'
import type { ReplayRecorderHost } from '@posthog/browser-common/replay/host'

/** The shared session owner only; recorder eligibility and implementation remain replay-owned. */
export type ReplaySessionHost = Pick<
    ReplayRecorderHost,
    'sessionActive' | 'sessionTimeoutMs' | 'checkSession' | 'onSessionChange'
>

export interface ReplayExtension extends Extension {
    initialize(host: ReplaySessionHost): void
}
