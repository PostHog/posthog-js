import type { PostHog } from '@posthog/types'
import type { PersistenceHelperFactory } from './persistence'

export type LogFn = (message: string, data?: Record<string, unknown>) => void

export interface TriggerOptions {
    readonly posthog: PostHog
    readonly window: Window | undefined
    readonly log: LogFn
    readonly persistenceHelperFactory: PersistenceHelperFactory
}

export interface Trigger {
    readonly name: string
    matches(sessionId: string): boolean | null
}
