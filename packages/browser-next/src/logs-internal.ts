import type { Extension } from '@posthog/browser-common'
import type { CaptureLogOptions } from '@posthog/types'
export interface LogsExtension extends Extension {
    captureLog(options: CaptureLogOptions): void
    flush(): Promise<void>
    reset(): void
}
