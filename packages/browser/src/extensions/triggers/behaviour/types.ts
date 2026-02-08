import type { PostHog } from '../../../posthog-core'
import type { PersistenceHelper } from './persistence'

export type LogFn = (message: string, data?: Record<string, unknown>) => void

export interface TriggerOptions {
    readonly posthog: PostHog
    readonly window: Window | undefined
    readonly log: LogFn
    readonly persistence: PersistenceHelper
}

export interface Trigger {
    readonly name: string
    init(): void
    matches(sessionId: string): boolean | null
}
