import type { BrowserLogsConfig } from '@posthog/browser-common/logs-config'

export type LogsOptions = BrowserLogsConfig
export type LogsConfiguration = false | LogsOptions
export type { CaptureLogOptions } from '@posthog/types'

/** Snapshot mutable configuration while retaining callable beforeSend hooks. */
export const snapshotLogsOptions = (options: LogsOptions = {}): LogsOptions => ({
    ...options,
    ...(options.resourceAttributes ? { resourceAttributes: { ...options.resourceAttributes } } : {}),
    ...(Array.isArray(options.beforeSend) ? { beforeSend: [...options.beforeSend] } : {}),
})
