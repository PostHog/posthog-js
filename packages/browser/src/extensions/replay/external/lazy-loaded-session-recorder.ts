import type { recordOptions, rrwebRecord as rrwebRecordType } from '../types/rrweb'
import type { SnapshotCost } from '@posthog/rrweb-record'
import {
    type customEvent,
    EventType,
    eventWithTime,
    type fullSnapshotEvent,
    IncrementalSource,
    type listenerHandler,
    RecordPlugin,
} from '../types/rrweb-types'
import { buildNetworkRequestOptions } from './config'
import {
    ACTIVE,
    BUFFERING,
    DISABLED,
    EventTriggerMatching,
    LinkedFlagMatching,
    PAUSED,
    SessionRecordingStatus,
    TriggerType,
    URLTriggerMatching,
} from './triggerMatching'
import {
    circularReferenceReplacer,
    estimateCompressedEventSize,
    estimateSize,
    INCREMENTAL_SNAPSHOT_EVENT_TYPE,
    splitBuffer,
    truncateLargeConsoleLogs,
} from './sessionrecording-utils'
export { SEVEN_MEGABYTES, splitBuffer } from './sessionrecording-utils'
import { gzipSync, strFromU8, strToU8 } from 'fflate'
import { window, document } from '@posthog/browser-common/utils/globals'
import { assignableWindow, LazyLoadedSessionRecordingInterface } from '../../../utils/globals'
import { addEventListener } from '@posthog/browser-common/utils/general-utils'
import { MutationThrottler } from './mutation-throttler'
import { createLogger } from '@posthog/browser-common/utils/logger'
import {
    clampToRange,
    gzipCompress,
    isArray,
    isBoolean,
    isFunction,
    isGzipSupported,
    isNull,
    isNullish,
    isNativeAsyncGzipError,
    isNumber,
    isObject,
    isUndefined,
    stripUrlHash,
} from '@posthog/core'
import {
    SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP,
    SESSION_RECORDING_IS_SAMPLED,
    SESSION_RECORDING_SAMPLE_RATE,
    SESSION_RECORDING_OVERRIDE_SAMPLING,
    SESSION_RECORDING_OVERRIDE_LINKED_FLAG,
    SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER,
    SESSION_RECORDING_OVERRIDE_URL_TRIGGER,
    SESSION_RECORDING_PAST_MINIMUM_DURATION,
    SESSION_RECORDING_REMOTE_CONFIG,
    SESSION_RECORDING_START_REASON,
    SDK_DEBUG_REPLAY_RRWEB_ATTACHED,
    SDK_DEBUG_REPLAY_RRWEB_START_ATTEMPTED,
    SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION,
    SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION,
} from '../../../constants'
import { PostHog } from '../../../posthog-core'
import {
    NetworkRecordOptions,
    PerformanceCaptureConfig,
    Properties,
    SessionIdChangedCallback,
    SessionRecordingOptions,
    SessionRecordingSamplingConfig,
    SessionRecordingPersistedConfig,
    SessionStartReason,
} from '../../../types'
import { isLocalhost, maskQueryParams } from '@posthog/browser-common/utils/request-utils'
import Config from '../../../config'
import { FlushedSizeTracker } from './flushed-size-tracker'
import {
    RecordingStrategy,
    V1RecordingStrategy,
    V2TriggerGroupStrategy,
    RecordingStrategyContext,
    decodeSamplingDecision,
} from './recording-strategies'
import { MASKED, PERSONAL_DATA_CAMPAIGN_PARAMS } from '@posthog/browser-common/utils/event-utils'

const BASE_ENDPOINT = '/s/'
const DEFAULT_CANVAS_QUALITY = 0.4
const DEFAULT_CANVAS_FPS = 4
const MAX_CANVAS_FPS = 12
const MAX_CANVAS_QUALITY = 1

// lower bound for session_recording.canvasCapture.resolutionScale, so a misconfiguration can't
// capture at a degenerate resolution.
const MIN_CANVAS_SCALE = 0.1
const TWO_SECONDS = 2000
const ONE_KB = 1024

const ONE_MINUTE = 1000 * 60
const FIVE_MINUTES = ONE_MINUTE * 5
const ONE_HOUR = ONE_MINUTE * 60
const MIN_TRIGGER_PENDING_BUFFER_INTERVAL_MILLIS = 1000
const MAX_TRIGGER_PENDING_BUFFER_INTERVAL_MILLIS = ONE_HOUR

// A full snapshot runs as one uninterruptible task, so anything at this scale is a
// visible freeze - no rendering, scrolling, or cursor movement - and worth a warning.
const SLOW_FULL_SNAPSHOT_THRESHOLD_MS = 500

function roundOrUndefined(value: number | undefined): number | undefined {
    return isUndefined(value) ? undefined : Math.round(value)
}

/**
 * Extracts the network_timing value from a capturePerformance config.
 * Returns `true`/`false` if explicitly set, or `undefined` if not specified.
 */
function networkTimingFromConfig(config: boolean | PerformanceCaptureConfig | undefined): boolean | undefined {
    return isObject(config) ? config.network_timing : config
}

export const RECORDING_IDLE_THRESHOLD_MS = FIVE_MINUTES
export const RECORDING_REMOTE_CONFIG_TTL_MS = ONE_HOUR
export const RECORDING_MAX_EVENT_SIZE = ONE_KB * ONE_KB * 0.9 // ~1mb (with some wiggle room)
export const RECORDING_BUFFER_TIMEOUT = 2000 // 2 seconds
export const SESSION_RECORDING_BATCH_KEY = 'recordings'

const LOGGER_PREFIX = '[SessionRecording]'
const logger = createLogger(LOGGER_PREFIX)

interface QueuedRRWebEvent {
    rrwebMethod: () => void
    attempt: number
    // the timestamp this was first put into this queue
    enqueuedAt: number
}

interface QueuedCompressionEvent {
    event: eventWithTime
    compressionEnabled: boolean
    targetSessionId: string
    targetWindowId: string
    generation: number
    processed: boolean
    counted: boolean
}

interface SessionIdlePayload {
    eventTimestamp: number
    lastActivityTimestamp: number
    threshold: number
    bufferLength: number
    bufferSize: number
    // the session that went idle. The marker is restamped to lastActivityTimestamp + threshold,
    // so routing it by the recorder's live session id backdates a rotation-born session by the
    // whole idle gap when a rotation lands between emit and capture (see onRRwebEmit)
    sessionId?: string
    windowId?: string
}

export interface SnapshotBuffer {
    size: number
    data: any[]
    sizes: number[]
    sessionId: string
    windowId: string
}

const ACTIVE_SOURCES: IncrementalSource[] = [
    IncrementalSource.MouseMove,
    IncrementalSource.MouseInteraction,
    IncrementalSource.Scroll,
    IncrementalSource.ViewportResize,
    IncrementalSource.Input,
    IncrementalSource.TouchMove,
    IncrementalSource.MediaInteraction,
    IncrementalSource.Drag,
]

const newQueuedEvent = (rrwebMethod: () => void): QueuedRRWebEvent => ({
    rrwebMethod,
    enqueuedAt: Date.now(),
    attempt: 1,
})

function getRRWeb() {
    return assignableWindow?.__PosthogExtensions__?.rrweb
}

function getRRWebRecord(): rrwebRecordType | undefined {
    return getRRWeb()?.record
}

export type compressedFullSnapshotEvent = {
    type: typeof EventType.FullSnapshot
    data: string
}

export type compressedIncrementalSnapshotEvent = {
    type: typeof EventType.IncrementalSnapshot
    data: {
        source: IncrementalSource
        texts: string
        attributes: string
        removes: string
        adds: string
    }
}

export type compressedIncrementalStyleSnapshotEvent = {
    type: typeof EventType.IncrementalSnapshot
    data: {
        source: typeof IncrementalSource.StyleSheetRule
        id?: number
        styleId?: number
        replace?: string
        replaceSync?: string
        adds?: string
        removes?: string
    }
}

export type compressedEvent =
    | compressedIncrementalStyleSnapshotEvent
    | compressedFullSnapshotEvent
    | compressedIncrementalSnapshotEvent
export type compressedEventWithTime = compressedEvent & {
    timestamp: number
    delay?: number
    // marker for compression version
    cv: '2024-10'
}

function gzipStringToString(serializedData: string): string {
    return strFromU8(gzipSync(strToU8(serializedData)), true)
}

function serializeForCompression(data: unknown): string {
    try {
        // fast path: plain native stringify, since a replacer callback is expensive on
        // large snapshots and circular event data is rare
        return JSON.stringify(data)
    } catch {
        // circular event data (e.g. a leaked instance graph) degrades gracefully to
        // '[Circular]' markers instead of throwing, the same two-step approach as jsonStringify
        return JSON.stringify(data, circularReferenceReplacer())
    }
}

function gzipToString(data: unknown): string {
    return gzipStringToString(serializeForCompression(data))
}

async function gzipToStringAsync(data: unknown): Promise<string> {
    const serializedData = serializeForCompression(data)
    const compressed = await gzipCompress(serializedData, Config.DEBUG, { rethrow: true })
    return strFromU8(new Uint8Array(await compressed!.arrayBuffer()), true)
}

let _gzippedEmptyArray: string | undefined
let _gzippedEmptyArrayPromise: Promise<string> | undefined
const _isNativeAsyncSessionRecordingGzipSupported = typeof globalThis !== 'undefined' && isGzipSupported()
let _nativeAsyncSessionRecordingGzipDisabled = false

function gzipField(data: unknown): string {
    if (isArray(data) && data.length === 0) {
        _gzippedEmptyArray = _gzippedEmptyArray ?? gzipToString([])
        return _gzippedEmptyArray
    }
    return gzipToString(data)
}

async function gzipFieldAsync(data: unknown): Promise<string> {
    if (isArray(data) && data.length === 0) {
        if (_gzippedEmptyArray) {
            return _gzippedEmptyArray
        }
        _gzippedEmptyArrayPromise =
            _gzippedEmptyArrayPromise ??
            gzipToStringAsync([])
                .then((compressed) => {
                    _gzippedEmptyArray = compressed
                    return compressed
                })
                .catch((error) => {
                    _gzippedEmptyArray = undefined
                    _gzippedEmptyArrayPromise = undefined
                    throw error
                })
        return _gzippedEmptyArrayPromise
    }
    return gzipToStringAsync(data)
}

function shouldCompressEvent(event: eventWithTime): boolean {
    return (
        event.type === EventType.FullSnapshot ||
        (event.type === EventType.IncrementalSnapshot &&
            (event.data.source === IncrementalSource.Mutation ||
                event.data.source === IncrementalSource.StyleSheetRule))
    )
}

function shouldUseNativeAsyncSessionRecordingGzip(event: eventWithTime): boolean {
    return (
        _isNativeAsyncSessionRecordingGzipSupported &&
        !_nativeAsyncSessionRecordingGzipDisabled &&
        shouldCompressEvent(event)
    )
}

type CompressedEventResult = { event: eventWithTime | compressedEventWithTime; size: number }

type CompressedMutationFields = Pick<
    compressedIncrementalSnapshotEvent['data'],
    'texts' | 'attributes' | 'removes' | 'adds'
>
type CompressedStyleFields = Pick<compressedIncrementalStyleSnapshotEvent['data'], 'adds' | 'removes'>

function compressedResult(event: compressedEventWithTime): CompressedEventResult {
    return { event, size: estimateCompressedEventSize(event) }
}

function buildCompressedFullSnapshotEvent(
    event: fullSnapshotEvent & { timestamp: number; delay?: number },
    data: string
): compressedEventWithTime {
    return {
        ...event,
        data,
        cv: '2024-10',
    }
}

function buildCompressedIncrementalEvent(
    event: eventWithTime,
    fields: CompressedMutationFields | CompressedStyleFields
): compressedEventWithTime {
    // reshapes rrweb incremental `data` into its compressed string-field variant — the
    // compiler cannot relate the incoming union member to the matching compressed member
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return {
        ...event,
        cv: '2024-10' as const,
        data: {
            ...(event.data as Record<string, unknown>),
            ...fields,
        },
    } as compressedEventWithTime
}

/**
 * rrweb's packer takes an event and returns a string or the reverse on `unpack`.
 * but we want to be able to inspect metadata during ingestion.
 * and don't want to compress the entire event,
 * so we have a custom packer that only compresses part of some events
 *
 * returns the compressed event and its estimated JSON size,
 * avoiding a redundant JSON.stringify for size estimation
 */
function compressEventSync(event: eventWithTime): CompressedEventResult {
    try {
        if (event.type === EventType.FullSnapshot) {
            return compressedResult(buildCompressedFullSnapshotEvent(event, gzipToString(event.data)))
        }
        if (event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.Mutation) {
            return compressedResult(
                buildCompressedIncrementalEvent(event, {
                    texts: gzipField(event.data.texts),
                    attributes: gzipField(event.data.attributes),
                    removes: gzipField(event.data.removes),
                    adds: gzipField(event.data.adds),
                })
            )
        }
        if (event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.StyleSheetRule) {
            return compressedResult(
                buildCompressedIncrementalEvent(event, {
                    adds: event.data.adds ? gzipToString(event.data.adds) : undefined,
                    removes: event.data.removes ? gzipToString(event.data.removes) : undefined,
                })
            )
        }
    } catch (e) {
        logger.error('could not compress event - will use uncompressed event', e)
    }
    return { event, size: estimateSize(event) }
}

