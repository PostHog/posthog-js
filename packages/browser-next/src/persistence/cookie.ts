import {
    ENABLED_FEATURE_FLAGS,
    FLAG_CALL_REPORTED,
    PERSISTENCE_ACTIVE_FEATURE_FLAGS,
    PERSISTENCE_FEATURE_FLAG_DETAILS,
    PERSISTENCE_FEATURE_FLAG_ERRORS,
    PERSISTENCE_FEATURE_FLAG_EVALUATED_AT,
    PERSISTENCE_FEATURE_FLAG_PAYLOADS,
    PERSISTENCE_FEATURE_FLAG_REQUEST_ID,
    STORED_GROUP_PROPERTIES_KEY,
    STORED_PERSON_PROPERTIES_KEY,
} from '@posthog/browser-common/constants'
import { createId } from '../primitives/id'
import { CLIENT_KV_NAMESPACE } from '../core/state/state'
import { isValidDistinctId } from '../products/analytics/analytics-core'
import { REGISTERED_PROPERTIES } from '../products/analytics/properties/analytics-properties'
import type { CookiePersistence, StorageLike } from '../core/types'

export type { CookiePersistence }

export interface CookiePersistenceOptions {
    /** Share the cookie with every subdomain of the site. Defaults to `true`, except on herokuapp.com, vercel.app and netlify.app. */
    crossSubdomain?: boolean
    /** Send the cookie only over HTTPS. Defaults to `true` on HTTPS pages. */
    secure?: boolean
    /** Days until the cookie expires. Each write renews it. Defaults to 365. */
    expirationDays?: number
    /** Cookie name. Defaults to `ph_<project token>_posthog`, the name `posthog-js` uses. */
    name?: string
}

interface CookieSettings {
    readonly crossSubdomain: boolean
    readonly secure: boolean
    readonly expirationDays: number
}

type Values = Record<string, unknown>

// Flag and person-property caches that belong to one person. posthog-js drops them when the cookie identity differs.
const IDENTITY_BOUND_KEYS = [
    STORED_PERSON_PROPERTIES_KEY,
    PERSISTENCE_ACTIVE_FEATURE_FLAGS,
    ENABLED_FEATURE_FLAGS,
    PERSISTENCE_FEATURE_FLAG_DETAILS,
    PERSISTENCE_FEATURE_FLAG_PAYLOADS,
    PERSISTENCE_FEATURE_FLAG_REQUEST_ID,
    PERSISTENCE_FEATURE_FLAG_EVALUATED_AT,
    PERSISTENCE_FEATURE_FLAG_ERRORS,
    FLAG_CALL_REPORTED,
]
const SHARED_HOSTING_DOMAINS = ['herokuapp.com', 'vercel.app', 'netlify.app']
const REVISION = /^(0|[1-9]\d*)$/

const isRecord = (value: unknown): value is Values =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

const isTimestamp = (value: unknown): value is number =>
    // oxlint-disable-next-line posthog-js/no-direct-number-check
    typeof value === 'number' && Number.isFinite(value) && value >= 0

const getDocument = (): Document | undefined => {
    try {
        return globalThis.document
    } catch {
        return undefined
    }
}

const getLocation = (): Location | undefined => {
    try {
        return globalThis.location
    } catch {
        return undefined
    }
}

const readCookie = (name: string): Values | undefined => {
    try {
        const prefix = `${name}=`
        for (const part of getDocument()?.cookie.split(';') ?? []) {
            const cookie = part.trim()
            if (cookie.startsWith(prefix)) {
                const value: unknown = JSON.parse(decodeURIComponent(cookie.slice(prefix.length)))
                return isRecord(value) ? value : undefined
            }
        }
    } catch {
        // An unreadable cookie leaves local state authoritative.
    }
    return undefined
}

/** Finds the broadest domain the browser accepts a cookie for, which excludes public suffixes such as `co.uk`. */
const findSiteDomain = (document: Document, hostname: string): string => {
    if (hostname === 'localhost' || /^[\d.]+$|:/.test(hostname)) return ''
    const parts = hostname.split('.')
    const probe = `dmn_chk_${createId()}`
    for (let length = 1; length <= Math.min(parts.length, 8); length++) {
        const candidate = parts.slice(-length).join('.')
        const cookie = `${probe}=1; domain=.${candidate}; path=/`
        document.cookie = `${cookie}; max-age=3`
        if (document.cookie.includes(probe)) {
            document.cookie = `${cookie}; max-age=0`
            return candidate
        }
    }
    return /[a-z0-9][a-z0-9-]+\.[a-z]{2,}$/i.exec(hostname)?.[0] ?? ''
}

