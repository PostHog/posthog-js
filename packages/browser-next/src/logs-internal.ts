import type { BrowserExtension } from './browser-client'
import type { CaptureLogOptions } from '@posthog/types'
export interface LogsExtension extends BrowserExtension {
    captureLog(options: CaptureLogOptions): void
    flush(): Promise<void>
    reset(): void
}