async function compressEventAsync(event: eventWithTime): Promise<CompressedEventResult> {
    try {
        if (event.type === EventType.FullSnapshot) {
            return compressedResult(buildCompressedFullSnapshotEvent(event, await gzipToStringAsync(event.data)))
        }
        if (event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.Mutation) {
            const [texts, attributes, removes, adds] = await Promise.all([
                gzipFieldAsync(event.data.texts),
                gzipFieldAsync(event.data.attributes),
                gzipFieldAsync(event.data.removes),
                gzipFieldAsync(event.data.adds),
            ])
            return compressedResult(buildCompressedIncrementalEvent(event, { texts, attributes, removes, adds }))
        }
        if (event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.StyleSheetRule) {
            const [adds, removes] = await Promise.all([
                event.data.adds ? gzipToStringAsync(event.data.adds) : undefined,
                event.data.removes ? gzipToStringAsync(event.data.removes) : undefined,
            ])
            return compressedResult(buildCompressedIncrementalEvent(event, { adds, removes }))
        }
    } catch (e) {
        if (isNativeAsyncGzipError(e)) {
            _nativeAsyncSessionRecordingGzipDisabled = true
        }
        logger.error('could not compress event asynchronously - trying synchronous compression', e)
        return compressEventSync(event)
    }
    return { event, size: estimateSize(event) }
}

function isCustomEvent(e: eventWithTime, tag: string): e is eventWithTime & customEvent {
    return e.type === EventType.Custom && e.data.tag === tag
}

function isSessionIdleEvent(e: eventWithTime): e is eventWithTime & customEvent {
    return isCustomEvent(e, 'sessionIdle')
}

function getSessionIdlePayload(e: eventWithTime): SessionIdlePayload | null {
    return isSessionIdleEvent(e) ? (e.data.payload as SessionIdlePayload) : null
}

type SessionEndingPayload = {
    lastActivityTimestamp?: number
    currentSessionId?: string
    currentWindowId?: string
}

function isSessionEndingEvent(e: eventWithTime): e is eventWithTime & customEvent {
    return isCustomEvent(e, '$session_ending')
}

function getSessionEndingPayload(e: eventWithTime): SessionEndingPayload | null {
    return isSessionEndingEvent(e) ? (e.data.payload as SessionEndingPayload) : null
}

type SessionStartingPayload = {
    lastActivityTimestamp?: number
    nextSessionId?: string
    nextWindowId?: string
}

function isSessionStartingEvent(e: eventWithTime): e is eventWithTime & customEvent {
    return isCustomEvent(e, '$session_starting')
}

function getSessionStartingPayload(e: eventWithTime): SessionStartingPayload | null {
    return isSessionStartingEvent(e) ? (e.data.payload as SessionStartingPayload) : null
}

function isAllowedWhenIdle(e: eventWithTime): boolean {
    return isSessionIdleEvent(e) || isSessionEndingEvent(e) || isSessionStartingEvent(e)
}

// dropping these desyncs the player's mirror, styles, or viewport in ways only a
// fresh full snapshot repairs; canvas is excluded because a snapshot cannot restore it
function isMirrorDesyncingWhenDropped(e: eventWithTime): boolean {
    if (e.type === EventType.FullSnapshot || e.type === EventType.Meta) {
        return true
    }
    return e.type === EventType.IncrementalSnapshot && e.data.source !== IncrementalSource.CanvasMutation
}

/** When we put the recording into a paused state, we add a custom event.
 *  However, in the paused state, events are dropped and never make it to the buffer,
 *  so we need to manually let this one through */
function isRecordingPausedEvent(e: eventWithTime) {
    return e.type === EventType.Custom && e.data.tag === 'recording paused'
}

export class LazyLoadedSessionRecording implements LazyLoadedSessionRecordingInterface {
    private _endpoint: string = BASE_ENDPOINT
    private _mutationThrottler?: MutationThrottler
    /**
     * Util to help developers working on this feature manually override
     */
    private _forceAllowLocalhostNetworkCapture = false
    private _stopRrweb: listenerHandler | undefined = undefined
    private _lastActivityTimestamp: number = Date.now()
    private _isActivatingTrigger: boolean = false
    /**
     * if pageview capture is disabled,
     * then we can manually track href changes
     */
    private _lastHref?: string
    /**
     * and a queue - that contains rrweb events that we want to send to rrweb, but rrweb wasn't able to accept them yet
     */
    private _queuedRRWebEvents: QueuedRRWebEvent[] = []
    private _isIdle: boolean | 'unknown' = 'unknown'
    // events rrweb observed while confirmed idle are dropped, not buffered, so the
    // player's mirror no longer matches the live DOM; when > 0 only a fresh full
    // snapshot stops later incrementals referencing state the player never saw.
    // Cleared only when a full snapshot actually passes the idle gate, so a failed
    // wake heal retries on the next wake instead of losing the signal
    private _eventsDroppedWhileIdle = 0
    // true while the current epoch has had no user interaction; a held epoch is
    // discarded (not shipped) by stop or a subsequent rotation
    private _holdFlushUntilInteraction = false
    // fresh-start holds ship on a clean unload (passive visits are captured, matching
    // pre-hold behavior); rotation-born holds don't — that unload ship was the incident
    private _heldEpochShipsOnUnload = false
    // Sticky for the document lifetime: background tabs that are never foregrounded should
    // not release a fresh-start hold just because they unload.
    private _documentWasEverVisible: boolean
    // set when a held buffer hit the size cap and was dropped to bound memory; a release
    // then takes a fresh full snapshot so the recording resumes playable
    private _heldBufferOverflowed = false
    // a release while the recorder is stopped (e.g. an override during startSessionRecording's
    // restart) must survive the next start(), whose fresh-start hold would otherwise swallow it
    private _suppressNextFreshStartHold = false
    private _rrwebError = false
    private _rrwebStartAttempted = false
    private _maxDepthExceeded = false
    /**
     * Cost of the most expensive full snapshot this recorder has taken. A full snapshot
     * is one uninterruptible task, so this doubles as "the longest freeze we caused".
     * Reported on captured events so slow snapshots are visible in our own data rather
     * than only via customer-supplied Chrome traces.
     */
    private _slowestFullSnapshot: SnapshotCost | undefined
    // the cost object most recently read from rrweb; each snapshot produces a fresh
    // object, so identity comparison dedupes the sync and microtask reads
    private _lastSeenSnapshotCost: SnapshotCost | undefined
    // only log a snapshot cost tracking error once per recorder instance
    private _snapshotCostErrorLogged = false
    // only warn once per recorder instance that client-side masking is shadowing the project setting
    private _hasWarnedClientMaskingOverride = false
    // only warn once per recorder instance that maskAttributeFn is ignored
    private _hasWarnedExclusiveAttributeMasking = false
    private _maskRegionsFnFailed = false
    // only log once per recorder instance so a repeatedly-throwing callback doesn't flood the console
    private _hasLoggedRecorderCallbackError = false

    private _linkedFlagMatching: LinkedFlagMatching
    private _urlTriggerMatching: URLTriggerMatching
    private _eventTriggerMatching: EventTriggerMatching
    // Strategy pattern: V1 vs V2 trigger logic
    private _strategy: RecordingStrategy | undefined
    private _fullSnapshotTimer?: ReturnType<typeof setInterval>
    private _fullSnapshotTimestamps: Array<[string, number]> = []
    // the session a FullSnapshot was last captured for, read by _ensureFullSnapshotForSession and by
    // the marker-only flush guard (unlike _fullSnapshotTimestamps, which records emit-time debug
    // telemetry). Capture-time, not ship-time: a buffer cleared before it flushed leaves this set.
    private _lastFullSnapshotSessionId: string | undefined = undefined
    private _fullSnapshotHealAttemptedFor: string | undefined = undefined

    private _windowId: string
    private _sessionId: string
    get sessionId(): string {
        return this._sessionId
    }

    private _flushBufferTimer?: any
    // we have a buffer - that contains PostHog snapshot events ready to be sent to the server
    private _buffer: SnapshotBuffer
    private _compressionQueue?: Promise<void>
    private _pendingCompressionEvents: QueuedCompressionEvent[] = []
    private _queuedCompressionEvents: number = 0
    private _compressionQueueGeneration: number = 0
    private _isStoppingAfterCompression: boolean = false

    private _removePageViewCaptureHook: (() => void) | undefined = undefined

    private _removeEventTriggerCaptureHook: (() => void) | undefined = undefined

    private _flushedSizeTracker: FlushedSizeTracker

    private get _sessionManager() {
        if (!this._instance.sessionManager) {
            throw new Error(LOGGER_PREFIX + ' must be started with a valid sessionManager.')
        }

        return this._instance.sessionManager
    }

    private get _sessionIdleThresholdMilliseconds(): number {
        return this._instance.config.session_recording.session_idle_threshold_ms || RECORDING_IDLE_THRESHOLD_MS
    }

    private get _isSampled(): boolean | null {
        const currentValue = this._instance.get_property(SESSION_RECORDING_IS_SAMPLED)
        // anything but this session's own tagged decision decodes to null, forcing a fresh decision
        return decodeSamplingDecision(currentValue, this.sessionId)
    }

    private get _sampleRate(): number | null {
        const rate = this._remoteConfig?.sampleRate
        return isNumber(rate) ? rate : null
    }

    private get _minimumDuration(): number | null {
        return this._strategy?.getMinimumDuration(this.sessionId) ?? null
    }

    private _onSessionIdListener: (() => void) | undefined = undefined
    private _onSessionIdleResetForcedListener: (() => void) | undefined = undefined
    private _forceIdleSessionIdListener: (() => void) | undefined = undefined

    constructor(
        private readonly _instance: PostHog,
        documentWasEverVisible?: boolean
    ) {
        // An older core does not provide visibility history. Preserve its unload behavior
        // rather than treating a currently hidden document as one that was never visible.
        this._documentWasEverVisible = documentWasEverVisible ?? true

        // we know there's a sessionManager, so don't need to start without a session id
        const { sessionId, windowId } = this._sessionManager.checkAndGetSessionAndWindowId()
        this._sessionId = sessionId
        this._windowId = windowId

        this._linkedFlagMatching = new LinkedFlagMatching(this._instance)
        this._urlTriggerMatching = new URLTriggerMatching(this._instance)
        this._eventTriggerMatching = new EventTriggerMatching(this._instance)

        this._buffer = this._clearBuffer()

        if (this._sessionIdleThresholdMilliseconds >= this._sessionManager.sessionTimeoutMs) {
            logger.warn(
                `session_idle_threshold_ms (${this._sessionIdleThresholdMilliseconds}) is greater than the session timeout (${this._sessionManager.sessionTimeoutMs}). Session will never be detected as idle`
            )
        }

        this._flushedSizeTracker = new FlushedSizeTracker(this._instance)
    }

    setDocumentWasEverVisible(documentWasEverVisible: boolean): void {
        if (documentWasEverVisible) {
            this._documentWasEverVisible = true
        }
    }

    private get _masking():
        | Pick<
              SessionRecordingOptions,
              'maskAllInputs' | 'maskTextSelector' | 'blockSelector' | 'maskAllElementAttributes'
          >
        | undefined {
        const masking_server_side = this._remoteConfig?.masking
        const masking_client_side = {
            maskAllInputs: this._instance.config.session_recording?.maskAllInputs,
            maskTextSelector: this._instance.config.session_recording?.maskTextSelector,
            blockSelector: this._instance.config.session_recording?.blockSelector,
            maskAllElementAttributes: this._instance.config.session_recording?.maskAllElementAttributes,
        }

        const maskAllInputs = masking_client_side?.maskAllInputs ?? masking_server_side?.maskAllInputs
        const maskTextSelector = masking_client_side?.maskTextSelector ?? masking_server_side?.maskTextSelector
        const blockSelector = masking_client_side?.blockSelector ?? masking_server_side?.blockSelector
        const maskAllElementAttributes =
            masking_client_side?.maskAllElementAttributes ?? masking_server_side?.maskAllElementAttributes

        return !isUndefined(maskAllInputs) ||
            !isUndefined(maskTextSelector) ||
            !isUndefined(blockSelector) ||
            !isUndefined(maskAllElementAttributes)
            ? {
                  maskAllInputs: maskAllInputs ?? true,
                  maskTextSelector,
                  blockSelector,
                  maskAllElementAttributes,
              }
            : undefined
    }

