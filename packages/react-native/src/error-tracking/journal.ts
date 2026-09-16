import { isObject, JsonType, PostHogEventProperties } from '@posthog/core'

export interface FatalJournalEntry {
  id: string
  eventUuid: string
  timestamp: string
  sessionId: string
  distinctId: string
  deviceId: string
  // Crash-time snapshot of getCommonEventProperties(), so a fix shipped in app version N doesn't
  // look like a regression on a relaunch into N+1 (which would otherwise re-derive $app_version,
  // $os_version, $lib_version from the new launch's state). Includes $app_version, $app_build,
  // $os_name, $os_version, $lib, $lib_version, $screen_*, plus any $active_feature_flags that
  // were active at crash time.
  commonProperties: { [key: string]: JsonType }
  // Crash-time final additionalProperties (getExceptionContext() merged with caller-supplied
  // properties and exception steps). Captures exception-only fields that aren't part of
  // commonProperties: $app_state, $expo_update_id, $expo_runtime_version, $expo_channel,
  // $expo_is_embedded_launch, $exception_steps. The next launch's AppState/expo context would
  // otherwise overwrite these.
  capturedProperties: { [key: string]: JsonType }
  exceptionList: Array<{ [key: string]: JsonType }>
  exceptionLevel: string
  exceptionSteps?: Array<{ [key: string]: JsonType }>
  // Crash-time opt-out flag. If true at crash time, the entry is dropped on recovery
  // regardless of whether the user has since opted back in — privacy carry-over.
  optedOut: boolean
  // SHA-256 hash of the API key that produced this entry, so multi-client apps ingest only
  // their own entries on recovery. Other clients' entries are removed on sight.
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
  commonProperties: PostHogEventProperties
  capturedProperties: PostHogEventProperties
  exceptionList: PostHogEventProperties['$exception_list']
  exceptionLevel: string
  exceptionSteps?: PostHogEventProperties['$exception_steps']
  optedOut: boolean
  apiKeyHash: string
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
    commonProperties: { ...input.commonProperties },
    capturedProperties: { ...input.capturedProperties },
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
    !isObject(candidate.commonProperties) ||
    !isObject(candidate.capturedProperties) ||
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
    commonProperties: { ...(candidate.commonProperties as { [key: string]: JsonType }) },
    capturedProperties: { ...(candidate.capturedProperties as { [key: string]: JsonType }) },
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
// list and level carry straight through; commonProperties and capturedProperties are also
// spread into the user-side properties, and `processBeforeEnqueue` re-applies them after
// `enrichProperties` has overwritten them with the next launch's runtime state.
export const entryToEventProperties = (
  entry: FatalJournalEntry
): {
  properties: PostHogEventProperties
  uuid: string
  timestamp: string
} => {
  const properties: PostHogEventProperties = {
    ...entry.capturedProperties,
    ...entry.commonProperties,
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