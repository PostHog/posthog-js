import type { KeyValueStore, SessionContext } from '@posthog/browser-common'

import { createId } from './id'
import type { NewSessionReason, StorageLike } from './types'

type ConsentState = 'implicit' | 'granted' | 'denied'

type StoredValue = [read: boolean, value: unknown]

interface PersistedSession {
    sessionId: string
    sessionStartTimestamp: number
    lastActivityTimestamp: number
    revision: string
}

interface PersistedState {
    version: 1
    deviceId: string
    anonymousId: string
    distinctId: string
    isIdentified: boolean
    groups: Record<string, string>
    session?: PersistedSession
    sessionReset?: string
    extensionData: Record<string, Record<string, unknown>>
}

interface PreparedSession {
    readonly context: SessionContext
    readonly session: PersistedSession
    readonly reason: NewSessionReason | undefined
    readonly rotated: boolean
    readonly lastActivityWriteTimestamp: number
    readonly windowStorage: StorageLike | undefined
    readonly windowStorageResolved: boolean
    readonly previousWindowId: string
    readonly previousWindowStorageInitialized: boolean
    readonly previousPendingReason: 'reset' | undefined
}

const emptyRecord = <T>(): Record<string, T> => Object.create(null) as Record<string, T>

const cloneJson = <T>(value: T): T => {
    const json = JSON.stringify(value)
    if (json === undefined) {
        throw new TypeError('The value must be JSON-serializable')
    }
    return JSON.parse(json) as T
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

const readGroups = (value: unknown): Record<string, string> => {
    const groups = emptyRecord<string>()
    if (isRecord(value)) {
        Object.entries(value).forEach(([key, group]) => {
            if (typeof group === 'string') {
                groups[key] = group
            }
        })
    }
    return groups
}

const isTimestamp = (value: unknown): value is number =>
    // eslint-disable-next-line posthog-js/no-direct-number-check
    typeof value === 'number' && Number.isFinite(value) && value >= 0

const readRevision = (value: unknown, fallback?: unknown): string | undefined => {
    if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
        return value
    }
    const number = value === undefined ? fallback : value
    return isTimestamp(number) && Number.isSafeInteger(number) ? String(number) : undefined
}

const compareRevisions = (left: string | undefined, right: string | undefined): number => {
    if (left === right) {
        return 0
    }
    if (left === undefined) {
        return -1
    }
    if (right === undefined) {
        return 1
    }
    return left.length === right.length ? (left > right ? 1 : -1) : left.length > right.length ? 1 : -1
}

const incrementRevision = (revision: string): string => {
    const digits = revision.split('')
    for (let index = digits.length - 1; index >= 0; index--) {
        if (digits[index] !== '9') {
            digits[index] = String(Number(digits[index]) + 1)
            return digits.join('')
        }
        digits[index] = '0'
    }
    return `1${digits.join('')}`
}

const readSession = (value: unknown): PersistedSession | undefined => {
    if (!isRecord(value)) {
        return undefined
    }

    const { sessionId, sessionStartTimestamp, lastActivityTimestamp } = value
    const revision = readRevision(value.revision, sessionStartTimestamp)
    if (
        typeof sessionId !== 'string' ||
        sessionId.length === 0 ||
        !isTimestamp(sessionStartTimestamp) ||
        !isTimestamp(lastActivityTimestamp) ||
        !revision
    ) {
        return undefined
    }

    return { sessionId, sessionStartTimestamp, lastActivityTimestamp, revision }
}

const readExtensionData = (value: unknown): Record<string, Record<string, unknown>> => {
    const extensionData = emptyRecord<Record<string, unknown>>()
    if (isRecord(value)) {
        Object.entries(value).forEach(([key, data]) => {
            if (isRecord(data)) {
                const namespaceData = emptyRecord<unknown>()
                Object.entries(data).forEach(([dataKey, dataValue]) => {
                    namespaceData[dataKey] = dataValue
                })
                extensionData[key] = namespaceData
            }
        })
    }
    return extensionData
}

const createSession = (now: number, revision: string): PersistedSession => ({
    sessionId: createId(),
    sessionStartTimestamp: now,
    lastActivityTimestamp: now,
    revision,
})

const authorityRevision = (state: PersistedState | undefined): string | undefined =>
    state?.session?.revision ?? state?.sessionReset

