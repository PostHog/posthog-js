import { allSettled, buildOtlpLogRecord, PostHogPersistedProperty } from '@posthog/core'
import type { Logger } from '@posthog/core'
import type { LogSdkContext } from '@posthog/types'
import type { PostHog } from '../posthog-rn'
import type { PostHogRNStorage } from '../storage'
import type { BufferedLogEntry, CaptureLogOptions, PostHogLogsConfig } from './types'
import { DEFAULT_MAX_BUFFER_SIZE } from './types'

/**
 * Records are written to `PostHogPersistedProperty.LogsQueue` via the standard
 * `instance.getPersistedProperty` / `setPersistedProperty` API. The PostHog RN
 * class routes that key to a dedicated `PostHogRNStorage` backed by
 * `.posthog-rn-logs.json`, physically isolated from the main storage blob.
 *
 * `_logsStorage` is held only for preload coordination and `waitForPersist()`;
 * data reads/writes always go through `_instance`.
 *
 * Cold-start race: before the async storage preload resolves, `memoryCache` is
 * empty. A read-mutate-write in that window would overwrite records persisted
 * by the previous session. Captures arriving before preload are chained onto
 * `_initPromise.then(fn)` and drain in order once ready — same shape as events'
 * `wrap()` in `@posthog/core/posthog-core-stateless.ts`. A rejected preload
 * rejects `_initPromise`, so chained callbacks never run (silent drop).
 */
export class PostHogLogs {
  private _localEnabled: boolean
  private _maxBufferSize: number
  private _isInitialized: boolean = false
  private _initPromise: Promise<void>
  // Serializes concurrent flushStorage calls: the next one awaits the current
  // (mirrors events' `flushPromise` in posthog-core-stateless.ts).
  private _flushPromise: Promise<void> | null = null

  constructor(
    private readonly _instance: PostHog,
    private readonly _config: PostHogLogsConfig | undefined,
    private readonly _logger: Logger,
    private readonly _logsStorage: PostHogRNStorage
  ) {
    this._localEnabled = _config?.enabled !== false
    this._maxBufferSize = _config?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE

    if (this._logsStorage.preloadPromise) {
      this._initPromise = this._logsStorage.preloadPromise.then(() => {
        this._isInitialized = true
      })
      // Terminates the rejection chain so a failed preload doesn't raise an
      // unhandled-rejection warning; the `.then(fn)` chain in captureLog still
      // sees the rejection and drops `fn` silently.
      this._initPromise.catch((err) => {
        this._logger.error('Logs storage preload failed:', err)
      })
    } else {
      this._initPromise = Promise.resolve()
      this._isInitialized = true
    }
  }

  captureLog(options: CaptureLogOptions): void {
    if (!this._localEnabled) {
      return
    }
    if (!options?.body) {
      return
    }

    // Build at call time so distinctId/sessionId reflect the moment of capture,
    // not the moment we drain.
    const record = buildOtlpLogRecord(options, this._getSessionContext())
    const entry: BufferedLogEntry = { record }

    if (this._isInitialized) {
      this._enqueue(entry)
      return
    }
    // Two-arg `.then` so a rejected `_initPromise` (already logged once by the
    // constructor sink) doesn't fan out into N unhandled-rejection warnings,
    // one per queued capture. A throw from `_enqueue` at drain time still
    // propagates — same visibility as events.
    this._initPromise.then(
      () => this._enqueue(entry),
      () => undefined
    )
  }

  /**
   * Drains pending `_logsStorage` writes to disk. Called from the AppState
   * handler on foreground→background transitions so writes land before the OS
   * may suspend the process.
   *
   * Serialization mirrors events' `flush()` in posthog-core-stateless.ts:
   * `allSettled([prev]).then(doFlush)` + registration with
   * `addPendingPromise` for shutdown coordination.
   */
  flushStorage(): Promise<void> {
    const nextFlushPromise = allSettled([this._flushPromise]).then(() => {
      return this._doFlushStorage()
    })

    this._flushPromise = nextFlushPromise
    void this._instance.addPendingPromise(nextFlushPromise)

    allSettled([nextFlushPromise]).then(() => {
      if (this._flushPromise === nextFlushPromise) {
        this._flushPromise = null
      }
    })

    return nextFlushPromise
  }

  private async _doFlushStorage(): Promise<void> {
    await this._logsStorage.waitForPersist()
  }

  private _enqueue(entry: BufferedLogEntry): void {
    // Read opt-in state inside the init-guarded body so we see fully-loaded
    // storage, not pre-preload defaults (matches events' `wrap()` callers).
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

  private _getSessionContext(): LogSdkContext {
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
