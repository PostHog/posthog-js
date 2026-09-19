import type { PostHog } from '../posthog-rn'
import {
  JsonType,
  Logger,
  ErrorTracking as CoreErrorTracking,
  isPostHogFetchNetworkError,
  isNullish,
  isObject,
  isString,
  PostHogEventProperties,
  uuidv7,
} from '@posthog/core'
import { Properties } from '@posthog/types'
import { trackConsole, trackUncaughtExceptions, trackUnhandledRejections } from './utils'
import { getRemoteConfigBool } from '../utils'
import { OptionalReactNativePlugin } from '../optional/OptionalPlugin'
import {
  buildFatalJournalEntry,
  serializeFatalJournalEntry,
} from './journal'

type LogLevel = 'debug' | 'log' | 'info' | 'warn' | 'error'

const LogLevelList: LogLevel[] = ['debug', 'log', 'info', 'warn', 'error']

// user provided configuration
interface AutocaptureOptions {
  uncaughtExceptions?: boolean
  unhandledRejections?: boolean
  console?: boolean | LogLevel[]
  /**
   * Enables native iOS/Android/macOS crash autocapture through the optional native plugin.
   * Disabled by default. Requires `@posthog/react-native-plugin` installed (2.2.0 or newer for macOS).
   */
  nativeCrashes?: boolean
}

/**
 * Controls the breadcrumb-style exception steps recorded via `addExceptionStep` and attached
 * to captured exceptions as `$exception_steps`.
 */
export interface ExceptionStepsOptions {
  /**
   * Whether exception steps are recorded and attached.
   * @default true
   */
  enabled?: boolean
  /**
   * Total UTF-8 byte budget (~32KB) for the in-memory buffer. Oldest steps are evicted first when exceeded.
   * @default 32768
   */
  maxBytes?: number
}

export interface ErrorTrackingOptions {
  autocapture?: AutocaptureOptions | boolean
  exceptionSteps?: ExceptionStepsOptions
}

// resolved configuration
interface ResolvedAutocaptureOptions {
  uncaughtExceptions: boolean
  unhandledRejections: boolean
  console: LogLevel[]
}

interface ResolvedErrorTrackingOptions {
  autocapture: ResolvedAutocaptureOptions
}

// Hook the parent PostHog exposes so the error-tracking layer can round-trip the fatal journal:
// `waitForJSPersist` resolves after the JS event queue is durable. `markIngestedOnCapturePath`
// is invoked from the capture path to add the journal id to FatalJournalIngested in the same
// JS storage write as the queue item (so the next launch short-circuits and removes the
// native entry without re-capturing). `waitForStorageReady` waits for storage preload so
// consent/identity reads at fatal-handling time reflect the latest persisted state instead
// of in-memory defaults. `getPersistenceMode` lets the journal skip writing entirely in
// 'memory' mode where AsyncStorage isn't available.
export interface FatalJournalHooks {
  waitForJSPersist: () => Promise<boolean>
  markIngestedOnCapturePath: (journalId: string) => Promise<void>
  hashApiKey: () => Promise<string>
  waitForStorageReady: () => Promise<void>
  getPersistenceMode: () => 'memory' | 'file' | undefined
}

export class ErrorTracking {
  private logger: Logger
  private options: ResolvedErrorTrackingOptions
  private _exceptionStepsConfig: CoreErrorTracking.ResolvedExceptionStepsConfig
  private _exceptionStepsBuffer: CoreErrorTracking.ExceptionStepsBuffer
  private _nativeForwardingEnabled: boolean = false
  private _unsubscribeUncaughtExceptions?: () => void

  /**
   * Controls whether autocaptured exceptions are actually sent.
   * When remote config disables error tracking, this is set to false
   * so that installed handlers become no-ops.
   * Defaults to true (don't block locally enabled capture before remote config loads).
   */
  private _autocaptureEnabled: boolean = true

  constructor(
    private instance: PostHog,
    options: ErrorTrackingOptions = {},
    logger: Logger,
    private readonly fatalJournalHooks?: FatalJournalHooks
  ) {
    this.logger = logger.createLogger('[ErrorTracking]')
    this.options = this.resolveOptions(options)
    const exceptionSteps = options.exceptionSteps
    this._exceptionStepsConfig = CoreErrorTracking.resolveExceptionStepsConfig(
      exceptionSteps ? { enabled: exceptionSteps.enabled, max_bytes: exceptionSteps.maxBytes } : undefined
    )
    this._exceptionStepsBuffer = new CoreErrorTracking.ExceptionStepsBuffer(this._exceptionStepsConfig)
    this.autocapture(this.options.autocapture)
  }