const persistedAuthorityWins = (persisted: PersistedState, local: PersistedState): boolean => {
    const persistedRevision = authorityRevision(persisted)
    const localRevision = authorityRevision(local)
    const comparison = compareRevisions(persistedRevision, localRevision)
    if (comparison !== 0) {
        return comparison > 0
    }
    if (persistedRevision === undefined) {
        return false
    }
    if (!persisted.session || !local.session) {
        return !!persisted.session !== !!local.session
    }
    return (
        persisted.session.sessionId !== local.session.sessionId ||
        persisted.session.lastActivityTimestamp > local.session.lastActivityTimestamp
    )
}

const copyAuthority = (target: PersistedState, source: PersistedState): void => {
    delete target.session
    delete target.sessionReset
    if (source.session) {
        target.session = source.session
    } else if (source.sessionReset !== undefined) {
        target.sessionReset = source.sessionReset
    }
}

const nextRevision = (now: number, local: PersistedState, external: PersistedState | undefined): string => {
    const localRevision = authorityRevision(local)
    const externalRevision = authorityRevision(external)
    const latest = compareRevisions(localRevision, externalRevision) >= 0 ? localRevision : externalRevision
    const incremented = latest ? incrementRevision(latest) : '0'
    const clock = readRevision(now) ?? '0'
    return compareRevisions(clock, incremented) > 0 ? clock : incremented
}

const createInitialState = (deviceId = createId(), anonymousId = deviceId): PersistedState => ({
    version: 1,
    deviceId,
    anonymousId,
    distinctId: anonymousId,
    isIdentified: false,
    groups: emptyRecord<string>(),
    extensionData: emptyRecord<Record<string, unknown>>(),
})

const createDeniedState = (): PersistedState => ({
    version: 1,
    deviceId: '',
    anonymousId: '',
    distinctId: '',
    isIdentified: false,
    groups: emptyRecord<string>(),
    extensionData: emptyRecord<Record<string, unknown>>(),
})

const decodeConsent = (value: unknown): ConsentState | undefined => {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value
    return normalized === true ||
        normalized === 1 ||
        normalized === '1' ||
        normalized === 'true' ||
        normalized === 'yes'
        ? 'granted'
        : normalized === false ||
            normalized === 0 ||
            normalized === '0' ||
            normalized === 'false' ||
            normalized === 'no'
          ? 'denied'
          : undefined
}

const parseState = (value: string | null): PersistedState | undefined => {
    if (!value) {
        return undefined
    }

    try {
        const parsed: unknown = JSON.parse(value)
        if (!isRecord(parsed) || parsed.version !== 1) {
            return undefined
        }

        const anonymousId = parsed.anonymousId
        const distinctId = parsed.distinctId
        const deviceId = typeof parsed.deviceId === 'string' ? parsed.deviceId : anonymousId
        const hasSession = Object.prototype.hasOwnProperty.call(parsed, 'session')
        const hasReset = Object.prototype.hasOwnProperty.call(parsed, 'sessionReset')
        const session = readSession(parsed.session)
        const sessionReset = readRevision(parsed.sessionReset)
        if (
            typeof deviceId !== 'string' ||
            typeof anonymousId !== 'string' ||
            typeof distinctId !== 'string' ||
            (hasSession && !session) ||
            (hasReset && !sessionReset) ||
            (session && hasReset)
        ) {
            return undefined
        }

        return {
            version: 1,
            deviceId,
            anonymousId,
            distinctId,
            isIdentified: parsed.isIdentified === true || distinctId !== anonymousId,
            groups: readGroups(parsed.groups),
            ...(session ? { session } : {}),
            ...(sessionReset ? { sessionReset } : {}),
            extensionData: readExtensionData(parsed.extensionData),
        }
    } catch {
        return undefined
    }
}

export const getDefaultStorage = (): StorageLike | undefined => {
    try {
        return globalThis.localStorage
    } catch {
        return undefined
    }
}

export const getDefaultSessionStorage = (): StorageLike | undefined => {
    try {
        return globalThis.sessionStorage
    } catch {
        return undefined
    }
}

export class BrowserState {
    private _state: PersistedState
    private _consent: ConsentState
    private readonly _stateKey: string
    readonly consentKey: string
    private readonly _windowKey: string
    private readonly _primaryWindowKey: string
    private _windowId = ''
    private _windowStorage: StorageLike | undefined
    private _windowStorageInitialized = false
    private _windowListenerInstalled = false
    private _lastActivityWriteTimestamp = 0
    private _pendingSessionReason: 'reset' | undefined
    private _stateReadPending = false
    private _lastConsentValue: unknown = null
    private _ignoredConsentValue: unknown
    private _hasIgnoredConsentValue = false
    private _consentWriteFailed = false