/** Overlays the cookie's identity, session and person-processing state on the local record, as posthog-js does. */
const mergeCookie = (local: string | null, cookie: Values | undefined): string | null => {
    const distinctId = cookie?.distinct_id
    if (!cookie || !isValidDistinctId(distinctId)) return local
    let record: Values | undefined
    try {
        const parsed: unknown = local ? JSON.parse(local) : undefined
        record = isRecord(parsed) && parsed.version === 1 ? parsed : undefined
    } catch {
        record = undefined
    }
    const identified =
        cookie.$user_state === 'identified' ||
        (cookie.$user_state === undefined && record?.distinctId === distinctId && record.isIdentified === true)
    const sameUser = record?.distinctId === distinctId && (record.isIdentified === true) === identified
    const deviceId =
        typeof cookie.$device_id === 'string' && cookie.$device_id
            ? cookie.$device_id
            : typeof record?.deviceId === 'string'
              ? record.deviceId
              : distinctId
    const extensionData = isRecord(record?.extensionData) ? record.extensionData : {}
    const data = isRecord(extensionData[CLIENT_KV_NAMESPACE]) ? extensionData[CLIENT_KV_NAMESPACE] : {}
    extensionData[CLIENT_KV_NAMESPACE] = data
    const merged: Values = {
        groups: {},
        ...record,
        version: 1,
        deviceId,
        // An identify elsewhere keeps the local anonymous ID; an unrelated identified user falls back to the device ID.
        anonymousId: !identified
            ? distinctId
            : typeof record?.anonymousId === 'string' && (sameUser || record.isIdentified !== true)
              ? record.anonymousId
              : deviceId,
        distinctId,
        isIdentified: identified,
        extensionData,
    }
    if (!sameUser) {
        for (const key of IDENTITY_BOUND_KEYS) delete data[key]
        // A new anonymous user means another subdomain reset, which clears the previous user's event context.
        if (!identified) {
            merged.groups = {}
            delete data[STORED_GROUP_PROPERTIES_KEY]
            delete data[REGISTERED_PROPERTIES]
        }
    }
    if (cookie.$epp === true) data.personProcessingEnabled = true
    else delete data.personProcessingEnabled

    delete merged.session
    delete merged.sessionReset
    const [lastActivityTimestamp, sessionId, start, revision] = Array.isArray(cookie.$sesid) ? cookie.$sesid : []
    // Old posthog-js cookies store [lastActivityTimestamp, sessionId] only.
    const sessionStartTimestamp: unknown = start ?? lastActivityTimestamp
    const validRevision = typeof revision === 'string' && REVISION.test(revision) ? revision : undefined
    const knownSession = isRecord(record?.session) ? record.session : undefined
    // posthog-js omits the revision when it records activity. Activity in the session this context already knows
    // keeps that session's revision, so the newer activity applies instead of looking like an older session.
    const knownRevision =
        knownSession !== undefined &&
        knownSession.sessionId === sessionId &&
        knownSession.sessionStartTimestamp === sessionStartTimestamp &&
        typeof knownSession.revision === 'string' &&
        REVISION.test(knownSession.revision)
            ? knownSession.revision
            : undefined
    if (
        typeof sessionId === 'string' &&
        sessionId &&
        isTimestamp(lastActivityTimestamp) &&
        isTimestamp(sessionStartTimestamp) &&
        (validRevision || Number.isSafeInteger(sessionStartTimestamp))
    ) {
        // Otherwise a session start time orders posthog-js sessions the same way browser revisions do.
        merged.session = {
            sessionId,
            sessionStartTimestamp,
            lastActivityTimestamp,
            revision: validRevision ?? knownRevision ?? String(sessionStartTimestamp),
        }
    } else if (validRevision) {
        merged.sessionReset = validRevision
    }
    return JSON.stringify(merged)
}

/** The distinct ID and identified state a record or cookie describes. */
type Identity = readonly [distinctId: unknown, identified: boolean]

const sameIdentity = (cookie: Values, identity: Identity): boolean =>
    cookie.distinct_id === identity[0] &&
    (cookie.$user_state === undefined || (cookie.$user_state === 'identified') === identity[1])

/**
 * Projects a state record onto posthog-js cookie keys. A stale writer keeps the cookie's identity and updates only
 * the session, which the state's own revisions already reconciled. Unknown posthog-js keys survive unless a reset
 * started a new person.
 */
const toCookie = (record: Values, existing: Values | undefined, stale: boolean): Values => {
    const identified = record.isIdentified === true
    const reset = record.sessionReset !== undefined || (!identified && existing?.distinct_id !== record.distinctId)
    const value: Values = existing && (stale || !reset) ? existing : {}
    if (!stale) {
        value.distinct_id = record.distinctId
        value.$device_id = record.deviceId
        value.$user_state = identified ? 'identified' : 'anonymous'
        const extensionData = record.extensionData
        const data = isRecord(extensionData) ? extensionData[CLIENT_KV_NAMESPACE] : undefined
        if (isRecord(data) && data.personProcessingEnabled === true) value.$epp = true
        else delete value.$epp
    }
    const session = record.session
    // The fourth element carries the browser session revision; posthog-js reads the first three.
    value.$sesid = isRecord(session)
        ? [session.lastActivityTimestamp, session.sessionId, session.sessionStartTimestamp, session.revision]
        : [null, null, null, record.sessionReset ?? null]
    return value
}