    /**
     * Client-side masking config in `posthog.init` intentionally wins over the "Privacy and masking"
     * project setting (the remote config). That precedence is by-design, but silent: a developer who
     * sets e.g. `maskTextSelector: '*'` locally can be surprised that their dashboard setting has no
     * effect. Warn (once per recorder) when the two diverge so the override is self-explaining.
     */
    private _warnIfClientMaskingShadowsServer(): void {
        if (this._hasWarnedClientMaskingOverride) {
            return
        }

        const masking_server_side = this._remoteConfig?.masking
        if (isNullish(masking_server_side)) {
            return
        }

        const clientConfig = this._instance.config.session_recording
        const divergentFields = (
            ['maskAllInputs', 'maskTextSelector', 'blockSelector', 'maskAllElementAttributes'] as const
        ).filter((field) => {
            const clientValue = clientConfig?.[field]
            const serverValue = masking_server_side[field]
            // a client value that is set and disagrees with the project's value shadows it — an unset
            // server value counts as a divergence too, since the client is then masking something the
            // project setting did not ask for (e.g. maskTextSelector: '*' vs an unset project selector)
            return !isUndefined(clientValue) && clientValue !== serverValue
        })

        if (divergentFields.length === 0) {
            return
        }

        this._hasWarnedClientMaskingOverride = true
        logger.warn(
            'Session recording masking is configured both in `posthog.init` and in your project settings, and they differ. ' +
                'The `session_recording` options in `posthog.init` take precedence, so the project ("Privacy and masking") setting is ignored for: ' +
                divergentFields.join(', ') +
                '. Remove these masking options from `posthog.init` to use the project setting instead. ' +
                'See https://posthog.com/docs/session-replay/privacy',
            {
                client: {
                    maskAllInputs: clientConfig?.maskAllInputs,
                    maskTextSelector: clientConfig?.maskTextSelector,
                    blockSelector: clientConfig?.blockSelector,
                    maskAllElementAttributes: clientConfig?.maskAllElementAttributes,
                },
                project: masking_server_side,
            }
        )
    }

    // (0,1] fraction of the canvas display size to capture frames at, from
    // session_recording.canvasCapture.resolutionScale. clamped to [MIN_CANVAS_SCALE, 1]; defaults
    // to 1 (full resolution) so capture only drops below full resolution when explicitly
    // configured. replay upscales the frame back to its display size.
    private get _canvasResolutionScale(): number {
        return clampToRange(
            this._instance.config.session_recording.canvasCapture?.resolutionScale,
            MIN_CANVAS_SCALE,
            1,
            createLogger('canvas recording resolution scale'),
            1
        )
    }

    private get _canvasRecording(): { enabled: boolean; fps: number; quality: number } {
        const canvasRecording_client_side = this._instance.config.session_recording.captureCanvas
        const canvasRecording_server_side = this._remoteConfig?.canvasRecording

        const enabled: boolean =
            canvasRecording_client_side?.recordCanvas ?? canvasRecording_server_side?.enabled ?? false
        const fps: number =
            canvasRecording_client_side?.canvasFps ?? canvasRecording_server_side?.fps ?? DEFAULT_CANVAS_FPS
        let quality: string | number =
            canvasRecording_client_side?.canvasQuality ?? canvasRecording_server_side?.quality ?? DEFAULT_CANVAS_QUALITY
        if (typeof quality === 'string') {
            const parsed = parseFloat(quality)
            quality = isNaN(parsed) ? 0.4 : parsed
        }

        return {
            enabled,
            fps: clampToRange(fps, 0, MAX_CANVAS_FPS, createLogger('canvas recording fps'), DEFAULT_CANVAS_FPS),
            quality: clampToRange(
                quality,
                0,
                MAX_CANVAS_QUALITY,
                createLogger('canvas recording quality'),
                DEFAULT_CANVAS_QUALITY
            ),
        }
    }

    private get _isConsoleLogCaptureEnabled() {
        const enabled_server_side = !!this._remoteConfig?.consoleLogRecordingEnabled
        const enabled_client_side = this._instance.config.enable_recording_console_log
        return enabled_client_side ?? enabled_server_side
    }

    // network payload capture config has three parts
    // each can be configured server side or client side
    private get _networkPayloadCapture():
        | Pick<NetworkRecordOptions, 'recordHeaders' | 'recordBody' | 'recordPerformance'>
        | undefined {
        const networkPayloadCapture_server_side = this._remoteConfig?.networkPayloadCapture
        const networkPayloadCapture_client_side = {
            recordHeaders: this._instance.config.session_recording?.recordHeaders,
            recordBody: this._instance.config.session_recording?.recordBody,
        }
        const headersEnabled =
            networkPayloadCapture_client_side?.recordHeaders || networkPayloadCapture_server_side?.recordHeaders
        const bodyEnabled =
            networkPayloadCapture_client_side?.recordBody || networkPayloadCapture_server_side?.recordBody
        const clientNetworkTiming = networkTimingFromConfig(this._instance.config.capture_performance)
        const serverNetworkTiming = networkTimingFromConfig(networkPayloadCapture_server_side?.capturePerformance)
        const networkTimingEnabled = !!(isBoolean(clientNetworkTiming) ? clientNetworkTiming : serverNetworkTiming)

        return headersEnabled || bodyEnabled || networkTimingEnabled
            ? { recordHeaders: headersEnabled, recordBody: bodyEnabled, recordPerformance: networkTimingEnabled }
            : undefined
    }

    private _gatherRRWebPlugins() {
        const plugins: RecordPlugin[] = []

        const recordConsolePlugin = assignableWindow.__PosthogExtensions__?.rrwebPlugins?.getRecordConsolePlugin
        if (recordConsolePlugin && this._isConsoleLogCaptureEnabled) {
            plugins.push(recordConsolePlugin())
        }

        const networkPlugin = assignableWindow.__PosthogExtensions__?.rrwebPlugins?.getRecordNetworkPlugin
        if (!!this._networkPayloadCapture && isFunction(networkPlugin)) {
            const canRecordNetwork = !isLocalhost() || this._forceAllowLocalhostNetworkCapture

            if (canRecordNetwork) {
                // The unversioned recorder can run with older cores, so this router method must be feature-detected.
                const isIngestionEndpoint = isFunction(this._instance.requestRouter.isIngestionEndpoint)
                    ? this._instance.requestRouter.isIngestionEndpoint.bind(this._instance.requestRouter)
                    : undefined
                plugins.push(
                    networkPlugin(
                        buildNetworkRequestOptions(
                            this._instance.config,
                            this._networkPayloadCapture,
                            isIngestionEndpoint
                        )
                    )
                )
            } else {
                logger.info('NetworkCapture not started because we are on localhost.')
            }
        }

        return plugins
    }

    private _stripUrlHash(url: string): string {
        return this._instance.config.disable_capture_url_hashes ? stripUrlHash(url) : url
    }

    private _maskReplayUrl(url: string, forceStripHash: boolean = false): string | undefined {
        const href = forceStripHash ? stripUrlHash(url) : this._stripUrlHash(url)
        const paramsToMask = this._instance.config.mask_personal_data_properties
            ? [...PERSONAL_DATA_CAMPAIGN_PARAMS, ...(this._instance.config.custom_personal_data_properties || [])]
            : []

        return this._maskUrl(maskQueryParams(href, paramsToMask, MASKED))
    }

    private _maskUrl(url: string): string | undefined {
        const userSessionRecordingOptions = this._instance.config.session_recording

        // userSessionRecordingOptions.maskNetworkRequestFn is deprecated, fallback to it
        if (userSessionRecordingOptions.maskCapturedNetworkRequestFn) {
            const result = userSessionRecordingOptions.maskCapturedNetworkRequestFn({
                name: url,
            } as any)
            // CapturedNetworkRequest uses 'name' for URL, but also check 'url' for compatibility
            return result?.name ?? (result as any)?.url
        }

        if (userSessionRecordingOptions.maskNetworkRequestFn) {
            const result = userSessionRecordingOptions.maskNetworkRequestFn({
                url,
            })
            return result?.url
        }

        return url
    }

    private _tryRRWebMethod(queuedRRWebEvent: QueuedRRWebEvent): boolean {
        try {
            queuedRRWebEvent.rrwebMethod()
            return true
        } catch (e) {
            // Sometimes a race can occur where the recorder is not fully started yet
            if (this._queuedRRWebEvents.length < 10) {
                this._queuedRRWebEvents.push({
                    enqueuedAt: queuedRRWebEvent.enqueuedAt || Date.now(),
                    attempt: queuedRRWebEvent.attempt + 1,
                    rrwebMethod: queuedRRWebEvent.rrwebMethod,
                })
            } else {
                logger.warn('could not emit queued rrweb event.', e, queuedRRWebEvent)
            }

            return false
        }
    }

    private _tryAddCustomEvent(tag: string, payload: any): boolean {
        return this._tryRRWebMethod(newQueuedEvent(() => getRRWebRecord()!.addCustomEvent(tag, payload)))
    }

    private _pageViewFallBack() {
        try {
            if (this._instance.config.capture_pageview || !window) {
                return
            }
            // Preserve the previous normalization behavior for this fallback (e.g. https://test.com -> https://test.com/)
            // while still applying query masking. This path was already hashless before disable_capture_url_hashes.
            // eslint-disable-next-line compat/compat
            const url = new URL(window.location.href)
            const currentUrl = this._maskReplayUrl(url.origin + url.pathname + url.search)
            if (this._lastHref !== currentUrl) {
                this._lastHref = currentUrl
                this._tryAddCustomEvent('$url_changed', { href: currentUrl })
            }
        } catch {
            // If URL processing fails, don't capture anything
        }
    }

    private _processQueuedEvents() {
        if (this._queuedRRWebEvents.length) {
            // if rrweb isn't ready to accept events earlier, then we queued them up.
            // now that `emit` has been called rrweb should be ready to accept them.
            // so, before we process this event, we try our queued events _once_ each
            // we don't want to risk queuing more things and never exiting this loop!
            // if they fail here, they'll be pushed into a new queue
            // and tried on the next loop.
            // there is a risk of this queue growing in an uncontrolled manner.
            // so its length is limited elsewhere
            // for now this is to help us ensure we can capture events that happen
            // and try to identify more about when it is failing
            const itemsToProcess = [...this._queuedRRWebEvents]
            this._queuedRRWebEvents = []
            itemsToProcess.forEach((queuedRRWebEvent) => {
                if (Date.now() - queuedRRWebEvent.enqueuedAt <= TWO_SECONDS) {
                    this._tryRRWebMethod(queuedRRWebEvent)
                }
            })
        }
    }

    private _tryTakeFullSnapshot(): boolean {
        return this._tryRRWebMethod(newQueuedEvent(() => getRRWebRecord()!.takeFullSnapshot()))
    }

    private get _fullSnapshotIntervalMillis(): number {
        if (this._strategy?.hasPendingTriggers(this.sessionId) && !['sampled', 'active'].includes(this.status)) {
            const configuredInterval = this._instance.config.session_recording?.trigger_pending_buffer_interval_millis
            return isNumber(configuredInterval) &&
                Number.isFinite(configuredInterval) &&
                configuredInterval >= MIN_TRIGGER_PENDING_BUFFER_INTERVAL_MILLIS &&
                configuredInterval <= MAX_TRIGGER_PENDING_BUFFER_INTERVAL_MILLIS
                ? configuredInterval
                : ONE_MINUTE
        }

        return this._instance.config.session_recording?.full_snapshot_interval_millis ?? FIVE_MINUTES
    }

    private _scheduleFullSnapshot(): void {
        if (this._fullSnapshotTimer) {
            clearInterval(this._fullSnapshotTimer)
        }
        // we don't schedule snapshots while idle
        if (this._isIdle === true) {
            return
        }

        const interval = this._fullSnapshotIntervalMillis
        if (!interval) {
            return
        }

        this._fullSnapshotTimer = setInterval(() => {
            this._tryTakeFullSnapshot()
        }, interval)
    }

    private _onTriggerActivated(triggerType?: TriggerType): void {
        // V2 event-trigger matches release the interaction hold here (V1's release lives in
        // _activateTrigger). URL and linked-flag activations never release — they fire
        // without a human present.
        if (triggerType === 'event') {
            this._releaseHoldAndFlush()
        }
        if (this._urlTriggerMatching.urlBlocked || !['sampled', 'active'].includes(this.status)) {
            return
        }
        this._scheduleFullSnapshot()
    }

    private _pauseRecording() {
        // we check _urlBlocked not status, since more than one thing can affect status
        if (this._urlTriggerMatching.urlBlocked) {
            return
        }

        // we can't flush the buffer here since someone might be starting on a blocked page.
        // and we need to be sure that we don't record that page,
        // so we might not get the below custom event, but events will report the paused status.
        // which will allow debugging of sessions that start on blocked pages
        this._urlTriggerMatching.urlBlocked = true

        // Clear the snapshot timer since we don't want new snapshots while paused
        clearInterval(this._fullSnapshotTimer)

        logger.info('recording paused due to URL blocker')
        this._tryAddCustomEvent('recording paused', { reason: 'url blocker' })
    }