    private readonly _storage: StorageLike | undefined
    private readonly _windowStorageFactory: (() => StorageLike | undefined) | undefined
    private readonly _defaultConsent: ConsentState
    private readonly _onDenied: () => void
    private readonly _beforeUnload = (): void => {
        this._flushSession()
        this._windowRemove(this._primaryWindowKey)
    }

    constructor(
        projectToken: string,
        storage: StorageLike | undefined,
        persistenceKey: string | undefined,
        consentPersistenceName: string | undefined,
        optOutByDefault: boolean,
        windowStorageFactory: (() => StorageLike | undefined) | undefined,
        onDenied: () => void
    ) {
        this._storage = storage
        this._windowStorageFactory = windowStorageFactory
        this._stateKey = persistenceKey ?? `ph_${projectToken}_posthog_browser_v2`
        const windowPrefix = persistenceKey ?? `ph_${projectToken}`
        this._windowKey = `${windowPrefix}_window_id`
        this._primaryWindowKey = `${windowPrefix}_primary_window_exists`
        this.consentKey =
            consentPersistenceName === undefined ? `__ph_opt_in_out_${projectToken}` : consentPersistenceName
        this._defaultConsent = optOutByDefault ? 'denied' : 'implicit'
        this._consent = this._defaultConsent
        this._onDenied = onDenied

        const [consentRead, storedConsent] = this._read(this.consentKey)
        if (consentRead) {
            this._lastConsentValue = storedConsent
            this._consent = decodeConsent(storedConsent) ?? this._defaultConsent
        }
        if (this._consent === 'denied') {
            this._state = createDeniedState()
            this._remove(this._stateKey)
        } else {
            const [stateRead, storedState] = this._read(this._stateKey)
            this._state = parseState(typeof storedState === 'string' ? storedState : null) ?? createInitialState()
            this._lastActivityWriteTimestamp = this._state.session?.lastActivityTimestamp ?? 0
            this._stateReadPending = !stateRead
            if (stateRead) {
                this._save()
            }
        }
    }

    prepare(): boolean {
        if (!this._stateReadPending) {
            return true
        }
        const [read, storedState] = this._read(this._stateKey)
        if (!read) {
            return false
        }
        this._stateReadPending = false
        const persisted = parseState(typeof storedState === 'string' ? storedState : null)
        if (persisted) {
            this._state = persisted
            this._lastActivityWriteTimestamp = persisted.session?.lastActivityTimestamp ?? 0
        } else {
            this._save(false)
        }
        return true
    }

    get deviceId(): string {
        return this._state.deviceId
    }

    get anonymousId(): string {
        return this._state.anonymousId
    }

    get distinctId(): string {
        return this._state.distinctId
    }

    get isIdentified(): boolean {
        return this._state.isIdentified
    }

    get groups(): Record<string, string> {
        return { ...this._state.groups }
    }

    get session(): SessionContext {
        const session = this._state.session
        return session && this._windowId
            ? {
                  sessionId: session.sessionId,
                  windowId: this._windowId,
                  sessionStartTimestamp: session.sessionStartTimestamp,
              }
            : { sessionId: '', windowId: '', sessionStartTimestamp: 0 }
    }

    get consent(): ConsentState {
        return this.refreshConsent()
    }

    refreshConsent(): ConsentState {
        const [read, value] = this._read(this.consentKey)
        return read ? this.observeConsent(value) : this._consent
    }

    observeConsent(value: unknown): ConsentState {
        if (this._hasIgnoredConsentValue && value === this._ignoredConsentValue) {
            return this._consent
        }
        this._hasIgnoredConsentValue = false
        this._consentWriteFailed = false
        this._lastConsentValue = value
        this._applyConsent(decodeConsent(value) ?? this._defaultConsent)
        return this._consent
    }

    identify(distinctId: string): void {
        this._state.distinctId = distinctId
        this._state.isIdentified = true
        this._save()
    }

    group(type: string, key: string): boolean {
        if (this._state.groups[type] === key) {
            return false
        }
        this._state.groups[type] = key
        this._save()
        return true
    }

