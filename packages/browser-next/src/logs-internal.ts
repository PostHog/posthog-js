import type { Extension } from '@posthog/browser-common'
import type { CaptureLogOptions } from '@posthog/types'
import type { RequestRuntime } from './request'

/** Package-private transport authority; logs own their queue and delivery policy. */
export interface LogsHost {
    runtime: RequestRuntime
    canSend(): boolean
    lastActivityTimestamp(): number | undefined
}

export interface LogsExtension extends Extension {
    initialize(host: LogsHost): void
    captureLog(options: CaptureLogOptions): void
    flush(): Promise<void>
    reset(): void
}
