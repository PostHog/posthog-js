import type { OtlpLogsPayload } from '@posthog/types'
import type { LogSdkContext } from '@posthog/core'
import type { BrowserLogsConfig } from './logs-config'
import type { Client } from './client'
import type { BufferedConsoleEntry } from './logs-types'

export type LogsTransport = 'XHR' | 'fetch' | 'sendBeacon'

/** Browser-specific capabilities used by the shared logs extension. */
export interface BrowserLogsHost {
    readonly config: BrowserLogsConfig | undefined
    readonly window: Window | undefined
    readonly console: Console | undefined
    readonly isCapturing: boolean
    readonly isLoaded: boolean
    readonly libraryName: string
    readonly libraryVersion: string
    readonly persistedCaptureHint: boolean
    readonly remoteConfigWillArrive: boolean
    persistCaptureHint(enabled: boolean): void
    getSdkContext(): LogSdkContext
    sendRequest(
        payload: OtlpLogsPayload,
        transport?: LogsTransport,
        callback?: (response: { statusCode: number; error?: unknown }) => void
    ): void
    /** Reports unavailable loaders before returning undefined. The callback may run synchronously. */
    getConsoleLoader():
        | ((callback: (error: unknown, capture?: ConsoleLogsCapture | undefined) => void) => void)
        | undefined
}

export interface ConsoleLogsCapture {
    initialize(client: Client | undefined): (() => void) | undefined
    replay(client: Client | undefined, entries: BufferedConsoleEntry[]): void
}