    prepareSessionForEvent(now = Date.now()): PreparedSession {
        const safeNow = isTimestamp(now) ? now : 0
        const [sharedRead, external] = this._readPersistedState()
        let session = this._state.session
        let lastActivityWriteTimestamp = this._lastActivityWriteTimestamp
        let adoptedAfterReset = false
        if (sharedRead && external && persistedAuthorityWins(external, this._state)) {
            session = external.session
            if (session) {
                lastActivityWriteTimestamp = session.lastActivityTimestamp
                adoptedAfterReset = this._pendingSessionReason === 'reset'
            }
        }

        const pendingReason = this._pendingSessionReason
        const idle = session ? Math.abs(safeNow - session.lastActivityTimestamp) > 1_800_000 : false
        const maximum = session ? Math.abs(safeNow - session.sessionStartTimestamp) > 86_400_000 : false
        const rotated = !!(pendingReason || !session || idle || maximum)
        const reason = adoptedAfterReset
            ? 'reset'
            : (pendingReason ?? (idle ? 'idleTimeout' : maximum ? 'maxLength' : undefined))
        const preparedSession = rotated
            ? createSession(safeNow, nextRevision(safeNow, this._state, external))
            : { ...session!, lastActivityTimestamp: Math.max(safeNow, session!.lastActivityTimestamp) }
        const window = this._prepareWindow(rotated)
        return {
            context: {
                sessionId: preparedSession.sessionId,
                windowId: window.windowId,
                sessionStartTimestamp: preparedSession.sessionStartTimestamp,
            },
            session: preparedSession,
            reason,
            rotated,
            lastActivityWriteTimestamp,
            windowStorage: window.storage,
            windowStorageResolved: window.storageResolved,
            previousWindowId: this._windowId,
            previousWindowStorageInitialized: this._windowStorageInitialized,
            previousPendingReason: this._pendingSessionReason,
        }
    }

    sessionAdmitted(prepared: PreparedSession): boolean {
        const [, external] = this._readPersistedState()
        const preparedState = { ...this._state, session: prepared.session }
        delete preparedState.sessionReset
        if (external && persistedAuthorityWins(external, preparedState)) {
            return false
        }

        this._state.session = prepared.session
        delete this._state.sessionReset
        this._pendingSessionReason = undefined
        this._windowId = prepared.context.windowId
        this._initializeWindowStorage(prepared.windowStorage, prepared.windowStorageResolved)
        if (this._consent === 'denied') {
            this._clearWindow(true)
            return false
        }
        this._setWindowId(prepared.context.windowId)

        if (prepared.rotated) {
            this._lastActivityWriteTimestamp = prepared.session.lastActivityTimestamp
            this._save()
        } else if (Math.abs(prepared.session.lastActivityTimestamp - prepared.lastActivityWriteTimestamp) >= 60_000) {
            this._lastActivityWriteTimestamp = prepared.session.lastActivityTimestamp
            this._save()
        } else {
            this._lastActivityWriteTimestamp = prepared.lastActivityWriteTimestamp
        }
        if (this.refreshConsent() === 'denied') {
            return false
        }

        const [, committed] = this._readPersistedState()
        if (committed && persistedAuthorityWins(committed, preparedState)) {
            copyAuthority(this._state, committed)
            this._pendingSessionReason = prepared.previousPendingReason
            this._lastActivityWriteTimestamp = committed.session?.lastActivityTimestamp ?? 0
            if (prepared.previousWindowStorageInitialized) {
                this._setWindowId(prepared.previousWindowId)
            } else {
                this._clearWindow(true)
            }
            return false
        }
        return true
    }

    reset(): void {
        const [, external] = this._readPersistedState()
        const now = Date.now()
        const safeNow = isTimestamp(now) ? now : 0
        const resetRevision = nextRevision(safeNow, this._state, external)
        this._state = createInitialState(this._state.deviceId, createId())
        this._state.sessionReset = resetRevision
        this._lastActivityWriteTimestamp = 0
        this._pendingSessionReason = 'reset'
        this._clearWindow(true)
        this._save(false)
    }

    dispose(): void {
        this._flushSession()
        this._removeWindowListener()
        this._windowRemove(this._primaryWindowKey)
    }

    optIn(): boolean {
        this._applyConsent('granted')
        const written = this._writeConsent('1')
        this._save()
        return written
    }

    optOut(): boolean {
        this._applyConsent('denied')
        return this._writeConsent('0')
    }

