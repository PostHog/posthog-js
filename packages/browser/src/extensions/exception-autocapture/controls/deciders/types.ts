import { PostHog } from '@posthog/types'
import { ErrorTrackingAutoCaptureControls } from '../../../../types'

export interface DeciderContext {
    readonly posthog: PostHog
    readonly window: Window | undefined
    readonly config: ErrorTrackingAutoCaptureControls | undefined
    readonly log: (message: string, data?: Record<string, unknown>) => void
}

export interface Decider {
    readonly name: string

    init(context: DeciderContext): void
    shouldCapture(): boolean | null
}
