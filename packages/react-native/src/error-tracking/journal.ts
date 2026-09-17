import { isObject, JsonType, PostHogEventProperties } from '@posthog/core'

// Attribution fields the journal carries across launches. All of these are SDK / device /
// session identifiers — none are user-supplied properties — so reapplying them on recovery
// is safe even when before_send has scrubbed user properties off the recovered event.
// Anything outside this allowlist is reconstructed by the next launch's runtime state
// (or by before_send), which is the right behavior: it lets the customer's hook stay
// the final authority.
export const FATAL_JOURNAL_ATTRIBUTION_KEYS = [
  '$session_id',
  '$device_id',
  // SDK metadata — fixed per release, so a fix shipped in app version N still attributes
  // to N (and not to the relaunch's N+1) when recovered.
  '$app_version',
  '$app_build',
  '$app_namespace',
  '$app_name',
  '$os_name',
  '$os_version',
  '$device_type',
  '$device_manufacturer',
  '$device_name',
  '$is_emulator',
  '$locale',
  '$timezone',
  '$lib',
  '$lib_version',
  '$screen_height',
  '$screen_width',
  // Crash-time exception-only context that the next launch's runtime would otherwise
  // overwrite with its own state.
  '$app_state',
  '$expo_update_id',
  '$expo_runtime_version',
  '$expo_channel',
  '$expo_is_embedded_launch',
  '$exception_steps',
] as const

export interface FatalJournalEntry {
  id: string
  eventUuid: string
  timestamp: string
  sessionId: string
  distinctId: string
  deviceId: string
  // Crash-time snapshot of attribution fields (SDK metadata + exception-only context).
  // Only the keys in FATAL_JOURNAL_ATTRIBUTION_KEYS are carried across launches;
  // everything else is reconstructed by the next launch or scrubbed by before_send.
  attribution: { [key: string]: JsonType }
  exceptionList: Array<{ [key: string]: JsonType }>
  exceptionLevel: string
  exceptionSteps?: Array<{ [key: string]: JsonType }>
  // Crash-time opt-out flag. If true at crash time, the entry is dropped on recovery
  // regardless of whether the user has since opted back in — privacy carry-over.
  optedOut: boolean
  // SHA-256 hash of the API key that produced this entry, so multi-client apps ingest only
  // their own entries on recovery. Other clients' entries are left in place so they can
  // still recover them on their own launch.
  apiKeyHash: string
}

const MAX_EXCEPTION_STEPS_BYTES = 8 * 1024

const approxJsonBytes = (value: unknown): number => {
  try {
    return JSON.stringify(value).length
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

const boundedExceptionSteps = (
  steps: ReadonlyArray<{ [key: string]: JsonType }> | undefined
): Array<{ [key: string]: JsonType }> | undefined => {
  if (!steps || steps.length === 0) {
    return undefined
  }
  let kept: Array<{ [key: string]: JsonType }> = []
  for (const step of steps) {
    const next = [...kept, step]
    if (approxJsonBytes(next) > MAX_EXCEPTION_STEPS_BYTES) {
      break
    }
    kept = next
  }
  return kept.length > 0 ? kept : undefined
}

export interface BuildFatalJournalEntryInput {
  id: string
  eventUuid: string
  timestamp: string
  sessionId: string
  distinctId: string
  deviceId: string
  attribution: PostHogEventProperties
  exceptionList: PostHogEventProperties['$exception_list']
  exceptionLevel: string
  exceptionSteps?: PostHogEventProperties['$exception_steps']
  optedOut: boolean
  apiKeyHash: string
}

const pickAttribution = (properties: PostHogEventProperties): { [key: string]: JsonType } => {
  const out: { [key: string]: JsonType } = {}
  for (const key of FATAL_JOURNAL_ATTRIBUTION_KEYS) {
    if (properties[key] !== undefined) {
      out[key] = properties[key] as JsonType
    }
  }
  return out
}

export const buildFatalJournalEntry = (input: BuildFatalJournalEntryInput): FatalJournalEntry => {
  if (!input.id || !input.eventUuid || !input.timestamp) {
    throw new Error('buildFatalJournalEntry: id, eventUuid and timestamp are required')
  }
  if (!input.apiKeyHash) {
    throw new Error('buildFatalJournalEntry: apiKeyHash is required')
  }
  if (!Array.isArray(input.exceptionList) || input.exceptionList.length === 0) {
    throw new Error('buildFatalJournalEntry: exceptionList must be a non-empty array')
  }
  const steps = boundedExceptionSteps(
    input.exceptionSteps as ReadonlyArray<{ [key: string]: JsonType }> | undefined
  )
  return {
    id: input.id,
    eventUuid: input.eventUuid,
    timestamp: input.timestamp,
    sessionId: input.sessionId || '',
    distinctId: input.distinctId || '',
    deviceId: input.deviceId || '',
    attribution: pickAttribution(input.attribution),
    exceptionList: input.exceptionList.map((e) => ({ ...(e as { [key: string]: JsonType }) })),
    exceptionLevel: input.exceptionLevel || 'fatal',
    exceptionSteps: steps,
    optedOut: !!input.optedOut,
    apiKeyHash: input.apiKeyHash,
  }
}

export const serializeFatalJournalEntry = (entry: FatalJournalEntry): string => {
  return JSON.stringify(entry)
}

// Returns null on any structural failure so a corrupt file can't trap every launch — the
// caller is expected to delete the offending entry on disk.
export const parseFatalJournalEntry = (raw: string): FatalJournalEntry | null => {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObject(parsed)) {
    return null
  }
  const candidate = parsed as Record<string, unknown>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.eventUuid !== 'string' ||
    typeof candidate.timestamp !== 'string' ||
    typeof candidate.sessionId !== 'string' ||
    typeof candidate.distinctId !== 'string' ||
    typeof candidate.deviceId !== 'string' ||
    typeof candidate.exceptionLevel !== 'string' ||
    typeof candidate.optedOut !== 'boolean' ||
    typeof candidate.apiKeyHash !== 'string' ||
    !isObject(candidate.attribution) ||
    !Array.isArray(candidate.exceptionList) ||
    candidate.exceptionList.length === 0
  ) {
    return null
  }
  for (const exc of candidate.exceptionList) {
    if (!isObject(exc)) {
      return null
    }
  }
  if (candidate.exceptionSteps !== undefined) {
    if (!Array.isArray(candidate.exceptionSteps)) {
      return null
    }
    for (const step of candidate.exceptionSteps) {
      if (!isObject(step)) {
        return null
      }
    }
  }
  return {
    id: candidate.id,
    eventUuid: candidate.eventUuid,
    timestamp: candidate.timestamp,
    sessionId: candidate.sessionId,
    distinctId: candidate.distinctId,
    deviceId: candidate.deviceId,
    exceptionLevel: candidate.exceptionLevel,
    attribution: { ...(candidate.attribution as { [key: string]: JsonType }) },
    exceptionList: (candidate.exceptionList as Array<{ [key: string]: JsonType }>).map((e) => ({
      ...e,
    })),
    exceptionSteps:
      candidate.exceptionSteps === undefined
        ? undefined
        : (candidate.exceptionSteps as Array<{ [key: string]: JsonType }>).map((s) => ({ ...s })),
    optedOut: candidate.optedOut,
    apiKeyHash: candidate.apiKeyHash,
  }
}