/** Writes the cookie for `site`, or for the current host only when `site` is empty. */
const writeCookie = (
    document: Document,
    name: string,
    value: Values | undefined,
    settings: CookieSettings,
    site: string
): void => {
    const attributes = `; SameSite=Lax; path=/${site ? `; domain=.${site}` : ''}${settings.secure ? '; secure' : ''}`
    document.cookie = value
        ? `${name}=${encodeURIComponent(JSON.stringify(value))}; expires=${new Date(
              Date.now() + settings.expirationDays * 86_400_000
          ).toUTCString()}${attributes}`
        : `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT${attributes}`
}

/**
 * Persists identity and session state in a cookie as well as local storage, so subdomains of a site share one
 * identity. An open page adopts an identify or reset from another subdomain before its next event or identity
 * operation. The cookie uses the `posthog-js` name and keys, so identities continue across a migration and between
 * sites that use either SDK. Consent stays in local storage, as in `posthog-js`.
 */
export const cookiePersistence = (options: CookiePersistenceOptions = {}): CookiePersistence => {
    let snapshot: CookiePersistenceOptions = {}
    try {
        snapshot = { ...options }
    } catch {
        // Unreadable options use the defaults.
    }
    return {
        wrap(storage: StorageLike, stateKey: string, projectToken: string): StorageLike {
            const location = getLocation()
            let hostname = ''
            let https = false
            try {
                hostname = location?.hostname ?? ''
                https = location?.protocol === 'https:'
            } catch {
                // Defaults apply without a readable location.
            }
            const name =
                snapshot.name ??
                `ph_${projectToken.replace(/\+/g, 'PL').replace(/\//g, 'SL').replace(/=/g, 'EQ')}_posthog`
            const settings: CookieSettings = {
                crossSubdomain:
                    snapshot.crossSubdomain ??
                    !SHARED_HOSTING_DOMAINS.includes(hostname.split('.').slice(-2).join('.')),
                secure: snapshot.secure ?? https,
                expirationDays: snapshot.expirationDays ?? 365,
            }
            let siteDomain: string | undefined
            const site = (document: Document): string => (siteDomain ??= findSiteDomain(document, hostname))
            // The identity this context loaded or last wrote. A different cookie identity is newer than ours.
            let known: Identity | undefined
            let scoped = false
            const write = (state: string | undefined): void => {
                try {
                    const document = getDocument()
                    if (!document) return
                    const existing = readCookie(name)
                    if (!scoped) {
                        // A cookie at the other scope would shadow every later read, so remove it once the first
                        // read has loaded its values, as posthog-js does.
                        scoped = true
                        if (settings.crossSubdomain ? site(document) : existing && site(document)) {
                            writeCookie(
                                document,
                                name,
                                undefined,
                                settings,
                                settings.crossSubdomain ? '' : site(document)
                            )
                        }
                    }
                    let value: Values | undefined
                    let identity: Identity | undefined
                    if (state !== undefined) {
                        const record: unknown = JSON.parse(state)
                        if (!isRecord(record) || typeof record.distinctId !== 'string') return
                        identity = [record.distinctId, record.isIdentified === true]
                        const stale =
                            !!existing &&
                            !!known &&
                            isValidDistinctId(existing.distinct_id) &&
                            !sameIdentity(existing, known) &&
                            identity[0] === known[0] &&
                            identity[1] === known[1]
                        if (stale) identity = undefined
                        value = toCookie(record, existing, stale)
                    }
                    writeCookie(document, name, value, settings, settings.crossSubdomain ? site(document) : '')
                    // A rejected write must not make this context's identity look current.
                    const written = identity && readCookie(name)
                    if (identity && written && sameIdentity(written, identity)) known = identity
                } catch {
                    // Local storage remains authoritative when the cookie cannot be written.
                }
            }
            return {
                getItem: (key) => {
                    if (key !== stateKey) return storage.getItem(key)
                    const merged = mergeCookie(storage.getItem(key), readCookie(name))
                    if (!known && merged) {
                        try {
                            const record: unknown = JSON.parse(merged)
                            if (isRecord(record)) known = [record.distinctId, record.isIdentified === true]
                        } catch {
                            // An unreadable record leaves the first write to establish the identity.
                        }
                    }
                    return merged
                },
                setItem: (key, value) => {
                    if (key === stateKey) write(value)
                    storage.setItem(key, value)
                },
                removeItem: (key) => {
                    if (key === stateKey) write(undefined)
                    storage.removeItem(key)
                },
                ...(storage.subscribe
                    ? { subscribe: (key: string, listener: () => void) => storage.subscribe!(key, listener) }
                    : {}),
            }
        },
    }
}