  /**
   * Exception-steps config in the native plugin's shape, so the embedded native SDK keeps one
   * logical buffer with the same byte budget and enabled state.
   */
  getNativePluginExceptionStepsConfig(): ExceptionStepsOptions {
    return { enabled: this._exceptionStepsConfig.enabled, maxBytes: this._exceptionStepsConfig.max_bytes }
  }

  /**
   * Records a breadcrumb-style exception step in the instance buffer and mirrors it to the embedded
   * native SDK. The `$timestamp` is captured at call time. Invalid messages are ignored with a
   * warning and never throw. The step only reaches native when it was actually buffered.
   */
  addExceptionStep(message: string, properties?: Properties): void {
    if (!this._exceptionStepsConfig.enabled) {
      return
    }

    try {
      if (!isString(message) || message.trim().length === 0) {
        this.logger.warn('Ignoring exception step because message must be a non-empty string')
        return
      }

      const userProperties = isObject(properties) ? { ...properties } : {}
      const { sanitizedProperties, droppedKeys } = CoreErrorTracking.stripReservedExceptionStepFields(userProperties)

      if (droppedKeys.length > 0) {
        this.logger.warn('Ignoring reserved exception step fields', { droppedKeys })
      }

      this._exceptionStepsBuffer.add({
        [CoreErrorTracking.EXCEPTION_STEP_INTERNAL_FIELDS.MESSAGE]: message,
        [CoreErrorTracking.EXCEPTION_STEP_INTERNAL_FIELDS.TIMESTAMP]: new Date().toISOString(),
        ...sanitizedProperties,
      })
      this.forwardExceptionStepToNative(message, properties)
    } catch (error) {
      this.logger.error('Failed to add exception step. Ignoring breadcrumb.', error)
    }
  }

  /**
   * Native error tracking initializes asynchronously, so steps recorded before then are buffered
   * only in JS. The host calls this once native is ready to enable forwarding and replay the buffer,
   * so a native crash shortly after startup carries the steps recorded before native was ready.
   */
  onNativeErrorTrackingReady(): void {
    this._nativeForwardingEnabled = true
    for (const step of this.getAttachableExceptionSteps()) {
      this.forwardExceptionStepToNative(step.$message, step as Properties)
    }
  }

  private forwardExceptionStepToNative(message: string, properties?: Properties): void {
    if (!this._nativeForwardingEnabled || !OptionalReactNativePlugin?.addExceptionStep) {
      return
    }
    try {
      // Fire-and-forget: the native layer validates and buffers independently and must never block.
      void Promise.resolve(OptionalReactNativePlugin.addExceptionStep(message, properties)).catch((e) => {
        this.logger.warn(`Failed to forward exception step to native: ${e}`)
      })
    } catch (e) {
      this.logger.warn(`Failed to forward exception step to native: ${e}`)
    }
  }

  /**
   * Returns `properties` with a snapshot of the buffered steps attached as `$exception_steps`,
   * unless the feature is disabled, the caller already provided that key, or the buffer is empty.
   * The buffer is left intact so subsequent exceptions read the same steps.
   */
  attachExceptionSteps(properties: PostHogEventProperties): PostHogEventProperties {
    if (!this._exceptionStepsConfig.enabled || !isNullish(properties.$exception_steps)) {
      return properties
    }
    const steps = this.getAttachableExceptionSteps()
    if (steps.length === 0) {
      return properties
    }
    // Steps are already normalized to their JSON-safe wire form by the buffer.
    return { ...properties, $exception_steps: steps as unknown as JsonType }
  }

  /**
   * Snapshot of the buffered steps (oldest first), or an empty array when disabled or empty.
   */
  getAttachableExceptionSteps(): CoreErrorTracking.ExceptionStep[] {
    if (!this._exceptionStepsConfig.enabled) {
      return []
    }
    try {
      return this._exceptionStepsBuffer.getAttachable()
    } catch (error) {
      this.logger.error('Failed to read buffered exception steps.', error)
      return []
    }
  }

  /**
   * Clears the buffer. Called on SDK close, not on capture or identity changes.
   */
  clearExceptionSteps(): void {
    this._exceptionStepsBuffer.clear()
  }

  shutdown(): void {
    this._autocaptureEnabled = false
    this._unsubscribeUncaughtExceptions?.()
    this._unsubscribeUncaughtExceptions = undefined
    this.clearExceptionSteps()
  }