// FIFO-bounded list. Tiny size (100) avoids a real Set; backed by AsyncStorage as a JSON array.
export const FATAL_JOURNAL_INGESTED_MAX = 100

export const appendFatalJournalIngested = (existing: string[] | undefined, id: string): string[] => {
  const base = Array.isArray(existing) ? existing.slice() : []
  if (base.includes(id)) {
    return base
  }
  base.push(id)
  if (base.length > FATAL_JOURNAL_INGESTED_MAX) {
    base.splice(0, base.length - FATAL_JOURNAL_INGESTED_MAX)
  }
  return base
}

export const hasFatalJournalIngested = (existing: string[] | undefined, id: string): boolean => {
  return Array.isArray(existing) && existing.includes(id)
}

// Reconstitutes the $exception event using the captured crash-time snapshot. The exception
// list and level carry straight through; the attribution snapshot is spread into user-side
// properties and `processBeforeEnqueue` re-applies it after `enrichProperties` has
// overwritten it with the next launch's runtime state. before_send then runs against the
// final message — customer hooks stay the final authority over user properties; attribution
// fields are reapplied AFTER before_send (since they're SDK / device / session identifiers,
// not user data, reapplying them can't resurrect anything before_send stripped).
export const entryToEventProperties = (
  entry: FatalJournalEntry
): {
  properties: PostHogEventProperties
  uuid: string
  timestamp: string
} => {
  const properties: PostHogEventProperties = {
    ...entry.attribution,
    $exception_list: entry.exceptionList,
    $exception_level: entry.exceptionLevel,
  }
  if (entry.exceptionSteps && entry.exceptionSteps.length > 0) {
    properties.$exception_steps = entry.exceptionSteps
  }
  return {
    properties,
    uuid: entry.eventUuid,
    timestamp: entry.timestamp,
  }
}

// Returns the attribution keys that must survive before_send. Reapply ONLY these in
// processBeforeEnqueue (after super.processBeforeEnqueue, which is where before_send
// runs). User properties are not in this list — if a customer hook removes them, the
// recovery respects that removal.
export const FATAL_JOURNAL_ATTRIBUTION_OVERRIDE_KEYS = FATAL_JOURNAL_ATTRIBUTION_KEYS

// SHA-256 hex digest of an API key. Used to scope journal entries to the producing client so
// multi-client setups don't ingest each other's crashes.
export const hashApiKey = async (apiKey: string): Promise<string> => {
  if (!apiKey) {
    return ''
  }
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const data = new TextEncoder().encode(apiKey)
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
    const bytes = new Uint8Array(digest)
    let hex = ''
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0')
    }
    return hex
  }
  // Web Crypto is unavailable (very old runtime). Fall back to a stable JS hash so the dedup
  // check still has something to compare. Not cryptographic, but the journal never leaves
  // the device, so we just need a deterministic, collision-resistant identifier.
  return fallbackHash(apiKey)
}

// Tiny FNV-1a 32-bit hash, hex-encoded. Deterministic, collision-resistant enough for the
// "is this entry mine?" check below. Not cryptographic — see hashApiKey().
const fallbackHash = (s: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}