    keyValueStore(namespace: string, canAccess: () => boolean = () => true): KeyValueStore {
        const values = (): Record<string, unknown> => (this._state.extensionData[namespace] ??= emptyRecord<unknown>())
        const read = (key: string): unknown => {
            if (!canAccess()) {
                return undefined
            }
            const value = values()[key]
            return value === undefined ? undefined : cloneJson(value)
        }

        return {
            initialize(): void {},
            get: (<T = unknown>(keyOrKeys: string | readonly string[]): T | Partial<T> | undefined => {
                if (typeof keyOrKeys === 'string') {
                    return read(keyOrKeys) as T | undefined
                }
                const entries = emptyRecord<unknown>()
                for (const key of keyOrKeys) {
                    const value = read(key)
                    if (value !== undefined) {
                        entries[key] = value
                    }
                }
                return entries as Partial<T>
            }) as KeyValueStore['get'],
            set: ((keyOrValues: string | Record<string, unknown>, value?: unknown): void => {
                if (!canAccess()) {
                    return
                }
                const namespaceValues = values()
                const entries = typeof keyOrValues === 'string' ? { [keyOrValues]: value } : keyOrValues
                for (const [key, entry] of Object.entries(entries)) {
                    if (entry === undefined) {
                        delete namespaceValues[key]
                    } else {
                        namespaceValues[key] = cloneJson(entry)
                    }
                }
                this._save()
            }) as KeyValueStore['set'],
            remove: (keyOrKeys: string | readonly string[]): void => {
                if (!canAccess()) {
                    return
                }
                const namespaceValues = values()
                for (const key of typeof keyOrKeys === 'string' ? [keyOrKeys] : keyOrKeys) {
                    delete namespaceValues[key]
                }
                this._save()
            },
        }
    }

    private _readPersistedState(): [read: boolean, state?: PersistedState] {
        if (!this._storage) {
            return [false]
        }
        const [read, value] = this._read(this._stateKey)
        if (!read) {
            return [false]
        }
        if (value === null) {
            return [true]
        }
        if (typeof value !== 'string') {
            return [false]
        }
        const state = parseState(value)
        return state ? [true, state] : [false]
    }

    private _prepareWindow(rotated: boolean): {
        windowId: string
        storage: StorageLike | undefined
        storageResolved: boolean
    } {
        if (rotated || this._windowId) {
            return { windowId: rotated ? createId() : this._windowId, storage: undefined, storageResolved: false }
        }

        let storage: StorageLike | undefined
        try {
            storage = this._windowStorageFactory?.()
        } catch {
            storage = undefined
        }
        let lastWindowId: string | null = null
        let primaryWindowExists: string | null = null
        try {
            lastWindowId = storage?.getItem(this._windowKey) ?? null
        } catch {
            // A fresh in-memory window remains available.
        }
        try {
            primaryWindowExists = storage?.getItem(this._primaryWindowKey) ?? null
        } catch {
            // A fresh in-memory window remains available.
        }
        const reusable = lastWindowId && (!primaryWindowExists || this._isReload()) ? lastWindowId : undefined
        return { windowId: reusable ?? createId(), storage, storageResolved: true }
    }

    private _initializeWindowStorage(
        preparedStorage: StorageLike | undefined = undefined,
        storageResolved = false
    ): void {
        if (this._windowStorageInitialized) {
            return
        }
        this._windowStorageInitialized = true
        if (storageResolved) {
            this._windowStorage = preparedStorage
        } else {
            try {
                this._windowStorage = this._windowStorageFactory?.()
            } catch {
                this._windowStorage = undefined
            }
        }
        const lastWindowId = this._windowRead(this._windowKey)
        const primaryWindowExists = this._windowRead(this._primaryWindowKey)
        if (lastWindowId && (!primaryWindowExists || this._isReload())) {
            this._windowId = lastWindowId
        } else if (primaryWindowExists) {
            this._windowRemove(this._windowKey)
        }
        if (!this._windowStorage) {
            return
        }
        try {
            // eslint-disable-next-line posthog-js/no-add-event-listener
            globalThis.addEventListener('beforeunload', this._beforeUnload)
            this._windowListenerInstalled = true
        } catch {
            // Try the unload fallback used by Firefox reloads.
        }
        try {
            // eslint-disable-next-line posthog-js/no-add-event-listener
            globalThis.addEventListener('unload', this._beforeUnload)
            this._windowListenerInstalled = true
        } catch {
            // beforeunload remains available when unload registration fails.
        }
        if (this._windowListenerInstalled) {
            this._windowSet(this._primaryWindowKey, '1')
        } else {
            this._windowRemove(this._windowKey)
            this._windowRemove(this._primaryWindowKey)
            this._windowStorage = undefined
        }
    }