  /**
   * Called when remote config is loaded.
   * If errorTracking.autocaptureExceptions is explicitly false, autocapture is disabled.
   * If it's true or undefined (not yet loaded / not present), autocapture follows local config.
   */
  onRemoteConfig(errorTracking: boolean | { [key: string]: JsonType } | undefined): void {
    if (errorTracking == null) {
      // Remote config doesn't include errorTracking — don't change anything
      return
    }

    // Default to false: if remote config is present but the key is missing, disable autocapture
    this._autocaptureEnabled = getRemoteConfigBool(errorTracking, 'autocaptureExceptions', false)

    this.logger.info(
      `Error tracking autocapture ${this._autocaptureEnabled ? 'enabled' : 'disabled'} by remote config.`
    )
  }

  private resolveOptions(options: ErrorTrackingOptions): ResolvedErrorTrackingOptions {
    const autocaptureOptions = this.resolveAutocaptureOptions(options.autocapture)
    return {
      autocapture: autocaptureOptions,
    }
  }

  private resolveAutocaptureOptions(autocapture: AutocaptureOptions | boolean = false): ResolvedAutocaptureOptions {
    if (typeof autocapture === 'boolean') {
      return {
        uncaughtExceptions: autocapture,
        unhandledRejections: autocapture,
        console: [],
      }
    }
    return {
      uncaughtExceptions: !!autocapture.uncaughtExceptions,
      unhandledRejections: !!autocapture.unhandledRejections,
      console: this.resolveConsoleOptions(autocapture.console),
    }
  }

  private resolveConsoleOptions(console: boolean | LogLevel[] = false): LogLevel[] {
    if (typeof console === 'boolean') {
      return console ? ['error'] : []
    }
    return Array.isArray(console) ? console.filter((level) => LogLevelList.includes(level)) : []
  }

  private autocaptureUncaughtErrors() {
    const onUncaughtException = async (error: unknown, isFatal: boolean) => {
      // Gate on remote config — if remotely disabled, don't capture
      if (!this._autocaptureEnabled) {
        return
      }

      // Offline/timeout failures are expected, not application errors.
      if (isPostHogFetchNetworkError(error)) {
        return
      }

      const hint: CoreErrorTracking.EventHint = {
        mechanism: {
          type: 'onuncaughtexception',
          handled: false,
        },
      }
      const additionalProperties: any = {}

      if (isFatal) {
        additionalProperties['$exception_level'] = 'fatal' as CoreErrorTracking.SeverityLevel
      }

      let captured: { eventUuid: string; timestamp: string; additionalProperties: PostHogEventProperties } | null = null
      // Tracks whether the JS event was actually enqueued. When capture throws and we
      // fall back to a minimal `captured`, no JS event exists — the dedup marker must
      // NOT be written, or the next launch would skip recovering the native entry.
      let jsCaptureSucceeded = false
      if (isFatal) {
        // Wait for storage preload BEFORE capturing so consent/identity reads reflect
        // persisted state, not in-memory defaults. A previously opted-out user with a
        // slow AsyncStorage preload must not have their fatal crash captured because
        // we read the default value of optedOut.
        try {
          await this.fatalJournalHooks?.waitForStorageReady?.()
        } catch {
          // Storage init failed — proceed with capture anyway. The journal write path
          // re-checks consent independently, so an opted-out user still won't land on
          // disk. But the JS event may capture with default consent/identity, which is
          // the same behavior as before this journal existed.
        }

        const eventUuid = uuidv7()
        const timestampDate = new Date()
        const instance = this.instance as unknown as {
          captureExceptionInternal?: (
            error: unknown,
            additionalProperties?: PostHogEventProperties,
            hint?: CoreErrorTracking.EventHint,
            options?: { uuid?: string; timestamp?: Date }
          ) => { eventUuid: string; timestamp: string; additionalProperties: PostHogEventProperties } | null
        }
        if (instance.captureExceptionInternal) {
          // captureExceptionInternal itself swallows capture() failures, but only after
          // doing the work — its return value is null on a soft failure. A throwing
          // implementation (or one that re-throws after logging) would otherwise skip
          // persistFatalReportToNative and flush() below, so the crash this code path
          // exists to recover goes unrecorded. Fall back to a minimal captured and
          // carry on — the JS event is already lost, but the native journal entry
          // still has the exception list, level, and attribution, which is strictly
          // more than nothing.
          try {
            captured = instance.captureExceptionInternal.call(instance, error, additionalProperties, hint, {
              uuid: eventUuid,
              timestamp: timestampDate,
            })
            jsCaptureSucceeded = captured !== null
          } catch (e) {
            this.logger.error('captureExceptionInternal threw; falling back to minimal captured for journal.', e)
            captured = { eventUuid, timestamp: timestampDate.toISOString(), additionalProperties }
            jsCaptureSucceeded = false
          }
        } else {
          this.instance.captureException(error, additionalProperties, hint)
          captured = { eventUuid, timestamp: timestampDate.toISOString(), additionalProperties }
          jsCaptureSucceeded = true
        }
      } else {
        this.instance.captureException(error, additionalProperties, hint)
      }

      if (!isFatal) {
        return
      }

      const persisted = this.fatalJournalHooks?.waitForJSPersist?.()
      const journalWrite = captured
        ? this.persistFatalReportToNative(captured, hint, error).catch(() => undefined)
        : Promise.resolve(undefined)
      void this.instance.flush().catch(() => {
        this.logger.critical('Failed to flush events')
      })
      return Promise.all([persisted, journalWrite])
        .then(async ([persistedOk, journalId]) => {
          // If both the JS write AND the native write landed, mark ingested in JS so
          // the next launch's drain skips re-capturing. Awaited (not void-ed) so the
          // marker shares the existing 2 s deadline — otherwise React Native can
          // terminate after the queue item is durable but before the marker lands, and
          // the next launch would re-enqueue the same event. On failure the native
          // entry stays on disk and the next launch either re-recovers or short-
          // circuits via the marker — either way no duplicate is shipped.
          // Only mark when the JS event actually made it into the queue. When capture
          // threw (jsCaptureSucceeded === false), no JS event exists — writing the
          // marker would tell the next launch "already sent" and the crash would be
          // lost despite the native entry being on disk.
          if (persistedOk && journalId && jsCaptureSucceeded && this.fatalJournalHooks?.markIngestedOnCapturePath) {
            try {
              await this.fatalJournalHooks.markIngestedOnCapturePath(journalId)
            } catch (e) {
              this.logger.warn(`Fatal journal entry ${journalId} marker write failed: ${e}`)
            }
          }
          return undefined
        })
        .catch((e) => {
          this.logger.warn('Fatal handler completion failed.', e)
          return undefined
        })
    }
    try {
      this._unsubscribeUncaughtExceptions = trackUncaughtExceptions(onUncaughtException)
    } catch (err) {
      this.logger.warn('Failed to track uncaught exceptions: ', err)
    }
  }

