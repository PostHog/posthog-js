import { PostHog } from '@posthog/types'

export type LogFn = (message: string, data?: Record<string, unknown>) => void

export interface Trigger {
    readonly name: string
    shouldCapture(): boolean | null
}

export interface URLTriggerOptions {
    readonly window: Window | undefined
    readonly log: LogFn
}

export interface FlagTriggerOptions {
    readonly posthog: PostHog
    readonly log: LogFn
}

export interface EventTriggerOptions {
    readonly posthog: PostHog
    readonly log: LogFn
}

export interface SampleTriggerOptions {
    readonly log: LogFn
}
