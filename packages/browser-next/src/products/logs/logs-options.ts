import type { BrowserLogsConfig } from '@posthog/browser-common/logs-config'

import type { UrlCaptureOptions } from '@posthog/browser-common/utils/sanitize-url'

export type { UrlCaptureOptions } from '@posthog/browser-common/utils/sanitize-url'

export interface LogsOptions extends BrowserLogsConfig {
    /** URL parts included in log context. Defaults to path only, without query parameters or fragments. */
    urlCapture?: UrlCaptureOptions
}
export type LogsConfiguration = false | LogsOptions
export type { CaptureLogOptions } from '@posthog/types'

/** Snapshot mutable configuration while retaining callable beforeSend hooks. */
export const snapshotLogsOptions = (options: LogsOptions = {}): LogsOptions => ({
    ...options,
    ...(options.urlCapture ? { urlCapture: { ...options.urlCapture } } : {}),
    ...(options.resourceAttributes ? { resourceAttributes: { ...options.resourceAttributes } } : {}),
    ...(Array.isArray(options.beforeSend) ? { beforeSend: [...options.beforeSend] } : {}),
})