  private async persistFatalReportToNative(
    captured: { eventUuid: string; timestamp: string; additionalProperties: PostHogEventProperties },
    hint: CoreErrorTracking.EventHint,
    error: unknown
  ): Promise<string | undefined> {
    const bridge = OptionalReactNativePlugin?.persistFatalException
    if (!bridge) {
      return undefined
    }
    // Memory-mode apps don't have AsyncStorage, so the journal's premise doesn't
    // hold: data would land on disk while the rest of the SDK promises not to, and
    // recovery can't tell whether the in-memory event actually survived. Skip entirely.
    if (this.fatalJournalHooks?.getPersistenceMode?.() === 'memory') {
      return undefined
    }
    // Wait for storage to finish loading before reading consent / identity. With a
    // slow AsyncStorage preload, the default in-memory values would otherwise let an
    // opted-out user land exception data on disk, and an opted-in user would lose
    // their persisted attribution precisely in the slow-storage case this journal
    // targets. The fatal-handler 2s deadline still bounds the wait via the caller.
    try {
      await this.fatalJournalHooks?.waitForStorageReady?.()
    } catch {
      return undefined
    }
    // Honor the user's privacy choice: the journal lives on disk and would survive a
    // crash, so an opted-out user must not have their fatal crash leave any trace, even
    // transiently. The JS event was already dropped by capture() above.
    // Snapshot consent AND identity atomically here — before the async hashApiKey()
    // call below. optOut(), identify(), or reset() can run during that await, so
    // we capture the current state now and re-check consent after.
    const optedOutSnapshot = (this.instance as unknown as { optedOut?: boolean }).optedOut === true
    if (optedOutSnapshot) {
      return undefined
    }
    const sessionIdSnapshot = this.instance.getSessionId() || ''
    const distinctIdSnapshot = this.instance.getDistinctId() || ''
    const deviceIdSnapshot =
      (this.instance as unknown as { getDeviceId?: () => string }).getDeviceId?.() || ''
    const journalId = uuidv7()
    const exceptionList = this._exceptionListFromError(error, hint)
    const steps = this._exceptionStepsBuffer.getAttachable() as unknown as Array<{
      [key: string]: JsonType
    }> | undefined
    const apiKeyHash = (await this.fatalJournalHooks?.hashApiKey?.()) || ''
    if (!apiKeyHash) {
      // Without an apiKey hash we can't scope the entry to a client on recovery — drop
      // the write entirely rather than leak cross-project data on a future relaunch.
      this.logger.warn('Skipping fatal journal write: apiKeyHash unavailable.')
      return undefined
    }
    // Re-check consent after the async hash — optOut() may have run during the await.
    // An entry written with a pre-opt-out snapshot would still be dropped on recovery
    // (the entry's optedOut flag), but we can avoid the disk write entirely here.
    if ((this.instance as unknown as { optedOut?: boolean }).optedOut === true) {
      return undefined
    }
    // Attribution is the merge of commonProperties and the caller's captured properties
    // (which already includes $exception_steps from attachExceptionSteps). pickAttribution
    // keeps only SDK / device / session identifiers — anything outside the allowlist is
    // reconstructed by the next launch or scrubbed by before_send on recovery.
    const commonProperties = (this.instance as unknown as { getCommonEventProperties?: () => PostHogEventProperties })
      .getCommonEventProperties?.() || {}
    const attribution: PostHogEventProperties = {
      ...commonProperties,
      ...captured.additionalProperties,
    }
    const entry = buildFatalJournalEntry({
      id: journalId,
      eventUuid: captured.eventUuid,
      timestamp: captured.timestamp,
      sessionId: sessionIdSnapshot,
      distinctId: distinctIdSnapshot,
      deviceId: deviceIdSnapshot,
      attribution,
      exceptionList: exceptionList as unknown as PostHogEventProperties['$exception_list'],
      exceptionLevel: 'fatal',
      exceptionSteps: steps as unknown as PostHogEventProperties['$exception_steps'],
      optedOut: optedOutSnapshot,
      apiKeyHash,
    })
    await bridge(serializeFatalJournalEntry(entry))
    return journalId
  }

