import type { Client, Extension } from '@posthog/browser-common'
import { PostHogLogs } from '@posthog/browser-common/logs'
import type { BrowserLogsHost } from '@posthog/browser-common/logs-host'
import { initializeLogs, replayConsoleBuffer } from '@posthog/browser-common/console-logs'
import type { ConsoleLogsHost } from '@posthog/browser-common/console-logs'
import type { FlagsExtension } from './flags-internal'
import type { LogsExtension, LogsHost } from './logs-internal'
import { snapshotLogsOptions, type LogsOptions } from './logs-options'

export type { LogsOptions, CaptureLogOptions } from './logs-options'

/** Include logs and console capture statically instead of loading the product at initialization. */
export const logs = (options: LogsOptions = {}): Extension => {
    const config = snapshotLogsOptions(options)
    let host: LogsHost | undefined
    let client: Client | undefined
    let shared: PostHogLogs | undefined
    let window: (Window & typeof globalThis) | undefined
    let disposed = false
    const pending = new Set<() => void>()
    const canSend = () => !disposed && !!host?.canSend()
    const pagehide = () => {
        if (canSend()) shared?.flushLogs('sendBeacon')
    }
    const send: BrowserLogsHost['sendRequest'] = (payload, transport, callback) => {
        let settled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        let controller: AbortController | undefined
        const finish = (statusCode: number, error?: unknown) => {
            if (settled) return
            settled = true
            if (timer !== undefined) clearTimeout(timer)
            pending.delete(cancel)
            callback?.({ statusCode, ...(error === undefined ? {} : { error }) })
        }
        const cancel = () => {
            try {
                controller?.abort()
            } catch {
                // Settlement cannot depend on the browser honoring cancellation.
            }
            finish(0, new Error('Logs request cancelled'))
        }
        try {
            if (!canSend() || !host) {
                finish(0, new Error('Logs delivery disabled'))
                return
            }
            const runtime = host.runtime
            const url = new URL('/i/v1/logs', `${runtime[0].api}/`)
            url.searchParams.set('token', runtime[1])
            const body = JSON.stringify(payload)
            if (transport === 'sendBeacon') {
                try {
                    const navigator = runtime[3]
                    if (
                        canSend() &&
                        navigator?.sendBeacon?.(url.toString(), new Blob([body], { type: 'application/json' }))
                    ) {
                        finish(202)
                        return
                    }
                } catch {
                    /* Fetch keepalive is the fallback. */
                }
            }
            if (!runtime[2] || !canSend()) {
                finish(0, new Error('Logs transport unavailable'))
                return
            }
            controller = typeof AbortController === 'function' ? new AbortController() : undefined
            pending.add(cancel)
            timer = setTimeout(cancel, 60_000)
            const request: RequestInit = {
                method: 'POST',
                credentials: 'omit',
                headers: { 'Content-Type': 'application/json' },
                body,
                ...(controller ? { signal: controller.signal } : {}),
                ...(transport === 'sendBeacon' ? { keepalive: true } : {}),
            }
            void Promise.resolve(runtime[2](url.toString(), request))
                .then((response) => finish(response.status))
                .catch((error) => finish(0, error))
        } catch (error) {
            finish(0, error)
        }
    }
    const extension: LogsExtension = {
        name: 'logs',
        initialize: (value) => {
            host = value
        },
        setup: async (value) => {
            client = value
            await value.kv.initialize()
            if (disposed) return
            try {
                window = globalThis.window
            } catch {
                /* Non-browser host. */
            }
            const consoleHost = (): ConsoleLogsHost | undefined => {
                const console = window?.console
                return console
                    ? {
                          console,
                          hostname: window?.location?.host ?? '',
                          getCapturingLogs: () => (!disposed && value.canCapture ? shared : undefined),
                      }
                    : undefined
            }
            const adapter: BrowserLogsHost = {
                config,
                window,
                get console() {
                    return window?.console
                },
                get isCapturing() {
                    return !disposed && value.canCapture
                },
                isLoaded: true,
                libraryName: value.library.name,
                libraryVersion: value.library.version,
                get persistedCaptureHint() {
                    return !!value.kv.get('consoleCaptureEnabled')
                },
                remoteConfigWillArrive: true,
                persistCaptureHint: (enabled) => value.kv.set('consoleCaptureEnabled', enabled),
                getSdkContext: () => {
                    const session = value.session
                    const context: ReturnType<BrowserLogsHost['getSdkContext']> = { distinctId: value.distinctId }
                    if (session.sessionId) {
                        context.sessionId = session.sessionId
                        context.windowId = session.windowId
                        context.sessionStartTimestamp = session.sessionStartTimestamp
                        const lastActivity = host?.lastActivityTimestamp()
                        if (lastActivity !== undefined) context.lastActivityTimestamp = lastActivity
                    }
                    try {
                        const href = window?.location?.href
                        if (href) context.currentUrl = href.split('#')[0]!
                    } catch {
                        /* Unavailable location is omitted. */
                    }
                    const keys = value.getExtension<FlagsExtension>('featureFlags')?.getActiveFlags?.()
                    if (keys?.length) context.activeFeatureFlags = keys
                    return context
                },
                sendRequest: send,
                getConsoleLoader: () => {
                    const console = consoleHost()
                    return console
                        ? (callback) =>
                              callback(undefined, {
                                  initialize: () => initializeLogs(console),
                                  replay: (_client, entries) => replayConsoleBuffer(console, entries),
                              })
                        : undefined
                },
            }
            shared = new PostHogLogs(adapter)
            shared.setup(value)
            // oxlint-disable-next-line posthog-js/no-add-event-listener
            window?.addEventListener('pagehide', pagehide)
        },
        captureLog: (record) => {
            if (!disposed && client?.canCapture) shared?.captureLog(record)
        },
        flush: async () => {
            if (!disposed) await shared?.flush()
        },
        reset: () => {
            shared?.reset()
        },
        dispose: () => {
            disposed = true
            try {
                window?.removeEventListener('pagehide', pagehide)
            } finally {
                try {
                    shared?.reset()
                } finally {
                    try {
                        shared?.dispose()
                    } finally {
                        for (const cancel of pending) cancel()
                        client = undefined
                    }
                }
            }
        },
    }
    return extension
}
