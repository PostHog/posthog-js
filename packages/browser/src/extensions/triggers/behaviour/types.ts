import type { PostHog } from '../../../posthog-core'
import type { PersistenceHelper } from './persistence'

export interface TriggerOptions {
    readonly posthog: PostHog
    readonly window: Window | undefined
    readonly persistence: PersistenceHelper
}

export interface Trigger {
    readonly name: string
    matches(sessionId: string): boolean | null
    clearPersistedState(): void
}