  private _exceptionListFromError(
    error: unknown,
    hint: CoreErrorTracking.EventHint
  ): Array<{ [key: string]: JsonType }> {
    try {
      const builder = (
        this.instance as unknown as {
          getErrorPropertiesBuilder?: () => { buildFromUnknown: (e: unknown, h: CoreErrorTracking.EventHint) => { $exception_list?: Array<{ [key: string]: JsonType }> } }
        }
      ).getErrorPropertiesBuilder?.()
      const result = builder?.buildFromUnknown(error, hint)
      if (result?.$exception_list && result.$exception_list.length > 0) {
        return result.$exception_list
      }
    } catch (e) {
      this.logger.warn('Failed to build exception list for native journal:', e)
    }
    return [
      {
        type: 'Error',
        value: String((error as Error)?.message ?? error ?? 'Unknown error'),
        mechanism: { type: hint?.mechanism?.type ?? 'onuncaughtexception', handled: false },
      },
    ]
  }

  private autocaptureUnhandledRejections() {
    const onUnhandledRejection = (error: unknown) => {
      // Gate on remote config — if remotely disabled, don't capture
      if (!this._autocaptureEnabled) {
        return
      }

      // Offline/timeout failures are expected, not application errors.
      if (isPostHogFetchNetworkError(error)) {
        return
      }

      const hint: CoreErrorTracking.EventHint = {
        mechanism: {
          type: 'onunhandledrejection',
          handled: false,
        },
      }
      this.instance.captureException(error, {}, hint)
    }

    try {
      trackUnhandledRejections(onUnhandledRejection)
    } catch (err) {
      this.logger.warn('Failed to track unhandled rejections: ', err)
    }
  }

  private autocaptureConsole(levels: LogLevel[]) {
    const onConsole = (level: LogLevel) => (error: unknown, isFatal: boolean, syntheticException?: Error) => {
      // Gate on remote config — if remotely disabled, don't capture
      if (!this._autocaptureEnabled) {
        return
      }

      const hint: CoreErrorTracking.EventHint = {
        mechanism: {
          type: 'onconsole',
          handled: true,
        },
        syntheticException,
      }
      const additionalProperties = {
        $exception_level: level as CoreErrorTracking.SeverityLevel,
      }
      this.instance.captureException(error, additionalProperties, hint)
    }

    try {
      for (const level of levels) {
        trackConsole(level, onConsole(level))
      }
    } catch (err) {
      this.logger.warn('Failed to track console errors: ', err)
    }
  }

  private autocapture(autocaptureOptions: ResolvedAutocaptureOptions) {
    if (autocaptureOptions.uncaughtExceptions === true) {
      this.autocaptureUncaughtErrors()
    }
    if (autocaptureOptions.unhandledRejections === true) {
      this.autocaptureUnhandledRejections()
    }
    if (autocaptureOptions.console.length > 0) {
      this.autocaptureConsole(autocaptureOptions.console)
    }
  }
}
