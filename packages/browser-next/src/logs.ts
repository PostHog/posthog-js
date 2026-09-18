import type { Client, Extension } from '@posthog/browser-common'
import { PostHogLogs } from '@posthog/browser-common/logs'
import type { ConsoleLogsLoader } from '@posthog/browser-common/logs-types'
import { initializeLogs, replayConsoleBuffer } from '@posthog/browser-common/console-logs'
import type { ConsoleLogsHost } from '@posthog/browser-common/console-logs'
import type { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import type { LogsExtension } from './logs-internal'
import { snapshotLogsOptions, type LogsOptions } from './logs-options'

export type { LogsOptions, CaptureLogOptions } from './logs-options'

/** Include logs and console capture statically instead of loading the product at initialization. */
export const logs = (options: LogsOptions = {}): Extension => {
    const config = snapshotLogsOptions(options)
    let client: Client | undefined
    let window: (Window & typeof globalThis) | undefined
    let lastActivityTimestamp: (() => number | undefined) | undefined
    let disposed = false
    const shared = new (class extends PostHogLogs {
        protected override _getSdkContext() {
            const value = client!
            const context = super._getSdkContext()
            if (context.sessionId) {
                const lastActivity = lastActivityTimestamp?.()
                if (lastActivity !== undefined) context.lastActivityTimestamp = lastActivity
            }
            try {
                const href = window?.location?.href
                if (href) context.currentUrl = href.split('#')[0]!
            } catch {
                /* Unavailable location is omitted. */
            }
            const keys = value.getExtension<PostHogFeatureFlags>('featureFlags')?.getFlags?.()
            if (keys?.length) context.activeFeatureFlags = keys
            return context
        }

        protected override _getConsoleLoader(): ConsoleLogsLoader | undefined {
            const console = window?.console
            if (!console) return undefined
            const consoleHost: ConsoleLogsHost = {
                console,
                hostname: window?.location?.host ?? '',
                getCapturingLogs: () => (!disposed && client?.canCapture ? shared : undefined),
            }
            return (callback) =>
                callback(undefined, {
                    initialize: () => initializeLogs(consoleHost),
                    replay: (_client, entries) => replayConsoleBuffer(consoleHost, entries),
                })
        }
    })({ get: () => config, captureHintKey: 'consoleCaptureEnabled', remoteConfigWillArrive: true })
    const pagehide = () => {
        if (!disposed) shared.flushLogs('sendBeacon')
    }
    const extension: LogsExtension = {
        name: 'logs',
        initialize: (value) => {
            lastActivityTimestamp = value
        },
        setup: async (value) => {
            client = value
            try {
                window = globalThis.window
            } catch {
                /* Non-browser host. */
            }
            await shared.setup(value)
            if (disposed) return
            // oxlint-disable-next-line posthog-js/no-add-event-listener
            window?.addEventListener('pagehide', pagehide)
        },
        captureLog: (record) => {
            if (!disposed && client?.canCapture) shared.captureLog(record)
        },
        flush: async () => {
            if (!disposed) await shared.flush()
        },
        reset: () => shared.reset(),
        dispose: () => {
            disposed = true
            try {
                window?.removeEventListener('pagehide', pagehide)
            } finally {
                try {
                    shared.reset()
                } finally {
                    shared.dispose()
                    client = undefined
                }
            }
        },
    }
    return extension
}