    private _resumeRecording() {
        // we check _urlBlocked not status, since more than one thing can affect status
        if (!this._urlTriggerMatching.urlBlocked) {
            return
        }

        this._urlTriggerMatching.urlBlocked = false

        this._tryTakeFullSnapshot()
        this._scheduleFullSnapshot()

        this._tryAddCustomEvent('recording resumed', { reason: 'left blocked url' })
        logger.info('recording resumed')
    }

    private _activateTrigger(triggerType: TriggerType, matchDetail?: string) {
        // Event triggers are explicit "this session matters" evidence and release the
        // interaction hold; URL triggers only scope where recording is allowed and never do.
        // Must run before the pending-trigger short-circuit below: with triggerMatchType
        // 'any' a URL trigger may already have satisfied the combined status, making this
        // activation a no-op — the hold release must still happen.
        if (triggerType === 'event') {
            this._releaseHoldAndFlush()
        }

        // V1 only: V2 uses per-group activation and never calls this method
        // Prevent re-entry: if we're already activating a trigger, skip to avoid infinite recursion
        // This can happen when _reportStarted emits custom events that match the trigger condition
        if (this._isActivatingTrigger) {
            return
        }

        if (!this._strategy?.hasPendingTriggers(this.sessionId)) {
            return
        }

        this._isActivatingTrigger = true
        try {
            // V1: Write trigger activation to persistence
            // (V2 handles this per-group via TriggerGroupMatching.activateTrigger)
            const persistenceKey =
                triggerType === 'url'
                    ? SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION
                    : SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION

            this._instance.persistence?.register({
                [persistenceKey]: this.sessionId,
            })

            this._strategy?.updateActiveTriggers(this.sessionId)
            this._onTriggerActivated()

            this._flushBuffer()
            this._reportStarted((triggerType + '_trigger_matched') as SessionStartReason, {
                [triggerType === 'url' ? 'matchedUrl' : 'matchedEvent']: matchDetail,
            })
        } finally {
            this._isActivatingTrigger = false
        }
    }

    get isStarted(): boolean {
        return !!this._stopRrweb
    }

    get _remoteConfig(): SessionRecordingPersistedConfig | undefined {
        const persistedConfig: any = this._instance.get_property(SESSION_RECORDING_REMOTE_CONFIG)
        if (!persistedConfig) {
            return undefined
        }
        let parsedConfig: SessionRecordingPersistedConfig
        try {
            parsedConfig = isObject(persistedConfig) ? persistedConfig : JSON.parse(persistedConfig)
        } catch (e) {
            // Do not unregister here: the SDK only registers structured configs, and this read path should
            // ignore corrupt legacy/external values without mutating persistence.
            logger.warn('persisted remote config for session recording is invalid and will be ignored', e)
            return undefined
        }

        // Only check TTL if recording hasn't started yet
        // Once started, trust the config until a hard page load
        if (!this.isStarted) {
            // default to now so that configs persisted by older SDK versions
            // (which never set cache_timestamp) are treated as fresh
            const cacheTimestamp = parsedConfig.cache_timestamp ?? Date.now()
            if (Date.now() - cacheTimestamp > RECORDING_REMOTE_CONFIG_TTL_MS) {
                logger.info('persisted remote config for session recording is stale and will be ignored', {
                    cacheTimestamp,
                    persistedConfig,
                })
                this._instance.persistence?.unregister(SESSION_RECORDING_REMOTE_CONFIG)
                return undefined
            }
        }

        return parsedConfig as SessionRecordingPersistedConfig
    }

    private _checkOverride(key: string, overrideFunction: () => void, clearOverride: () => void): void {
        const overrideFlag: boolean = this._instance.get_property(key) as boolean
        if (overrideFlag) {
            overrideFunction()

            // Clean up the override flag after applying it
            clearOverride()
        }
    }

    start(startReason?: SessionStartReason) {
        const config = this._remoteConfig
        if (!config) {
            logger.info('remote config must be stored in persistence before recording can start')
            return
        }

        // any epoch that starts without confirmed user activity is held until there's
        // evidence someone cares (interaction, event trigger, or explicit override) —
        // a tab nobody touches (prefetch, background load) must not ship a billable
        // recording. Rotation-born epochs re-set this in _restartForSessionIdChange
        // after this returns. Guarded on isStarted so a re-entrant start() on a live
        // held recorder (e.g. a remote-config refresh) cannot release a hold that only
        // interaction evidence should release.
        if (!this.isStarted) {
            this._holdFlushUntilInteraction = this._isIdle !== false && !this._suppressNextFreshStartHold
            this._suppressNextFreshStartHold = false
            this._heldEpochShipsOnUnload = this._holdFlushUntilInteraction
            this._heldBufferOverflowed = false
        }

        // Invalidate any in-flight async cleanup queued by a prior stop(). On a session-id
        // rotation, _updateWindowAndSessionIds calls stop() then start() synchronously; if
        // stop() took the _stopAfterCompressionQueueDrains path (non-empty compression queue),
        // its async cleanup would later call _teardown() and silently tear down THIS new
        // recorder once the drain promise resolves. Bumping the generation here causes that
        // pending cleanup to bail at its generation check, and resetting the rest of the
        // compression-stop state means a future stop() of this new recorder is not mistaken
        // for the still-in-progress old one (which would make it a silent no-op).
        // Guarded on the stop-in-progress flag because start() is also called re-entrantly
        // on a live recorder (e.g. opt-in flows) where the queue holds the current session's
        // events and must survive.
        // Discard the buffer too — the bailed-out cleanup would have cleared it. Otherwise the
        // prior session's snapshots flush under the old session id with the new distinct_id,
        // mis-attributing the recording (#3822).
        if (this._isStoppingAfterCompression) {
            this._invalidateCompressionQueue()
            this._clearBuffer()
        }

        // We want to ensure the sessionManager is reset if necessary on loading the recorder
        const { sessionId, windowId } = this._sessionManager.checkAndGetSessionAndWindowId()
        this._sessionId = sessionId
        this._windowId = windowId

        // Reset first full snapshot tracking for the new session
        this._instance.persistence?.unregister(SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP)

        if (config?.endpoint) {
            this._endpoint = config?.endpoint
        }

        // Initialize the appropriate strategy based on config version
        const isV2 = config?.version === 2 && config?.triggerGroups && config.triggerGroups.length > 0

        if (isV2) {
            this._strategy = new V2TriggerGroupStrategy(
                this._instance,
                this._urlTriggerMatching,
                this._reportStarted.bind(this),
                this._tryAddCustomEvent.bind(this),
                this._onTriggerActivated.bind(this)
            )
        } else {
            this._strategy = new V1RecordingStrategy(
                this._instance,
                this._urlTriggerMatching,
                this._eventTriggerMatching,
                this._linkedFlagMatching,
                this._reportStarted.bind(this),
                this._tryTakeFullSnapshot.bind(this),
                this._onTriggerActivated.bind(this)
            )
        }

        // Let the strategy configure itself
        this._strategy.onRemoteConfig(config)

        // Setup event trigger listeners via strategy
        this._removeEventTriggerCaptureHook?.()
        this._removeEventTriggerCaptureHook = this._strategy.setupEventTriggerListeners(
            this._instance.on.bind(this._instance, 'eventCaptured'),
            this.sessionId,
            (triggerType, matchDetail) => this._activateTrigger(triggerType, matchDetail)
        )

        this._checkOverride(
            SESSION_RECORDING_OVERRIDE_SAMPLING,
            () => {
                this.overrideSampling()
            },
            () => this._instance.persistence?.unregister(SESSION_RECORDING_OVERRIDE_SAMPLING)
        )
        this._checkOverride(
            SESSION_RECORDING_OVERRIDE_LINKED_FLAG,
            () => {
                this.overrideLinkedFlag()
            },
            () => this._instance.persistence?.unregister(SESSION_RECORDING_OVERRIDE_LINKED_FLAG)
        )
        this._checkOverride(
            SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER,
            () => {
                this.overrideTrigger('event')
            },
            () => this._instance.persistence?.unregister(SESSION_RECORDING_OVERRIDE_EVENT_TRIGGER)
        )
        this._checkOverride(
            SESSION_RECORDING_OVERRIDE_URL_TRIGGER,
            () => {
                this.overrideTrigger('url')
            },
            () => this._instance.persistence?.unregister(SESSION_RECORDING_OVERRIDE_URL_TRIGGER)
        )

        // Let strategy make sampling decisions
        this._strategy.makeSamplingDecisions(this.sessionId)
        this._startRecorder()

        if (this._rrwebError) {
            return
        }

        // calling addEventListener multiple times is safe and will not add duplicates
        addEventListener(window, 'beforeunload', this._onBeforeUnload)
        // registered after _startRecorder so rrweb's own pagehide listener runs first:
        // it synchronously flushes deferred stylesheet mutations, and this later
        // listener then ships them (beforeunload has already fired, so nothing else will)
        addEventListener(window, 'pagehide', this._onPageHide)
        addEventListener(window, 'offline', this._onOffline)
        addEventListener(window, 'online', this._onOnline)
        addEventListener(document, 'visibilitychange', this._onVisibilityChange)

        if (!this._onSessionIdListener && isFunction(this._sessionManager.onSessionId)) {
            this._onSessionIdListener = this._sessionManager.onSessionId(this._onSessionIdCallback)
        }

        // NB: SessionIdManager.on was only added in posthog-js 1.268.6. This recorder chunk is loaded
        // from the CDN and can run against an older bundled core that has no `on` method, so guard the
        // call to degrade gracefully (recording still starts, it just skips the forced-idle-reset listener)
        // rather than throwing a TypeError during start().
        if (!this._onSessionIdleResetForcedListener && isFunction(this._sessionManager.on)) {
            this._onSessionIdleResetForcedListener = this._sessionManager.on('forcedIdleReset', () => {
                // a session was forced to reset due to idle timeout and lack of activity
                this._clearConditionalRecordingPersistence()
                this._isIdle = 'unknown'
                this.stop()
                // then we want a session id listener to restart the recording when a new session starts
                this._forceIdleSessionIdListener = this._sessionManager.onSessionId(
                    (sessionId, windowId, changeReason) => {
                        // this should first unregister itself
                        this._forceIdleSessionIdListener?.()
                        this._forceIdleSessionIdListener = undefined
                        this._onSessionIdCallback(sessionId, windowId, changeReason)
                    }
                )
            })
        } else if (!isFunction(this._sessionManager.on)) {
            logger.warn(
                'bundled core has no SessionIdManager.on (requires posthog-js >= 1.268.6); ' +
                    'recording will start but skip forced-idle-reset handling'
            )
        }

        if (isNullish(this._removePageViewCaptureHook)) {
            // :TRICKY: rrweb does not capture navigation within SPA-s, so hook into our $pageview events to get access to all events.
            //   Dropping the initial event is fine (it's always captured by rrweb).
            this._removePageViewCaptureHook = this._instance.on('eventCaptured', (event) => {
                // If anything could go wrong here,
                // it has the potential to block the main loop,
                // so we catch all errors.
                try {
                    if (event.event === '$pageview') {
                        const href = event?.properties.$current_url
                            ? this._maskReplayUrl(event.properties.$current_url)
                            : ''
                        if (!href) {
                            return
                        }
                        this._tryAddCustomEvent('$pageview', { href })
                    }
                } catch (e) {
                    logger.error('Could not add $pageview to rrweb session', e)
                }
            })
        }

        if (this.status === ACTIVE) {
            this._reportStarted(startReason || 'recording_initialized')
        }
    }

