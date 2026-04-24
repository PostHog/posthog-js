import type { LogSdkContext } from '@posthog/types'
import { buildOtlpLogRecord } from './logs-utils'
import { Logger, PostHogPersistedProperty } from '../types'
import type { PostHogCoreStateless } from '../posthog-core-stateless'
import type { BufferedLogEntry, CaptureLogOptions, ResolvedPostHogLogsConfig } from './types'

export class PostHogLogs {
  private _localEnabled: boolean
  private _maxBufferSize: number

  constructor(
    private readonly _instance: PostHogCoreStateless,
    private readonly _config: ResolvedPostHogLogsConfig,
    private readonly _logger: Logger,
    private readonly _getContext: () => LogSdkContext,
    private readonly _onReady: (fn: () => void) => void
  ) {
    this._localEnabled = _config.enabled !== false
    this._maxBufferSize = _config.maxBufferSize
  }

  captureLog(options: CaptureLogOptions): void {
    if (!this._localEnabled) {
      return
    }
    if (this._instance.optedOut) {
      return
    }
    if (!options?.body) {
      return
    }

    // Build before deferring so attributes reflect state at capture time, not
    // at drain time (identity/session changes between capture and drain must
    // not corrupt recorded attributes).
    const record = buildOtlpLogRecord(options, this._getContext())
    const entry: BufferedLogEntry = { record }

    this._onReady(() => this._enqueue(entry))
  }

  private _enqueue(entry: BufferedLogEntry): void {
    // Re-check: optedOut can flip between captureLog and here — preload may
    // have hydrated the real persisted value, or optIn/optOut may have fired
    // while this fn was deferred.
    if (this._instance.optedOut) {
      return
    }

    const queue = this._instance.getPersistedProperty<BufferedLogEntry[]>(PostHogPersistedProperty.LogsQueue) ?? []
    if (queue.length >= this._maxBufferSize) {
      queue.shift()
      this._logger.info('Logs queue is full, dropping oldest record.')
    }
    queue.push(entry)
    this._instance.setPersistedProperty(PostHogPersistedProperty.LogsQueue, queue)
  }
}