    private _isReload(): boolean {
        try {
            return (
                (globalThis.performance?.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)
                    ?.type === 'reload'
            )
        } catch {
            return false
        }
    }

    private _setWindowId(windowId: string): void {
        this._windowId = windowId
        this._windowSet(this._windowKey, windowId)
    }

    private _clearWindow(removeWindow: boolean): void {
        this._removeWindowListener()
        if (removeWindow) {
            this._windowRemove(this._windowKey)
        }
        this._windowRemove(this._primaryWindowKey)
        this._windowStorage = undefined
        this._windowStorageInitialized = false
        this._windowId = ''
    }

    private _removeWindowListener(): void {
        if (!this._windowListenerInstalled) {
            return
        }
        for (const event of ['beforeunload', 'unload']) {
            try {
                globalThis.removeEventListener(event, this._beforeUnload)
            } catch {
                // Listener cleanup is best effort.
            }
        }
        this._windowListenerInstalled = false
    }

    private _flushSession(): void {
        const session = this._state.session
        if (!session || session.lastActivityTimestamp === this._lastActivityWriteTimestamp) {
            return
        }
        const [sharedRead, sharedState] = this._readPersistedState()
        const shared = sharedState?.session
        if (
            sharedRead &&
            (!shared ||
                shared.revision !== session.revision ||
                shared.sessionId !== session.sessionId ||
                shared.sessionStartTimestamp !== session.sessionStartTimestamp ||
                shared.lastActivityTimestamp > session.lastActivityTimestamp)
        ) {
            return
        }
        this._lastActivityWriteTimestamp = session.lastActivityTimestamp
        this._save(false)
    }

    private _windowRead(key: string): string | null {
        try {
            return this._windowStorage?.getItem(key) ?? null
        } catch {
            return null
        }
    }

    private _windowSet(key: string, value: string): void {
        try {
            this._windowStorage?.setItem(key, value)
        } catch {
            // Window IDs remain usable in memory.
        }
    }

    private _windowRemove(key: string): void {
        try {
            this._windowStorage?.removeItem(key)
        } catch {
            // Window state is already clear in memory.
        }
    }

    private _applyConsent(consent: ConsentState): void {
        if (consent === this._consent) {
            return
        }
        const wasDenied = this._consent === 'denied'
        this._consent = consent
        if (consent === 'denied') {
            this._state = createDeniedState()
            this._stateReadPending = false
            this._lastActivityWriteTimestamp = 0
            this._pendingSessionReason = undefined
            this._clearWindow(true)
            this._remove(this._stateKey)
            this._notifyDenied()
        } else if (wasDenied) {
            this._state = createInitialState()
            this._stateReadPending = false
            this._lastActivityWriteTimestamp = 0
        }
    }

    private _notifyDenied(): void {
        try {
            this._onDenied()
        } catch {
            // Consent remains denied when host cleanup fails.
        }
    }

    private _save(preserveSession = true): void {
        if (!this.prepare() || this.refreshConsent() === 'denied' || this._consentWriteFailed) {
            return
        }

        let state = this._state
        if (preserveSession) {
            const [read, persisted] = this._readPersistedState()
            if (read && persisted && persistedAuthorityWins(persisted, state)) {
                state = { ...state }
                copyAuthority(state, persisted)
            }
        }
        try {
            this._storage?.setItem(this._stateKey, JSON.stringify(state))
        } catch {
            // Storage failure changes persistence, not capture behavior.
        }
    }

    private _writeConsent(value: '0' | '1'): boolean {
        if (!this._storage) {
            this._ignoredConsentValue = this._lastConsentValue
            this._hasIgnoredConsentValue = true
            this._consentWriteFailed = true
            return false
        }
        try {
            this._storage.setItem(this.consentKey, value)
            this._lastConsentValue = value
            this._hasIgnoredConsentValue = false
            this._consentWriteFailed = false
            return true
        } catch {
            this._ignoredConsentValue = this._lastConsentValue
            this._hasIgnoredConsentValue = true
            this._consentWriteFailed = true
            return false
        }
    }

    private _read(key: string): StoredValue {
        if (!this._storage) {
            return [true, null]
        }
        try {
            return [true, this._storage.getItem(key)]
        } catch {
            return [false, null]
        }
    }

    private _remove(key: string): void {
        try {
            this._storage?.removeItem(key)
        } catch {
            // The in-memory state is already clear.
        }
    }
}