    private _onSessionIdCallback: SessionIdChangedCallback = (sessionId, windowId, changeReason) => {
        if (!changeReason) return

        // Skip if session hasn't actually changed (callback might fire multiple times)
        if (sessionId === this._sessionId && windowId === this._windowId) {
            return
        }

        const wasLikelyReset = changeReason.noSessionId
        const shouldLinkSessions =
            !wasLikelyReset && (changeReason.activityTimeout || changeReason.sessionPastMaximumLength)

        // Capture old IDs before start() updates them
        const oldSessionId = this._sessionId
        const oldWindowId = this._windowId

        if (shouldLinkSessions) {
            this._tryAddCustomEvent('$session_ending', {
                currentSessionId: oldSessionId,
                currentWindowId: oldWindowId,
                nextSessionId: sessionId,
                nextWindowId: windowId,
                changeReason,
                // we'll need to correct the time of this if it's captured when idle
                // so we don't extend reported session time with a debug event
                lastActivityTimestamp: this._lastActivityTimestamp,
                flushed_size: this._flushedSizeTracker?.currentTrackedSize(oldSessionId),
            })
        }

        // Reset first full snapshot timestamp for the new session
        this._instance.persistence?.unregister(SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP)

        this._maxDepthExceeded = false
        getRRWeb()?.resetMaxDepthState?.()

        this._tryAddCustomEvent('$session_id_change', { sessionId, windowId, changeReason })

        this._clearConditionalRecordingPersistence()

        // The $session_id_change emit above can synchronously re-enter
        // _updateWindowAndSessionIds (rrweb delivers addCustomEvent through emit), which
        // adopts the new ids and restarts the recorder itself. Restart here only when the
        // ids are still stale — confirmed idle, stopped, or states where that emit never
        // reached the session check (blocked URL, queued emit) — so a rotation restarts
        // exactly once.
        if (
            (this._isIdle !== false || !this.isStarted) &&
            (this._sessionId !== sessionId || this._windowId !== windowId)
        ) {
            // rotation while not confirmed-active: hold the new epoch's buffer until the
            // user actually interacts, so idle tabs don't ship one recording per rotation.
            // gated on a real session-id change (a windowId-only restart is not rotation-born)
            // and read before _isIdle is overwritten with 'unknown'
            const holdNextEpoch = this._sessionId !== sessionId && this._isIdle !== false
            this._isIdle = 'unknown'
            this._restartForSessionIdChange(holdNextEpoch)
        }

        if (shouldLinkSessions) {
            this._tryAddCustomEvent('$session_starting', {
                previousSessionId: oldSessionId,
                previousWindowId: oldWindowId,
                nextSessionId: sessionId,
                nextWindowId: windowId,
                changeReason,
                // we'll need to correct the time of this if it's captured when idle
                // so we don't extend reported session time with a debug event
                lastActivityTimestamp: this._lastActivityTimestamp,
            })
        }

        // always re-decide for the new session — guarding on the persisted config here would skip
        // V2 trigger groups and post-reset() sessions, leaving them undecided (= ACTIVE, unsampled)
        this._strategy?.makeSamplingDecisions(sessionId)
    }

    private _teardown() {
        window?.removeEventListener('beforeunload', this._onBeforeUnload)
        window?.removeEventListener('pagehide', this._onPageHide)
        window?.removeEventListener('offline', this._onOffline)
        window?.removeEventListener('online', this._onOnline)
        document?.removeEventListener('visibilitychange', this._onVisibilityChange)

        clearInterval(this._fullSnapshotTimer)
        this._clearFlushBufferTimer()

        this._removePageViewCaptureHook?.()
        this._removePageViewCaptureHook = undefined
        this._removeEventTriggerCaptureHook?.()
        this._removeEventTriggerCaptureHook = undefined
        this._onSessionIdListener?.()
        this._onSessionIdListener = undefined
        this._onSessionIdleResetForcedListener?.()
        this._onSessionIdleResetForcedListener = undefined
        this._forceIdleSessionIdListener?.()
        this._forceIdleSessionIdListener = undefined

        this._strategy?.stop()

        this._stopRecordingProducers()

        this._invalidateCompressionQueue()
    }

    // Invalidate any in-flight async compression work so it does not capture events
    // after stop()/discard() has cleared the buffer or after a future restart.
    private _invalidateCompressionQueue() {
        this._compressionQueueGeneration += 1
        this._pendingCompressionEvents = []
        this._queuedCompressionEvents = 0
        this._compressionQueue = undefined
        this._isStoppingAfterCompression = false
    }

    private _stopRecordingProducers() {
        this._mutationThrottler?.stop()

        // Clear any queued rrweb events to prevent memory leaks from closures
        this._queuedRRWebEvents = []

        this._stopRrweb?.()
        this._stopRrweb = undefined
    }

    private _stopAfterCompressionQueueDrains(): boolean {
        if (!this._compressionQueue || this._queuedCompressionEvents === 0) {
            return false
        }
        if (this._isStoppingAfterCompression) {
            return true
        }

        this._isStoppingAfterCompression = true
        const generation = this._compressionQueueGeneration
        this._clearFlushBufferTimer()
        // Stop rrweb synchronously so it cannot keep producing events while we wait
        // for the compression queue to drain and flush the already queued events.
        this._stopRecordingProducers()
        this._compressionQueue
            .catch(() => undefined)
            .then(() => {
                if (generation !== this._compressionQueueGeneration) {
                    return
                }

                this._isStoppingAfterCompression = false
                this._flushBuffer()
                this._clearBuffer()
                this._teardown()
                logger.info('stopped')
            })
            .catch(() => {
                // Keep stop() best-effort. Compression errors are handled per event,
                // but never let an unexpected queue failure block teardown.
                this._isStoppingAfterCompression = false
                this._teardown()
                logger.info('stopped')
            })

        return true
    }

    stop() {
        // Stop rrweb first: its teardown synchronously flushes any deferred
        // stylesheet mutations through the emit path, and they must reach the
        // buffer (or the compression queue, checked next) before the final
        // flush below, or they are cleared unshipped.
        this._stopRecordingProducers()

        if (this._stopAfterCompressionQueueDrains()) {
            return
        }

        // for a held (interaction-less) epoch the flush is suppressed, so this
        // flush-then-clear discards it — correct for rotation restarts and opt-out alike
        this._flushBuffer()
        this._clearBuffer()
        this._teardown()
        logger.info('stopped')
    }

    // ordering matters: the hold is set after stop() (so the stop discards or ships the
    // old epoch per its own flag) and after start() (whose fresh-start reset would
    // otherwise clobber it); no flush can run synchronously in between
    private _restartForSessionIdChange(holdNextEpoch: boolean) {
        this.stop()
        // cost metrics are per-session; reset them only after the old recorder has
        // stopped (its teardown flush still records deferred stylesheet work, which
        // belongs to the old session) and before the new one takes its first snapshot
        this._slowestFullSnapshot = undefined
        this._lastSeenSnapshotCost = undefined
        getRRWeb()?.resetSnapshotCostState?.()
        this.start('session_id_changed')
        this._holdFlushUntilInteraction = holdNextEpoch
        this._heldEpochShipsOnUnload = false
    }

    // releases run on evidence someone cares about the session: a user interaction, an event
    // trigger match, or an explicit override. Scheduling instead of flushing synchronously keeps
    // the release batched on the normal cadence and re-passes _flushBuffer's gates.
    private _releaseHoldAndFlush() {
        if (!this.isStarted) {
            this._suppressNextFreshStartHold = true
        }
        if (!this._holdFlushUntilInteraction) {
            return
        }
        this._holdFlushUntilInteraction = false
        this._heldEpochShipsOnUnload = false
        if (this._heldBufferOverflowed) {
            this._heldBufferOverflowed = false
            this._tryTakeFullSnapshot()
        }
        this._scheduleFlushBuffer()
    }

    discard() {
        this._clearBuffer()
        this._teardown()
        logger.info('discarded')
    }

    private _captureProcessedEvent(
        event: eventWithTime,
        eventToSend: eventWithTime | compressedEventWithTime,
        size: number,
        targetSessionId: string,
        targetWindowId: string
    ) {
        const properties = {
            $snapshot_bytes: size,
            $snapshot_data: eventToSend,
            $session_id: targetSessionId,
            $window_id: targetWindowId,
        }

        if (this.status === DISABLED) {
            this._clearBuffer()
            return
        }

        this._ensureFullSnapshotForSession(event, targetSessionId)

        this._captureSnapshotBuffered(properties)
    }

    // snapshot cost tracking is telemetry: an error in it must be visible in debug
    // logs, but must never break recording. Logged once per recorder lifetime so
    // the FullSnapshot hot path cannot spam the console.
    private _safeTrackFullSnapshotCost() {
        try {
            this._trackFullSnapshotCost()
        } catch (e) {
            if (!this._snapshotCostErrorLogged) {
                this._snapshotCostErrorLogged = true
                logger.error('could not track full snapshot cost', e)
            }
        }
    }

    private _trackFullSnapshotCost() {
        const cost = getRRWeb()?.getLastSnapshotCost?.()
        if (!cost || cost === this._lastSeenSnapshotCost) {
            return
        }
        this._lastSeenSnapshotCost = cost
        if (!this._slowestFullSnapshot || cost.durationMs > this._slowestFullSnapshot.durationMs) {
            this._slowestFullSnapshot = cost
        }
        if (cost.durationMs >= SLOW_FULL_SNAPSHOT_THRESHOLD_MS) {
            logger.warn('full snapshot was slow, the page may have been unresponsive while it ran', {
                durationMs: Math.round(cost.durationMs),
                stylesheetMs: Math.round(cost.stylesheetMs),
                nodeCount: cost.nodeCount,
                cssRuleCount: cost.cssRuleCount,
                nonDeferrableCssRuleCount: cost.nonDeferrableCssRuleCount,
                deferredStylesheetCount: cost.deferredStylesheetCount,
            })
        }
    }

    // A session whose incrementals ship before any FullSnapshot is unplayable until the next periodic snapshot, so request one from rrweb (once per session id, to avoid loops if taking one keeps failing).
    private _ensureFullSnapshotForSession(event: eventWithTime, targetSessionId: string) {
        if (event.type === EventType.FullSnapshot) {
            this._lastFullSnapshotSessionId = targetSessionId
            return
        }

        if (event.type !== EventType.IncrementalSnapshot) {
            return
        }

        if (
            // deliberately conservative: only heal after this recorder shipped a FullSnapshot to another session (the rotation signature), since on a fresh start rrweb's init snapshot is always ordered ahead of any incremental
            isUndefined(this._lastFullSnapshotSessionId) ||
            this._lastFullSnapshotSessionId === targetSessionId ||
            this._fullSnapshotHealAttemptedFor === targetSessionId
        ) {
            return
        }

        this._fullSnapshotHealAttemptedFor = targetSessionId
        logger.info('incremental snapshot for a session with no full snapshot - requesting one', {
            sessionId: targetSessionId,
        })
        this._tryTakeFullSnapshot()
    }

    private _finishQueuedCompressionEvent(queuedEvent: QueuedCompressionEvent) {
        if (queuedEvent.counted && queuedEvent.generation === this._compressionQueueGeneration) {
            this._queuedCompressionEvents = Math.max(0, this._queuedCompressionEvents - 1)
        }
        queuedEvent.counted = false
        this._pendingCompressionEvents = this._pendingCompressionEvents.filter((x) => x !== queuedEvent)
    }

    private _captureQueuedCompressionEvent(
        queuedEvent: QueuedCompressionEvent,
        eventToSend: eventWithTime | compressedEventWithTime,
        size: number
    ) {
        if (queuedEvent.processed || queuedEvent.generation !== this._compressionQueueGeneration) {
            return
        }

        queuedEvent.processed = true
        this._captureProcessedEvent(
            queuedEvent.event,
            eventToSend,
            size,
            queuedEvent.targetSessionId,
            queuedEvent.targetWindowId
        )
    }

    private _processQueuedCompressionEventSync(queuedEvent: QueuedCompressionEvent) {
        try {
            const { event: eventToSend, size } = queuedEvent.compressionEnabled
                ? compressEventSync(queuedEvent.event)
                : { event: queuedEvent.event, size: estimateSize(queuedEvent.event) }

            this._captureQueuedCompressionEvent(queuedEvent, eventToSend, size)
        } finally {
            this._finishQueuedCompressionEvent(queuedEvent)
        }
    }

    private _drainCompressionQueueSync() {
        const queuedEvents = [...this._pendingCompressionEvents]
        queuedEvents.forEach((queuedEvent) => {
            this._processQueuedCompressionEventSync(queuedEvent)
        })
    }

    private _enqueueCompression(
        event: eventWithTime,
        compressionEnabled: boolean,
        targetSessionId: string,
        targetWindowId: string
    ) {
        const queuedEvent: QueuedCompressionEvent = {
            event,
            compressionEnabled,
            targetSessionId,
            targetWindowId,
            generation: this._compressionQueueGeneration,
            processed: false,
            counted: true,
        }
        this._pendingCompressionEvents.push(queuedEvent)
        this._queuedCompressionEvents += 1

        const processEvent = async () => {
            try {
                if (queuedEvent.processed) {
                    return
                }

                let eventToSend: eventWithTime | compressedEventWithTime
                let size: number
                try {
                    const result = compressionEnabled
                        ? shouldUseNativeAsyncSessionRecordingGzip(event)
                            ? await compressEventAsync(event)
                            : compressEventSync(event)
                        : { event, size: estimateSize(event) }
                    eventToSend = result.event
                    size = result.size
                } catch (e) {
                    // a compression failure must never reject the queue promise chain, since the
                    // rejection would surface as an unhandled rejection and drop the event
                    logger.error('could not process queued compression event - will use uncompressed event', e)
                    eventToSend = event
                    size = estimateSize(event)
                }

                this._captureQueuedCompressionEvent(queuedEvent, eventToSend, size)
            } finally {
                this._finishQueuedCompressionEvent(queuedEvent)
            }
        }

        this._compressionQueue = this._compressionQueue
            ? this._compressionQueue.catch(() => undefined).then(processEvent)
            : processEvent()
    }

