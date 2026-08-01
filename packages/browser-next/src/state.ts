import type { KeyValueStore, SessionContext } from '@posthog/browser-common'

import { createId } from './id'
import type { NewSessionReason, StorageLike } from './types'

type ConsentState = 'implicit' | 'granted' | 'denied'

interface PersistedSession {
    sessionId: string
    sessionStartTimestamp: number
    lastActivityTimestamp: number
}

interface PersistedState {
    version: 1
    anonymousId: string
    distinctId: string
    isIdentified: boolean
    groups: Record<string, string>
    session: PersistedSession
    extensionData: Record<string, Record<string, unknown>>
}

interface SessionUpdate {
    session: SessionContext
    reason?: NewSessionReason
}

const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000
const SESSION_MAX_LENGTH_MS = 24 * 60 * 60 * 1000
const SESSION_ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000

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

const readSession = (value: unknown): PersistedSession | undefined => {
    if (!isRecord(value)) {
        return undefined
    }

    const { sessionId, sessionStartTimestamp, lastActivityTimestamp } = value
    if (
        typeof sessionId !== 'string' ||
        typeof sessionStartTimestamp !== 'number' ||
        typeof lastActivityTimestamp !== 'number'
    ) {
        return undefined
    }

    return { sessionId, sessionStartTimestamp, lastActivityTimestamp }
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

const createSession = (now = Date.now()): PersistedSession => ({
    sessionId: createId(),
    sessionStartTimestamp: now,
    lastActivityTimestamp: now,
})

const createInitialState = (): PersistedState => {
    const anonymousId = createId()
    return {
        version: 1,
        anonymousId,
        distinctId: anonymousId,
        isIdentified: false,
        groups: emptyRecord<string>(),
        session: createSession(),
        extensionData: emptyRecord<Record<string, unknown>>(),
    }
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
        const session = readSession(parsed.session)
        if (typeof anonymousId !== 'string' || typeof distinctId !== 'string' || !session) {
            return undefined
        }

        return {
            version: 1,
            anonymousId,
            distinctId,
            isIdentified: parsed.isIdentified === true || distinctId !== anonymousId,
            groups: readGroups(parsed.groups),
            session,
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

export class BrowserState {
    private _state: PersistedState = createInitialState()
    private _consent: ConsentState
    private readonly _stateKey: string
    private readonly _consentKey: string
    private readonly _windowId = createId()
    private _lastActivityWriteTimestamp = 0

    constructor(
        projectToken: string,
        private readonly _storage: StorageLike | undefined,
        persistenceKey: string | undefined,
        optOutByDefault: boolean
    ) {
        this._stateKey = persistenceKey ?? `ph_${projectToken}_posthog_browser_v2`
        this._consentKey = `${this._stateKey}_consent`
        this._consent = optOutByDefault ? 'denied' : 'implicit'
        this._load()
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
        return {
            sessionId: this._state.session.sessionId,
            windowId: this._windowId,
            sessionStartTimestamp: this._state.session.sessionStartTimestamp,
        }
    }

    get consent(): ConsentState {
        return this._consent
    }

    identify(distinctId: string): void {
        this._state.distinctId = distinctId
        this._state.isIdentified = true
        this._save()
    }

    group(type: string, key: string): void {
        this._state.groups[type] = key
        this._save()
    }

    sessionForEvent(now = Date.now()): SessionUpdate {
        const { sessionStartTimestamp, lastActivityTimestamp } = this._state.session
        let reason: NewSessionReason | undefined
        if (now - lastActivityTimestamp > SESSION_IDLE_TIMEOUT_MS) {
            reason = 'idleTimeout'
        } else if (now - sessionStartTimestamp > SESSION_MAX_LENGTH_MS) {
            reason = 'maxLength'
        }

        if (reason) {
            this._state.session = createSession(now)
            this._lastActivityWriteTimestamp = now
            this._save()
            return { session: this.session, reason }
        }

        this._state.session.lastActivityTimestamp = now
        if (now - this._lastActivityWriteTimestamp >= SESSION_ACTIVITY_WRITE_INTERVAL_MS) {
            this._lastActivityWriteTimestamp = now
            this._save()
        }
        return { session: this.session }
    }

    reset(): SessionContext {
        this._state = createInitialState()
        this._lastActivityWriteTimestamp = this._state.session.lastActivityTimestamp
        this._save()
        return this.session
    }

    optIn(): void {
        this._consent = 'granted'
        this._writeConsent()
        this._save()
    }

    optOut(): void {
        this._consent = 'denied'
        this._state = createInitialState()
        this._remove(this._stateKey)
        this._writeConsent()
    }

    keyValueStore(namespace: string): KeyValueStore {
        const values = (): Record<string, unknown> => {
            if (!Object.prototype.hasOwnProperty.call(this._state.extensionData, namespace)) {
                this._state.extensionData[namespace] = emptyRecord<unknown>()
            }
            return this._state.extensionData[namespace] ?? emptyRecord<unknown>()
        }

        return {
            get: async <T = unknown>(key: string): Promise<T | undefined> => {
                const value = values()[key]
                return value === undefined ? undefined : cloneJson(value as T)
            },
            set: async (key: string, value: unknown): Promise<void> => {
                if (value === null || value === undefined) {
                    delete values()[key]
                } else {
                    values()[key] = cloneJson(value)
                }
                this._save()
            },
            remove: async (key: string): Promise<void> => {
                delete values()[key]
                this._save()
            },
        }
    }

    private _load(): void {
        const storedConsent = this._read(this._consentKey)
        if (storedConsent === 'granted' || storedConsent === 'denied') {
            this._consent = storedConsent
        }

        if (this._consent === 'denied') {
            this._remove(this._stateKey)
            return
        }

        this._state = parseState(this._read(this._stateKey)) ?? this._state
        this._lastActivityWriteTimestamp = this._state.session.lastActivityTimestamp
        this._save()
    }

    private _save(): void {
        if (this._consent === 'denied') {
            return
        }

        try {
            this._storage?.setItem(this._stateKey, JSON.stringify(this._state))
        } catch {
            // Storage failure changes persistence, not capture behavior.
        }
    }

    private _writeConsent(): void {
        if (this._consent === 'implicit') {
            return
        }

        try {
            this._storage?.setItem(this._consentKey, this._consent)
        } catch {
            // The client keeps consent in memory when storage fails.
        }
    }

    private _read(key: string): string | null {
        try {
            return this._storage?.getItem(key) ?? null
        } catch {
            return null
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
