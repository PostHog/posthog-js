import { allSettled, buildOtlpLogRecord, PostHogPersistedProperty } from '@posthog/core'
import type { Logger } from '@posthog/core'
import type { LogSdkContext } from '@posthog/types'
import type { PostHog } from '../posthog-rn'
import type { PostHogRNStorage } from '../storage'
import type { BufferedLogEntry, CaptureLogOptions, PostHogLogsConfig } from './types'
import { DEFAULT_MAX_BUFFER_SIZE } from './types'

/**
 * Storage: records are written to `PostHogPersistedProperty.LogsQueue` via
 * the standard `instance.getPersistedProperty` / `setPersistedProperty` API.
 * RN's PostHog class routes that key to a dedicated `PostHogRNStorage` instance
 * backed by `.posthog-rn-logs.json` — physically isolated from the main storage
 * blob so logs writes don't trigger full-file rewrites of events, flags, etc.
 *
 * The `_logsStorage` reference is held only for preload-race coordination and
 * shutdown `waitForPersist()`. Data access always goes through `_instance`.
 *
 * Preload race: during the cold-start window the underlying storage's
 * `memoryCache` is empty until its async preload resolves. If captureLog ran
 * the read-mutate-write path during that window it would read an empty queue
 * and overwrite any persisted-from-previous-session records. Captures arriving
 * before preload completes are held in `_pendingCaptures` and drained into the
 * persisted queue once storage is ready.
 */
export class PostHogLogs {
  private _localEnabled: boolean
  private _storageReady: boolean = false
  private _pendingCaptures: BufferedLogEntry[] = []
  // Serializes concurrent flush calls — next flush awaits the previous one
  // before running. No-op today (flushStorage is idempotent) but forward-
  // compat for 2b where flushLogs will also POST to the server, at which
  // point concurrent callers could duplicate POSTs or race on queue-clear.
  // Mirrors events' `flushPromise` in @posthog/core/posthog-core-stateless.ts.
  private _flushPromise: Promise<void> | null = null

  constructor(
    private readonly _instance: PostHog,
    private readonly _config: PostHogLogsConfig | undefined,
    private readonly _logger: Logger,
    // Held only for preload + waitForPersist coordination. Data reads/writes
    // go through _instance.getPersistedProperty / setPersistedProperty.
    private readonly _logsStorage: PostHogRNStorage
  ) {
    this._localEnabled = _config?.enabled !== false

    if (this._logsStorage.preloadPromise) {
      this._logsStorage.preloadPromise
        .then(() => this._onStorageReady())
        .catch((err) => {
          this._logger.error('Logs storage preload failed:', err)
          // Preload has permanently failed. Flip the flag and proceed with an
          // empty in-memory cache — reads will return undefined (as if the
          // queue were empty), and captures will overwrite with an empty-
          // baseline queue. We lose visibility into pre-existing persisted
          // records but keep collecting new ones, which is better than
          // permanently dropping every new capture into the pending buffer.
          this._onStorageReady()
        })
    } else {
      // Sync storage backend — already populated at construction.
      this._storageReady = true
    }
  }

  captureLog(options: CaptureLogOptions): void {
    if (!this._localEnabled || this._instance.optedOut) {
      return
    }
    if (!options?.body) {
      return
    }

    const sdkContext = this._getSdkContext()
    const record = buildOtlpLogRecord(options, sdkContext)
    const maxBufferSize = this._config?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE

    if (!this._storageReady) {
      // Cold-start window: hold in memory, drain when preload finishes.
      // Bound by the same maxBufferSize so a log storm during init can't OOM.
      if (this._pendingCaptures.length >= maxBufferSize) {
        this._pendingCaptures.shift()
        this._logger.info('Logs pending-buffer is full during storage preload, dropping oldest record.')
      }
      this._pendingCaptures.push({ record })
      return
    }

    const queue =
      this._instance.getPersistedProperty<BufferedLogEntry[]>(PostHogPersistedProperty.LogsQueue) ?? []

    if (queue.length >= maxBufferSize) {
      queue.shift()
      this._logger.info('Logs queue is full, dropping oldest record.')
    }

    queue.push({ record })
    this._instance.setPersistedProperty(PostHogPersistedProperty.LogsQueue, queue)
  }

  /**
   * Waits for any pending logs-storage writes to reach disk. Called from the
   * PostHog RN class's AppState handler so foreground→background transitions
   * drain logs writes before the process may be suspended/killed. In 2b this
   * will also cover POST + post-POST queue-clear.
   *
   * Serialization machinery mirrors events' `flush()` in
   * `@posthog/core/posthog-core-stateless.ts`:
   *   - `allSettled` (custom impl, defensive against sync throws)
   *   - `_flushPromise` chain — next call awaits the current flush
   *   - `addPendingPromise` — registers flush with core's shutdown coordinator
   *   - clear `_flushPromise` when settled (debug hygiene)
   * Today `_doFlushStorage` is idempotent so the serialization is defensive;
   * in 2b, when flushLogs gains POST + queue-clear work, this machinery
   * prevents duplicate POSTs and queue-clear races.
   */
  flushStorage(): Promise<void> {
    const nextFlushPromise = allSettled([this._flushPromise]).then(() => {
      return this._doFlushStorage()
    })

    this._flushPromise = nextFlushPromise
    void this._instance.addPendingPromise(nextFlushPromise)

    allSettled([nextFlushPromise]).then(() => {
      // Clear if still the latest; makes debugging easier but isn't required.
      if (this._flushPromise === nextFlushPromise) {
        this._flushPromise = null
      }
    })

    return nextFlushPromise
  }

  private async _doFlushStorage(): Promise<void> {
    await this._logsStorage.waitForPersist()
  }

  private _onStorageReady(): void {
    this._storageReady = true

    if (this._pendingCaptures.length === 0) {
      return
    }

    const maxBufferSize = this._config?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE
    const queue =
      this._instance.getPersistedProperty<BufferedLogEntry[]>(PostHogPersistedProperty.LogsQueue) ?? []

    for (const entry of this._pendingCaptures) {
      if (queue.length >= maxBufferSize) {
        queue.shift()
      }
      queue.push(entry)
    }
    this._pendingCaptures = []

    this._instance.setPersistedProperty(PostHogPersistedProperty.LogsQueue, queue)
  }

  private _getSdkContext(): LogSdkContext {
    const context: LogSdkContext = {}
    const distinctId = this._instance.getDistinctId()
    if (distinctId) {
      context.distinctId = distinctId
    }
    const sessionId = this._instance.getSessionId()
    if (sessionId) {
      context.sessionId = sessionId
    }
    return context
  }
}