    onRRwebEmit(rawEvent: eventWithTime) {
        // late event after sessionManager teardown (e.g. cookieless opt-out) — _sessionManager would throw
        if (!this._instance.sessionManager) {
            return
        }

        this._processQueuedEvents()

        if (!rawEvent || !isObject(rawEvent)) {
            return
        }

        if (rawEvent.type === EventType.Meta) {
            const href = this._maskReplayUrl(rawEvent.data.href)
            this._lastHref = href
            if (!href) {
                return
            }
            rawEvent.data.href = href
        } else {
            this._pageViewFallBack()
        }

        // Check if the URL matches any trigger patterns - delegate to strategy
        this._strategy?.checkUrlTriggers(
            this.sessionId,
            () => this._pauseRecording(),
            () => this._resumeRecording(),
            (triggerType, matchDetail) => this._activateTrigger(triggerType, matchDetail)
        )

        // always have to check if the URL is blocked really early,
        // or you risk getting stuck in a loop
        if (this._urlTriggerMatching.urlBlocked && !isRecordingPausedEvent(rawEvent)) {
            return
        }

        // we're processing a full snapshot, so we should reset the timer
        if (rawEvent.type === EventType.FullSnapshot) {
            if (getRRWeb()?.wasMaxDepthReached?.()) {
                this._maxDepthExceeded = true
            }
            // the FullSnapshot event is emitted partway through rrweb's takeFullSnapshot,
            // whose cost window only closes after the post-snapshot buffer drain and
            // adoptedStyleSheets work; the sync read below picks up any snapshot we have
            // not seen yet, and the microtask (which runs as soon as the synchronous
            // snapshot task finishes, before any newer snapshot can replace the globals)
            // picks up the one in progress right now
            this._safeTrackFullSnapshotCost()
            Promise.resolve().then(() => this._safeTrackFullSnapshotCost())

            this._scheduleFullSnapshot()
            // Full snapshots reset rrweb's node IDs, so clear any logged node tracking
            this._mutationThrottler?.reset()

            // Track the timestamp of the first full snapshot for this session
            // This helps us detect session rotation issues where incremental snapshots
            // are sent before the full snapshot
            this._instance.persistence?.register_once(
                {
                    [SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP]: rawEvent.timestamp,
                },
                undefined
            )
        }

        // Clear the buffer if waiting for a trigger and only keep data from after the current full snapshot
        if (rawEvent.type === EventType.FullSnapshot && this._strategy?.hasPendingTriggers(this.sessionId)) {
            this._clearBufferBeforeMostRecentMeta()
        }

        const throttledEvent = this._mutationThrottler ? this._mutationThrottler.throttleMutations(rawEvent) : rawEvent

        if (!throttledEvent) {
            // when awake, a throttled attribute's later updates get through once the bucket
            // refills; while idle those are dropped too, so only the wake heal restores them
            if (this._isIdle === true) {
                this._eventsDroppedWhileIdle++
            }
            return
        }

        // TODO: Re-add ensureMaxMessageSize once we are confident in it
        const event = truncateLargeConsoleLogs(throttledEvent)

        // Session lifecycle events ($session_ending, $session_starting, sessionIdle) carry their
        // target session ID in the payload. We must extract this BEFORE _updateWindowAndSessionIds
        // runs, because that method triggers checkAndGetSessionAndWindowId() which would update
        // this._sessionId. This is critical for $session_ending which must go to the OLD session,
        // not the new one, and for $session_starting which must go to the NEW session.
        const sessionEndingPayload = getSessionEndingPayload(event)
        const sessionStartingPayload = getSessionStartingPayload(event)
        const sessionIdlePayload = getSessionIdlePayload(event)

        if (sessionEndingPayload || sessionStartingPayload) {
            // Backdate $session_ending to the old session's real end so a late-detected idle
            // period doesn't artificially extend it. $session_starting must NOT be backdated:
            // it ships to the NEW session, and stamping it with the old session's last activity
            // drags the new recording's start back by the whole idle gap
            if (sessionEndingPayload?.lastActivityTimestamp) {
                event.timestamp = sessionEndingPayload.lastActivityTimestamp
            }
        } else if (!sessionIdlePayload?.sessionId) {
            // sessionIdle markers with a pinned session id skip the session check: they are only
            // emitted from inside _updateWindowAndSessionIds, whose caller runs the check itself
            // right after, and running it here first can adopt a pending rotation before the
            // marker is captured — attributing a marker backdated by the idle gap to the new
            // session, which drags the new recording's start back and makes its prefix unplayable
            this._updateWindowAndSessionIds(event)
        }

        if (rawEvent.type === EventType.FullSnapshot) {
            this._fullSnapshotTimestamps.push([this._sessionId, rawEvent.timestamp])
            if (this._fullSnapshotTimestamps.length > 6) {
                this._fullSnapshotTimestamps = this._fullSnapshotTimestamps.slice(-6)
            }
        }

        // Route lifecycle events using their payload IDs:
        // - $session_ending uses currentSessionId (the old session it's ending)
        // - $session_starting uses nextSessionId (the new session it's starting)
        // - sessionIdle uses the session that went idle (backdated markers must not follow a rotation)
        // - All other events use the current session ID
        const targetSessionId =
            sessionEndingPayload?.currentSessionId ??
            sessionStartingPayload?.nextSessionId ??
            sessionIdlePayload?.sessionId ??
            this._sessionId
        const targetWindowId =
            sessionEndingPayload?.currentWindowId ??
            sessionStartingPayload?.nextWindowId ??
            sessionIdlePayload?.windowId ??
            this._windowId

        // When in an idle state we keep recording but don't capture the events,
        // we don't want to return early if idle is 'unknown'
        if (this._isIdle === true && !isAllowedWhenIdle(event)) {
            if (isMirrorDesyncingWhenDropped(event)) {
                this._eventsDroppedWhileIdle++
            }
            return
        }

        if (event.type === EventType.FullSnapshot) {
            // this snapshot re-syncs the player's mirror, so idle-era drops are healed
            this._eventsDroppedWhileIdle = 0
        }

        if (sessionIdlePayload) {
            // session idle events have a timestamp when rrweb sees them
            // which can artificially lengthen a session
            // we know when we detected it based on the payload and can correct the timestamp
            event.timestamp = sessionIdlePayload.lastActivityTimestamp + sessionIdlePayload.threshold
        }

        const compressionEnabled = this._instance.config.session_recording.compress_events ?? true

        if (
            this._queuedCompressionEvents > 0 ||
            (compressionEnabled && shouldUseNativeAsyncSessionRecordingGzip(event))
        ) {
            this._enqueueCompression(event, compressionEnabled, targetSessionId, targetWindowId)
            return
        }

        const { event: eventToSend, size } = compressionEnabled
            ? compressEventSync(event)
            : { event, size: estimateSize(event) }
        this._captureProcessedEvent(event, eventToSend, size, targetSessionId, targetWindowId)
    }

    get status(): SessionRecordingStatus {
        if (!this._strategy) {
            return DISABLED
        }

        const context: RecordingStrategyContext = {
            instance: this._instance,
            sessionId: this.sessionId,
            isSampled: this._isSampled,
            rrwebError: this._rrwebError,
            urlTriggerMatching: this._urlTriggerMatching,
            eventTriggerMatching: this._eventTriggerMatching,
            linkedFlagMatching: this._linkedFlagMatching,
            remoteConfig: this._remoteConfig,
        }

        return this._strategy.getStatus(context)
    }

    log(message: string, level: 'log' | 'warn' | 'error' = 'log') {
        this._instance.sessionRecording?.onRRwebEmit({
            type: 6,
            data: {
                plugin: 'rrweb/console@1',
                payload: {
                    level,
                    trace: [],
                    // Even though it is a string, we stringify it as that's what rrweb expects
                    payload: [JSON.stringify(message)],
                },
            },
            timestamp: Date.now(),
        })
    }

    public overrideLinkedFlag() {
        this._linkedFlagMatching.linkedFlagSeen = true
        this._tryTakeFullSnapshot()
        this._releaseHoldAndFlush()
        this._reportStarted('linked_flag_overridden')
    }

    /**
     * this ignores the sampling config and (if other conditions are met) causes capture to start
     *
     * It is not usual to call this directly,
     * instead call `posthog.startSessionRecording({sampling: true})`
     * */
    public overrideSampling() {
        this._instance.persistence?.register({
            // short-circuits the `makeSamplingDecision` function in the session recording module
            [SESSION_RECORDING_IS_SAMPLED]: this.sessionId,
            [SESSION_RECORDING_SAMPLE_RATE]: null,
        })
        this._tryTakeFullSnapshot()
        this._releaseHoldAndFlush()
        this._reportStarted('sampling_overridden')
    }

    /**
     * this ignores the URL/Event trigger config and (if other conditions are met) causes capture to start
     *
     * It is not usual to call this directly,
     * instead call `posthog.startSessionRecording({trigger: 'url' | 'event'})`
     * */
    public overrideTrigger(triggerType: TriggerType) {
        this._activateTrigger(triggerType)
        // unlike an organic URL trigger match, an explicit override releases the hold for both trigger types
        this._releaseHoldAndFlush()
    }

    private _currentMaskedHostname(): string | undefined {
        try {
            const href = window?.location?.href
            if (!href) {
                return undefined
            }
            const maskedUrl = this._maskReplayUrl(href)
            if (!maskedUrl) {
                return undefined
            }
            // not convertToURL: it resolves invalid input (e.g. a masking fn returning "REDACTED")
            // against the current page and would return the real hostname we're trying to mask.
            // new URL throws instead, so bad input falls through to the catch and we omit the property.
            // eslint-disable-next-line compat/compat
            return new URL(maskedUrl).hostname || undefined
        } catch {
            return undefined
        }
    }

    private _clearFlushBufferTimer() {
        if (this._flushBufferTimer) {
            clearTimeout(this._flushBufferTimer)
            this._flushBufferTimer = undefined
        }
    }

    private _scheduleFlushBuffer() {
        if (!this._flushBufferTimer) {
            this._flushBufferTimer = setTimeout(() => {
                this._flushBuffer()
            }, RECORDING_BUFFER_TIMEOUT)
        }
    }

    // Custom events are lifecycle markers (sessionIdle, $session_id_change, ...). A buffer holding
    // nothing else has no content to render, so shipping it as a session's first block opens a
    // recording that bills the customer and plays back as nothing. Once the session has a
    // FullSnapshot, later marker-only blocks append to real content and are fine.
    // $session_starting and $session_ending are exempt: they only exist in this stream, and
    // dropping them would break the linking chain through a session that recorded nothing.
    private _wouldOpenRecordingWithMarkersOnly(): boolean {
        if (this._lastFullSnapshotSessionId === this._buffer.sessionId || this._buffer.data.length === 0) {
            return false
        }
        return this._buffer.data.every(
            (event) =>
                event?.type === EventType.Custom && !isSessionEndingEvent(event) && !isSessionStartingEvent(event)
        )
    }

    /**
     * Names the trigger conditions that are keeping the session in BUFFERING, so a customer looking
     * at the console can tell which leg failed instead of only seeing an unexplained "buffering".
     * A URL trigger that never matches under the default AND matching otherwise reads, from the
     * outside, exactly like a session that is about to record.
     */
    private _describePendingTriggerConditions(): string[] {
        return this._strategy?.getPendingTriggerConditions(this.sessionId) ?? []
    }

    private _lastLoggedBufferingReason: string | undefined

    private _maybeLogBufferingReason(status: SessionRecordingStatus): void {
        if (status !== BUFFERING) {
            this._lastLoggedBufferingReason = undefined
            return
        }
        const pending = this._describePendingTriggerConditions()
        if (pending.length === 0) {
            return
        }
        const reason = pending.join(', ')
        // only log on change so the flush cadence doesn't spam the console while buffering
        if (reason === this._lastLoggedBufferingReason) {
            return
        }
        this._lastLoggedBufferingReason = reason
        logger.info(`buffering: ${reason}`)
    }

