import type { Disposable } from '@posthog/browser-common'
import type { BrowserClient } from './browser-client'
import { PostHogLogs } from '@posthog/browser-common/logs'
import type { ConsoleLogsLoader } from '@posthog/browser-common/logs-types'
import { initializeLogs, replayConsoleBuffer } from '@posthog/browser-common/console-logs'
import type { ConsoleLogsHost } from '@posthog/browser-common/console-logs'
import type { FlagsExtension } from './flags-internal'
import type { LogsExtension } from './logs-internal'
import { snapshotLogsOptions, type LogsOptions } from './logs-options'

export type { LogsOptions, CaptureLogOptions } from './logs-options'
export type { LogsExtension } from './logs-internal'

interface LogsEnvironment {
    client: BrowserClient | undefined
    browserWindow?: Window & typeof globalThis
    disposed: boolean
}

const readSdkContext = (environment: LogsEnvironment) => {
    const client = environment.client!
    const session = client.session
    const distinctId = client.distinctId
    let currentUrl: string | undefined
    try {
        const href = environment.browserWindow?.location?.href
        if (href) currentUrl = href.split('#')[0]!
    } catch {
        /* Unavailable location is omitted. */
    }
    const keys = client.getExtension<FlagsExtension>('featureFlags')?.getActiveFlags?.()
    return {
        distinctId,
        ...(session?.sessionId ? session : {}),
        ...(currentUrl ? { currentUrl } : {}),
        ...(keys?.length ? { activeFeatureFlags: keys } : {}),
    }
}

class BrowserNextLogs extends PostHogLogs {
    constructor(
        config: LogsOptions,
        private readonly _environment: LogsEnvironment
    ) {
        super({ get: () => config, captureHintKey: 'consoleCaptureEnabled', remoteConfigWillArrive: true }, () =>
            readSdkContext(_environment)
        )
    }

    protected override _getConsoleLoader(): ConsoleLogsLoader | undefined {
        const browserWindow = this._environment.browserWindow
        const console = browserWindow?.console
        if (!console) return undefined
        const consoleHost: ConsoleLogsHost = {
            console,
            hostname: browserWindow?.location?.host ?? '',
            getCapturingLogs: () =>
                !this._environment.disposed && this._environment.client?.canCapture ? this : undefined,
        }
        return (callback) =>
            callback(undefined, {
                initialize: () => initializeLogs(consoleHost),
                replay: (_client, entries) => replayConsoleBuffer(consoleHost, entries),
            })
    }
}

/** Include logs and console capture statically instead of loading the product at initialization. */
export const logs = (options: LogsOptions = {}): LogsExtension => {
    const environment: LogsEnvironment = { client: undefined, disposed: false }
    const subscriptions: Disposable[] = []
    const shared = new BrowserNextLogs(snapshotLogsOptions(options), environment)
    const pagehide = () => {
        if (!environment.disposed) shared.flushLogs('sendBeacon')
    }
    return {
        name: 'logs',
        setup: async (value: BrowserClient) => {
            environment.client = value
            try {
                environment.browserWindow = globalThis.window
            } catch {
                /* Non-browser host. */
            }
            subscriptions.push(
                value.onReset(() => shared.reset()),
                value.onConsentChange(({ current }) => {
                    if (current === 'denied') shared.reset()
                })
            )
            await shared.setup(value)
            if (environment.disposed) return
            // oxlint-disable-next-line posthog-js/no-add-event-listener
            environment.browserWindow?.addEventListener('pagehide', pagehide)
        },
        captureLog: (record) => {
            if (environment.disposed) return
            try {
                if (environment.client?.canCapture) shared.captureLog(record)
            } catch (error) {
                environment.client?.logger.error('Log capture failed', error)
            }
        },
        flush: async () => {
            if (!environment.disposed) await shared.flush()
        },
        reset: () => shared.reset(),
        dispose: () => {
            environment.disposed = true
            subscriptions.splice(0).forEach((subscription) => subscription.dispose())
            try {
                shared.flushLogs('sendBeacon')
                environment.browserWindow?.removeEventListener('pagehide', pagehide)
            } finally {
                try {
                    shared.reset()
                } finally {
                    shared.dispose()
                    environment.client = undefined
                }
            }
        },
    }
}
