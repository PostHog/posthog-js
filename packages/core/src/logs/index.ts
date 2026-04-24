import type { LogSdkContext } from '@posthog/types'
import { buildOtlpLogRecord } from './logs-utils'
import { Logger, PostHogPersistedProperty } from '../types'
import type { PostHogCoreStateless } from '../posthog-core-stateless'
import type { BufferedLogEntry, CaptureLogOptions, ResolvedPostHogLogsConfig } from './types'

/**
 * Cross-SDK logs orchestrator. Reads/writes go through `_instance`'s
 * `getPersistedProperty` / `setPersistedProperty` — each SDK routes
 * `PostHogPersistedProperty.LogsQueue` wherever makes sense for its platform.
 *
 * Init gating uses `_instance.wrap(fn)` so captures arriving before the SDK
 * is initialized defer onto the parent's `_initPromise`; rejected init drops
 * fn silently.
 *
 * Session context (distinctId, sessionId, etc.) is not read from `_instance`
 * directly — each SDK supplies a `getContext` closure so backend-style SDKs
 * with no ambient user (node) can return whatever makes sense.
 */
export class PostHogLogs {
  private _localEnabled: boolean
  private _maxBufferSize: number

  constructor(
    private readonly _instance: PostHogCoreStateless,
    private readonly _config: ResolvedPostHogLogsConfig,
    private readonly _logger: Logger,
    private readonly _getContext: () => LogSdkContext
  ) {
    this._localEnabled = _config.enabled !== false
    this._maxBufferSize = _config.maxBufferSize
  }

  captureLog(options: CaptureLogOptions): void {
    // feature isn't turned on
    if (!this._localEnabled) {
      return
    }
    // user-consent gate
    if (this._instance.optedOut) {
      return
    }
    if (!options?.body) {
      return
    }

    // Build at call time so context reflects the moment of capture, not the
    // moment we drain (identity changes between capture and drain must not
    // corrupt recorded attributes).
    const record = buildOtlpLogRecord(options, this._getContext())
    const entry: BufferedLogEntry = { record }

    this._instance.wrap(() => this._enqueue(entry))
  }

  private _enqueue(entry: BufferedLogEntry): void {
    // optedOut reads memoryCache, which may change between the top-of-captureLog
    // check and here when this fn is deferred via wrap(): storage preload can
    // hydrate the real value pre-init, or optIn/optOut may fire during the gap.
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