    private _flushBuffer(): SnapshotBuffer {
        // cleared before the re-entrant reads below, so a flush they schedule survives this call
        this._clearFlushBufferTimer()

        // hold the buffer rather than ship a billable recording for an epoch nobody touched
        if (this._holdFlushUntilInteraction) {
            return this._buffer
        }

        // keep the markers rather than open a recording with them: the next capture schedules another
        // flush, so they ship alongside the content that follows, and go with the page if none does
        if (this._wouldOpenRecordingWithMarkersOnly()) {
            // unplayable either way, so a flush that finds them past the cap drops them rather than
            // holding them. Only a flush checks this, so it bounds the common case, not every case
            return this._buffer.size > RECORDING_MAX_EVENT_SIZE ? this._clearBuffer() : this._buffer
        }

        // the reads below consult the session manager, which can synchronously adopt a pending
        // session rotation and re-enter this recorder, swapping this._buffer for the new epoch's;
        // that pass flushes or holds it itself, so ship only the buffer these checks validated
        const validatedBuffer = this._buffer

        // never flush while a sampling decision is missing (e.g. wiped by posthog.reset()) — an
        // undecided session reads as ACTIVE and would leak a batch it then decides not to record
        this._strategy?.ensureSamplingDecision(this.sessionId)

        const isBelowMinimumDuration = this._isBelowMinimumDuration()
        const status = this.status

        // run on every flush, not just the buffering branch: when the session goes active this
        // clears the saved reason, so a later session that buffers for the same condition still logs
        this._maybeLogBufferingReason(status)

        if (status === BUFFERING || status === PAUSED || status === DISABLED || isBelowMinimumDuration) {
            this._scheduleFlushBuffer()
            return this._buffer
        }

        if (this._buffer !== validatedBuffer) {
            return this._buffer
        }

        if (validatedBuffer.data.length > 0) {
            const snapshotHostname = this._currentMaskedHostname()
            const snapshotEvents = splitBuffer(validatedBuffer)
            snapshotEvents.forEach((snapshotBuffer) => {
                this._flushedSizeTracker?.trackSize(snapshotBuffer.sessionId, snapshotBuffer.size)
                this._captureSnapshot({
                    $snapshot_bytes: snapshotBuffer.size,
                    $snapshot_data: snapshotBuffer.data,
                    $session_id: snapshotBuffer.sessionId,
                    $window_id: snapshotBuffer.windowId,
                    $lib: Config.LIB_NAME,
                    $lib_version: Config.LIB_VERSION,
                    $snapshot_host: snapshotHostname,
                })
            })

            // Notify strategy that initial flush is complete (performance optimization)
            this._strategy?.onFlushComplete()
        }

        // buffer is empty, we clear it in case the session id has changed
        return this._clearBuffer()
    }

    private _hasPassedMinimumDuration = (): boolean => {
        const persistedSessionId = this._instance.persistence?.props[SESSION_RECORDING_PAST_MINIMUM_DURATION]
        return persistedSessionId === this._sessionId
    }

    private _getBufferDuration = (): number | null => {
        if (this._buffer.data.length === 0) {
            return null
        }

        const firstTimestamp = this._buffer.data[0]?.timestamp
        const lastTimestamp = this._buffer.data[this._buffer.data.length - 1]?.timestamp

        if (!isNumber(firstTimestamp) || !isNumber(lastTimestamp)) {
            return null
        }

        return lastTimestamp - firstTimestamp
    }

    private _isBelowMinimumDuration = (): boolean => {
        const minimumDuration = this._minimumDuration
        if (!isNumber(minimumDuration)) {
            return false
        }

        const strictMode = this._instance.config.session_recording?.strictMinimumDuration ?? false

        if (!strictMode) {
            const sessionDuration = this._sessionDuration
            const isPositiveSessionDuration = isNumber(sessionDuration) && sessionDuration >= 0
            return isPositiveSessionDuration && sessionDuration < minimumDuration
        }

        if (this._hasPassedMinimumDuration()) {
            return false
        }

        const bufferDuration = this._getBufferDuration()
        if (isNull(bufferDuration)) {
            return true
        }

        if (bufferDuration >= minimumDuration) {
            this._instance.persistence?.register({
                [SESSION_RECORDING_PAST_MINIMUM_DURATION]: this._sessionId,
            })
            return false
        }

        return true
    }

    private _captureSnapshotBuffered(properties: Properties) {
        const additionalBytes = 2 + (this._buffer?.data.length || 0) // 2 bytes for the array brackets and 1 byte for each comma

        // Extract target session ID from properties to ensure we flush when session changes
        // This is critical for lifecycle events ($session_ending, $session_starting) which may
        // have different target session IDs than this._sessionId
        const targetSessionId = properties.$session_id as string

        // A session-id mismatch must flush and rebind even while idle, or an idle rotation appends the new session's Meta and FullSnapshot to the old session's buffer and ships them under the old session id.
        const sessionChanged = this._buffer.sessionId !== targetSessionId

        if (
            sessionChanged ||
            // we never want to flush a healthy same-session buffer while confirmed idle, but
            // 'unknown' still captures so its buffer must respect the size cap or it grows unbounded
            (this._isIdle !== true &&
                !this._holdFlushUntilInteraction &&
                this._buffer.size + properties.$snapshot_bytes + additionalBytes > RECORDING_MAX_EVENT_SIZE)
        ) {
            const sessionBeforeFlush = this._sessionId
            this._buffer = this._flushBuffer()
            // a rotation adopted re-entrantly during that flush owns this._buffer now; clearing it
            // or relabeling it with this event's pre-rotation ids would mis-attribute the new
            // epoch, so drop the stale event instead
            if (this._sessionId !== sessionBeforeFlush) {
                return
            }
            // A suppressed flush (e.g. buffering, paused, held, below minimum duration) returns the buffer un-drained, and relabeling the prior session's events would mis-attribute them, so discard them instead.
            if (sessionChanged && this._buffer.data.length > 0) {
                this._buffer = this._clearBuffer()
            }
            // After flushing, update buffer to use the new target session/window IDs
            this._buffer.sessionId = targetSessionId
            this._buffer.windowId = properties.$window_id as string
        }

        // a held buffer can't ship at the cap, so bound memory instead: drop the epoch's data
        // and stop collecting; a release takes a fresh full snapshot to resume playable
        if (
            this._holdFlushUntilInteraction &&
            (this._heldBufferOverflowed ||
                this._buffer.size + properties.$snapshot_bytes + additionalBytes > RECORDING_MAX_EVENT_SIZE)
        ) {
            if (!this._heldBufferOverflowed) {
                this._heldBufferOverflowed = true
                this._buffer = this._clearBuffer()
            }
            return
        }

        this._buffer.size += properties.$snapshot_bytes
        this._buffer.data.push(properties.$snapshot_data)
        this._buffer.sizes.push(properties.$snapshot_bytes)

        // Schedule the flush unless confirmed idle or held — a held epoch can't ship anyway
        // (scheduling would just churn a no-op timer every cycle) and every release path
        // schedules its own flush.
        if (this._isIdle !== true && !this._holdFlushUntilInteraction) {
            this._scheduleFlushBuffer()
        }
    }

    private _captureSnapshot(properties: Properties) {
        // :TRICKY: Make sure we batch these requests, use a custom endpoint and don't truncate the strings.
        this._instance.capture('$snapshot', properties, {
            _url: this._instance.requestRouter.endpointFor('api', this._endpoint),
            _noTruncate: true,
            _batchKey: SESSION_RECORDING_BATCH_KEY,
            skip_client_rate_limiting: true,
        })
    }

    private get _sessionDuration(): number | null {
        const mostRecentSnapshot = this._buffer?.data[this._buffer?.data.length - 1]
        const { sessionStartTimestamp } = this._sessionManager.checkAndGetSessionAndWindowId(true)
        return mostRecentSnapshot ? mostRecentSnapshot.timestamp - sessionStartTimestamp : null
    }

    private _clearBufferBeforeMostRecentMeta(): SnapshotBuffer {
        if (!this._buffer || this._buffer.data.length === 0) {
            return this._clearBuffer()
        }

        // Find the last meta event index by iterating backwards
        let lastMetaIndex = -1
        for (let i = this._buffer.data.length - 1; i >= 0; i--) {
            if (this._buffer.data[i].type === EventType.Meta) {
                lastMetaIndex = i
                break
            }
        }
        if (lastMetaIndex >= 0) {
            this._buffer.data = this._buffer.data.slice(lastMetaIndex)
            this._buffer.sizes = this._buffer.sizes.slice(lastMetaIndex)
            this._buffer.size = this._buffer.sizes.reduce((a, b) => a + b, 0)
            return this._buffer
        } else {
            return this._clearBuffer()
        }
    }

    private _clearBuffer(): SnapshotBuffer {
        this._buffer = {
            size: 0,
            data: [],
            sizes: [],
            sessionId: this._sessionId,
            windowId: this._windowId,
        }
        return this._buffer
    }

    private _onBeforeUnload = (): void => {
        // If still buffering (waiting for triggers), discard the buffer
        if (this.status === BUFFERING) {
            this._clearBuffer()
            return
        }

        // a clean unload releases a fresh-start hold for passive visits (reading, video),
        // but only if the document was ever visible. Rotation-born holds stay held, and an
        // overflowed hold has nothing playable left to ship.
        if (
            this._holdFlushUntilInteraction &&
            this._heldEpochShipsOnUnload &&
            this._documentWasEverVisible &&
            !this._heldBufferOverflowed
        ) {
            this._holdFlushUntilInteraction = false
        }

        // beforeunload cannot wait for async CompressionStream work. Synchronously
        // compress any queued events so sendBeacon can include them in this flush.
        this._drainCompressionQueueSync()
        this._flushBuffer()
    }

    // pagehide fires after beforeunload, i.e. after the flush above has emptied the
    // buffer - but also after rrweb's own pagehide listener has synchronously emitted
    // any remaining deferred stylesheet mutations. Repeat the drain+flush so those
    // events ship instead of dying in a buffer nothing will ever flush again.
    private _onPageHide = (): void => {
        this._onBeforeUnload()
    }

    private _onOffline = (): void => {
        this._tryAddCustomEvent('browser offline', {})
    }

    private _onOnline = (): void => {
        this._tryAddCustomEvent('browser online', {})
    }

    private _onVisibilityChange = (): void => {
        if (document?.visibilityState) {
            if (document.visibilityState === 'visible') {
                this._documentWasEverVisible = true
            }
            const label = 'window ' + document.visibilityState
            this._tryAddCustomEvent(label, {})
        }
    }

    private _reportStarted(startReason: SessionStartReason, tagPayload?: Record<string, any>) {
        this._instance.register_for_session({
            [SESSION_RECORDING_START_REASON]: startReason,
        })
        logger.info(startReason.replace('_', ' '), tagPayload)
        if (startReason !== 'session_id_changed') {
            this._tryAddCustomEvent('$recording_started', {
                reason: startReason,
                ...tagPayload,
            })
        }
    }

    private _isInteractiveEvent(event: eventWithTime) {
        return (
            event.type === INCREMENTAL_SNAPSHOT_EVENT_TYPE &&
            ACTIVE_SOURCES.indexOf(event.data?.source as IncrementalSource) !== -1
        )
    }

    private _updateWindowAndSessionIds(event: eventWithTime) {
        // Some recording events are triggered by non-user events (e.g. "X minutes ago" text updating on the screen).
        // We don't want to extend the session or trigger a new session in these cases. These events are designated by event
        // type -> incremental update, and source -> mutation.

        const isUserInteraction = this._isInteractiveEvent(event)

        if (!isUserInteraction && this._isIdle !== true) {
            // We check if the lastActivityTimestamp is old enough to go idle
            const timeSinceLastActivity = event.timestamp - this._lastActivityTimestamp
            if (timeSinceLastActivity > this._sessionIdleThresholdMilliseconds) {
                // we mark as idle right away,
                // or else we get multiple idle events
                // if there are lots of non-user activity events being emitted
                this._isIdle = true

                // don't take full snapshots while idle
                clearInterval(this._fullSnapshotTimer)

                this._tryAddCustomEvent('sessionIdle', {
                    eventTimestamp: event.timestamp,
                    lastActivityTimestamp: this._lastActivityTimestamp,
                    threshold: this._sessionIdleThresholdMilliseconds,
                    bufferLength: this._buffer.data.length,
                    bufferSize: this._buffer.size,
                    // pin the marker to the session that actually went idle: it is restamped to
                    // lastActivityTimestamp + threshold, and if a pending rotation is adopted
                    // before it is captured (e.g. waking from a long-suspended tab), routing it
                    // by the live session id would backdate the rotation-born session's start
                    // by the whole idle gap
                    sessionId: this._sessionId,
                    windowId: this._windowId,
                })

                // proactively flush the buffer in case the session is idle for a long time
                this._flushBuffer()
            }
        }

        let returningFromIdle = false
        if (isUserInteraction) {
            this._lastActivityTimestamp = event.timestamp
            if (this._isIdle) {
                const idleWasUnknown = this._isIdle === 'unknown'
                // Remove the idle state
                this._isIdle = false
                // if the idle state was unknown, we don't want to add an event, since we're just in bootup
                // whereas if it was true, we know we've been idle for a while, and we can mark ourselves as returning from idle
                if (!idleWasUnknown) {
                    this._tryAddCustomEvent('sessionNoLongerIdle', {
                        reason: 'user activity',
                        type: event.type,
                    })
                    returningFromIdle = true
                }
            }
        }

        // The session check runs in every idle state (it only reads in-memory persistence
        // props, so it is cheap). While 'unknown' the recorder still captures, so it must keep
        // checking or its events are stamped with a stale session id. While confirmed idle,
        // the readOnly check below still enforces the 24-hour session cap
        // (sessionPastMaximumLength rotates even on readOnly calls) and hears cross-tab
        // rotations. Bailing here is how idle tabs used to accrete multi-day recordings that
        // blew straight through SESSION_LENGTH_LIMIT under one session id.
        // We only want to extend the session if it is an interactive event.
        const { windowId, sessionId } = this._sessionManager.checkAndGetSessionAndWindowId(
            !isUserInteraction,
            event.timestamp
        )

        const sessionIdChanged = this._sessionId !== sessionId
        const windowIdChanged = this._windowId !== windowId

        this._windowId = windowId
        this._sessionId = sessionId

        if (sessionIdChanged || windowIdChanged) {
            const holdNextEpoch = sessionIdChanged && this._isIdle !== false
            if (holdNextEpoch) {
                // same idle bookkeeping as the session-manager callback path: a rotation born
                // without interaction starts its epoch in the 'unknown' state (this path can
                // adopt a rotation with _isIdle === true now that confirmed-idle emits still
                // run the session check for the 24-hour cap)
                this._isIdle = 'unknown'
            }
            this._restartForSessionIdChange(holdNextEpoch)
        } else {
            if (isUserInteraction) {
                // first interaction within a held session ships the buffer, playable from t=0
                this._releaseHoldAndFlush()
            }
            if (returningFromIdle) {
                // a trigger-pending buffer ships on activation, so it needs the heal as
                // much as a live recording; only sampled-out and disabled states skip it
                const bufferCanShip =
                    ['sampled', 'active'].includes(this.status) || this._strategy?.hasPendingTriggers(this.sessionId)
                // a snapshot from _releaseHoldAndFlush above has already cleared the
                // counter by the time this check runs, so we never take two in one tick
                if (this._eventsDroppedWhileIdle > 0 && bufferCanShip) {
                    this._tryTakeFullSnapshot()
                }
                this._scheduleFullSnapshot()
            }
        }
    }

