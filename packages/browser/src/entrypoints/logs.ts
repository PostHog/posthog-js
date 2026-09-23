import { assignableWindow } from '../utils/globals'
import { LogsExtension } from '../extension-tokens'
import { BrowserClientAdapter } from '../extensions/browser-client'
import type { PostHog } from '../posthog-core'
import type { CaptureLogOptions } from '../types'
import type { Client } from '@posthog/browser-common'
import { isFunction } from '@posthog/core'
import {
    initializeLogs as initializeConsoleLogs,
    replayConsoleBuffer as replayBuffer,
} from '@posthog/browser-common/console-logs'
import type { ConsoleLogsHost } from '@posthog/browser-common/console-logs'
import type { BufferedConsoleEntry } from '../logs-types'

const isClient = (host: PostHog | Client): host is Client => 'canCapture' in host

type HistoricalCaptureConsoleLogName = 'le' | 'de' | 'he' | 'ui' | 'ci' | 'vi'
type HistoricalLogs = Partial<Record<HistoricalCaptureConsoleLogName, (options: CaptureLogOptions) => void>>

// Compatibility for a bug where `_captureConsoleLog` was inadvertently used across
// independently built bundles and received different mangled names. Pre-stable-ABI
// cores used `le` through 1.410.4, `de` through 1.410.10, `he` through 1.418.3, `ui`
// through 1.418.10, `ci` through 1.418.14, and `vi` through 1.419.2.
const historicalCaptureConsoleLogName = (version: string): HistoricalCaptureConsoleLogName | undefined => {
    const match = /^1\.(\d+)\.(\d+)$/.exec(version)
    if (!match) {
        return undefined
    }

    const minor = Number(match[1])
    const patch = Number(match[2])
    if (minor < 392 || minor > 419) {
        return undefined
    }
    if (minor === 410) {
        return patch <= 4 ? 'le' : patch <= 10 ? 'de' : undefined
    }
    if (minor === 418) {
        return patch <= 3 ? 'he' : patch <= 10 ? 'ui' : patch <= 14 ? 'ci' : patch <= 17 ? 'vi' : undefined
    }
    if (minor === 419) {
        return patch <= 2 ? 'vi' : undefined
    }
    return minor < 410 ? 'le' : 'he'
}

const captureConsoleLogForHost = (
    host: PostHog | Client,
    logs: NonNullable<PostHog['logs']>,
    options: CaptureLogOptions
): void => {
    if (isClient(host)) {
        logs.captureConsoleLog(options)
        return
    }

    // `_captureConsoleLog` had six generated names across core-backed releases.
    // Select by the stable SDK version instead of probing generated names,
    // because the same name can identify a different method in another release.
    // Keep this historical ABI isolated here. A `captureLog` fallback would change the
    // service name, scope, queue, and rate limits.
    const name = historicalCaptureConsoleLogName(host.version)
    const historicalCaptureConsoleLog = name ? (logs as unknown as HistoricalLogs)[name] : undefined
    if (name) {
        if (isFunction(historicalCaptureConsoleLog)) historicalCaptureConsoleLog.call(logs, options)
    } else if (isFunction(logs.captureConsoleLog)) {
        logs.captureConsoleLog(options)
    }
}

const consoleHost = (host: PostHog | Client): ConsoleLogsHost => {
    const client = isClient(host) ? host : new BrowserClientAdapter(host)
    return {
        console: assignableWindow.console,
        hostname: assignableWindow.location.host,
        getCapturingLogs: () => {
            const logs = client.canCapture ? client.getExtension(LogsExtension) : undefined
            return logs
                ? {
                      captureConsoleLog: (options) => captureConsoleLogForHost(host, logs, options),
                      captureBufferedConsoleLog: (options, context, occurredAtMs) =>
                          logs.captureBufferedConsoleLog?.(options, context, occurredAtMs),
                  }
                : undefined
        },
    }
}
const initializeLogs = (host: PostHog | Client): (() => void) => initializeConsoleLogs(consoleHost(host))
const replayConsoleBuffer = (host: PostHog | Client, entries: BufferedConsoleEntry[]) =>
    replayBuffer(consoleHost(host), entries)

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.logs = { initializeLogs, replayConsoleBuffer }