    private _clearConditionalRecordingPersistence(): void {
        this._strategy?.clearConditionalRecordingPersistence()
    }

    get sdkDebugProperties(): Properties {
        const { sessionStartTimestamp } = this._sessionManager.checkAndGetSessionAndWindowId(true)
        // deferred sheets that never made it back into the recording (see rrweb-snapshot),
        // undefined on recorder chunks that predate the counters
        const deferredStylesheetStats = getRRWeb()?.getDeferredStylesheetStats?.()

        return {
            $recording_status: this.status,
            $sdk_debug_replay_internal_buffer_length: this._buffer.data.length,
            $sdk_debug_replay_internal_buffer_size: this._buffer.size,
            $sdk_debug_current_session_duration: this._sessionDuration,
            $sdk_debug_session_start: sessionStartTimestamp,
            $sdk_debug_replay_flushed_size: this._flushedSizeTracker?.currentTrackedSize(this.sessionId),
            $sdk_debug_replay_full_snapshots: this._fullSnapshotTimestamps,
            $snapshot_max_depth_exceeded: this._maxDepthExceeded,
            // slowest, not most recent: a full snapshot is one uninterruptible task, so
            // the worst one is the freeze a user would actually have noticed
            $sdk_debug_replay_slowest_full_snapshot_ms: roundOrUndefined(this._slowestFullSnapshot?.durationMs),
            $sdk_debug_replay_slowest_full_snapshot_stylesheet_ms: roundOrUndefined(
                this._slowestFullSnapshot?.stylesheetMs
            ),
            $sdk_debug_replay_slowest_full_snapshot_nodes: this._slowestFullSnapshot?.nodeCount,
            $sdk_debug_replay_slowest_full_snapshot_css_rules: this._slowestFullSnapshot?.cssRuleCount,
            // never-deferrable sources (CSSOM-only <style>, adoptedStyleSheets) split out,
            // so a customer can tell which bucket dominates their page
            $sdk_debug_replay_slowest_full_snapshot_css_rules_non_deferrable:
                this._slowestFullSnapshot?.nonDeferrableCssRuleCount,
            // cumulative across the session, unlike the slowest-snapshot properties: a fast
            // first snapshot's deferrals must not vanish because a slower one deferred none
            $sdk_debug_replay_deferred_stylesheets: deferredStylesheetStats?.deferredCount,
            $sdk_debug_replay_deferred_stylesheets_failed: deferredStylesheetStats?.failedCount,
            $sdk_debug_replay_deferred_stylesheets_abandoned: deferredStylesheetStats?.abandonedCount,
            $sdk_debug_replay_deferred_stylesheet_ms: roundOrUndefined(deferredStylesheetStats?.totalMs),
            $sdk_debug_replay_deferred_stylesheet_slowest_slice_ms: roundOrUndefined(
                deferredStylesheetStats?.slowestSliceMs
            ),
            $sdk_debug_replay_slowest_mutation_batch_ms: roundOrUndefined(
                getRRWeb()?.getMutationCost?.()?.slowestBatchMs
            ),
            // duration samples dropped because they straddled a tab suspension or blew
            // the plausibility cap (see rrweb-snapshot snapshot-cost.ts): the duration
            // gauges above stay alert-safe, and the discard itself stays observable
            $sdk_debug_replay_discarded_duration_samples: getRRWeb()?.getDiscardedDurationSamples?.(),
            $sdk_debug_replay_rrweb_error: this._rrwebError,
            [SDK_DEBUG_REPLAY_RRWEB_ATTACHED]: !!this._stopRrweb,
            [SDK_DEBUG_REPLAY_RRWEB_START_ATTEMPTED]: this._rrwebStartAttempted,
        }
    }

    private _startRecorder() {
        if (this._stopRrweb) {
            return
        }
        this._rrwebStartAttempted = true

        // rrweb config info: https://github.com/rrweb-io/rrweb/blob/7d5d0033258d6c29599fb08412202d9a2c7b9413/src/record/index.ts#L28
        const sessionRecordingOptions: recordOptions = {
            // a limited set of the rrweb config options that we expose to our users.
            // see https://github.com/rrweb-io/rrweb/blob/master/guide.md
            blockClass: 'ph-no-capture',
            blockSelector: undefined,
            ignoreClass: 'ph-ignore-input',
            maskTextClass: 'ph-mask',
            maskTextSelector: undefined,
            maskTextFn: undefined,
            maskAllInputs: true,
            maskInputOptions: { password: true },
            maskInputFn: undefined,
            maskAllElementAttributes: false,
            maskAttributeFn: undefined,
            slimDOMOptions: {},
            collectFonts: false,
            inlineStylesheet: true,
            // inlining every CSSRule of every sheet is the dominant cost of a full
            // snapshot on CSS-heavy pages, and it runs as one uninterruptible task.
            // We cap it here (rrweb itself stays unbounded) so the budget only turns
            // on when this config surface ships alongside the recorder; the overflow
            // is inlined across idle callbacks. The cap is in rules, not elapsed
            // time, so a single enormous sheet can't slip through, and ~10k rules
            // (a couple hundred ms in Chrome, well above Bootstrap's 2-3k) keeps it
            // inert for ordinary sites. Users can raise it, or set 0 to disable.
            inlineStylesheetBudgetRules: 10_000,
            recordCrossOriginIframes: false,
            sampling: undefined,
            attributeFilter: undefined,
        }

        // only allows user to set our allowlisted options
        const userSessionRecordingOptions = this._instance.config.session_recording
        for (const [key, value] of Object.entries(userSessionRecordingOptions || {})) {
            if (key in sessionRecordingOptions) {
                if (key === 'maskInputOptions') {
                    // ensure password config is set if not included
                    sessionRecordingOptions.maskInputOptions = { password: true, ...value }
                } else if (key === 'sampling') {
                    // only allow a narrow subset of rrweb's sampling options;
                    // canvas sampling is owned by the canvas recording config
                    const userSampling = (value ?? {}) as SessionRecordingSamplingConfig
                    const sampling: recordOptions['sampling'] = {}
                    if (!isUndefined(userSampling.mousemove)) {
                        sampling.mousemove = userSampling.mousemove
                    }
                    if (!isUndefined(userSampling.mouseInteraction)) {
                        sampling.mouseInteraction = userSampling.mouseInteraction
                    }
                    sessionRecordingOptions.sampling = sampling
                } else {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    sessionRecordingOptions[key] = value
                }
            }
        }

        if (this._canvasRecording && this._canvasRecording.enabled) {
            sessionRecordingOptions.recordCanvas = true
            // canvas fps is owned by the canvas recording config; merge so that
            // user-provided sampling (e.g. mousemove) survives
            sessionRecordingOptions.sampling = {
                ...sessionRecordingOptions.sampling,
                canvas: this._canvasRecording.fps,
            }
            sessionRecordingOptions.dataURLOptions = { type: 'image/webp', quality: this._canvasRecording.quality }
            sessionRecordingOptions.canvasResolutionScale = this._canvasResolutionScale
            sessionRecordingOptions.canvasMasking = {
                // read live like regionsFn below: when true, rrweb skips canvas pixels
                // in DOM full snapshots, and it is re-evaluated at each snapshot so a
                // provider registered after recording started (via set_config) is
                // honored without a recorder restart
                configured: () => isFunction(this._instance.config.session_recording?.canvasCapture?.maskRegionsFn),
                // read live so a provider registered after recording started (e.g. by
                // a plugin that boots later than posthog-js) takes effect immediately.
                // undefined must stay distinct from null, or every canvas without a
                // provider would fail closed
                regionsFn: (canvas) => {
                    const fn = this._instance.config.session_recording?.canvasCapture?.maskRegionsFn
                    if (!isFunction(fn)) {
                        return undefined
                    }
                    try {
                        return fn(canvas) ?? null
                    } catch (e) {
                        if (!this._maskRegionsFnFailed) {
                            this._maskRegionsFnFailed = true
                            logger.warn('canvasCapture.maskRegionsFn threw, canvas frames will be skipped', e)
                        }
                        return null
                    }
                },
            }
        }

        if (this._masking) {
            sessionRecordingOptions.maskAllInputs = this._masking.maskAllInputs ?? true
            sessionRecordingOptions.maskTextSelector = this._masking.maskTextSelector ?? undefined
            sessionRecordingOptions.blockSelector = this._masking.blockSelector ?? undefined
            sessionRecordingOptions.maskAllElementAttributes = this._masking.maskAllElementAttributes ?? false
        }

        if (sessionRecordingOptions.maskAllElementAttributes && sessionRecordingOptions.maskAttributeFn) {
            // mutually exclusive, and the coarse option fails closed so a callback
            // cannot accidentally unmask what it hides
            sessionRecordingOptions.maskAttributeFn = undefined
            if (!this._hasWarnedExclusiveAttributeMasking) {
                this._hasWarnedExclusiveAttributeMasking = true
                logger.warn(
                    '`maskAllElementAttributes` and `maskAttributeFn` are mutually exclusive, and `maskAttributeFn` is being ignored. ' +
                        'Remove one of the two. Note that `maskAllElementAttributes` can also come from your project\'s "Privacy and masking" settings. ' +
                        'See https://posthog.com/docs/session-replay/privacy'
                )
            }
        }

        this._warnIfClientMaskingShadowsServer()

        const rrwebRecord = getRRWebRecord()
        if (!rrwebRecord) {
            logger.error(
                '_startRecorder was called but rrwebRecord is not available. This indicates something has gone wrong.'
            )
            return
        }

        this._mutationThrottler =
            this._mutationThrottler ??
            new MutationThrottler(rrwebRecord, {
                refillRate: this._instance.config.session_recording.__mutationThrottlerRefillRate,
                bucketSize: this._instance.config.session_recording.__mutationThrottlerBucketSize,
                onBlockedNode: (id, node) => {
                    const message = `Too many mutations on node '${id}'. Rate limiting. This could be due to SVG animations or something similar`
                    logger.info(message, {
                        node: node,
                    })

                    this.log(LOGGER_PREFIX + ' ' + message, 'warn')
                },
            })

        const activePlugins = this._gatherRRWebPlugins()
        this._stopRrweb = rrwebRecord({
            emit: (event) => {
                this.onRRwebEmit(event)
            },
            plugins: activePlugins,
            errorHandler: (error, context) => {
                // A host API patch shares its callback boundary with the native
                // operation. Preserve the application's exception semantics when
                // rrweb cannot reliably distinguish where that error originated.
                if (context !== 'rrweb') {
                    return false
                }
                if (!this._hasLoggedRecorderCallbackError) {
                    this._hasLoggedRecorderCallbackError = true
                    logger.error('rrweb internal error - recording will continue but may be incomplete', error)
                }
                return true
            },
            ...sessionRecordingOptions,
        })

        if (!this._stopRrweb) {
            this._rrwebError = true
            logger.error(
                'rrweb failed to start - Loss of recording data is possible. Check the browser console for rrweb errors.'
            )
            return
        }

        this._rrwebError = false

        // We reset the last activity timestamp, resetting the idle timer
        this._lastActivityTimestamp = Date.now()
        // stay unknown if we're not sure if we're idle or not
        this._isIdle = isBoolean(this._isIdle) ? this._isIdle : 'unknown'

        this.tryAddCustomEvent('$remote_config_received', this._remoteConfig)
        this._tryAddCustomEvent('$session_options', {
            sessionRecordingOptions,
            activePlugins: activePlugins.map((p) => p?.name),
        })

        this._tryAddCustomEvent('$posthog_config', {
            config: this._instance.config,
        })
    }

    tryAddCustomEvent(tag: string, payload: any): boolean {
        return this._tryAddCustomEvent(tag, payload)
    }
}
