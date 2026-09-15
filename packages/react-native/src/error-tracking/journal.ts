import { isObject, JsonType, PostHogEventProperties } from '@posthog/core'

export interface FatalJournalEntry {
  id: string
  eventUuid: string
  timestamp: string
  sessionId: string
  distinctId: string
  anonymousId: string
  deviceId: string
  commonProperties: { [key: string]: JsonType }
  exceptionList: Array<{ [key: string]: JsonType }>
  exceptionLevel: string
  exceptionSteps?: Array<{ [key: string]: JsonType }>
  optedOut: boolean
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
  anonymousId: string
  deviceId: string
  commonProperties: PostHogEventProperties
  exceptionList: PostHogEventProperties['$exception_list']
  exceptionLevel: string
  exceptionSteps?: PostHogEventProperties['$exception_steps']
  optedOut: boolean
}

export const buildFatalJournalEntry = (input: BuildFatalJournalEntryInput): FatalJournalEntry => {
  if (!input.id || !input.eventUuid || !input.timestamp) {
    throw new Error('buildFatalJournalEntry: id, eventUuid and timestamp are required')
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
    anonymousId: input.anonymousId || '',
    deviceId: input.deviceId || '',
    commonProperties: { ...input.commonProperties },
    exceptionList: input.exceptionList.map((e) => ({ ...(e as { [key: string]: JsonType }) })),
    exceptionLevel: input.exceptionLevel || 'fatal',
    exceptionSteps: steps,
    optedOut: !!input.optedOut,
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
    typeof candidate.anonymousId !== 'string' ||
    typeof candidate.deviceId !== 'string' ||
    typeof candidate.exceptionLevel !== 'string' ||
    typeof candidate.optedOut !== 'boolean' ||
    !isObject(candidate.commonProperties) ||
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
    anonymousId: candidate.anonymousId,
    deviceId: candidate.deviceId,
    exceptionLevel: candidate.exceptionLevel,
    commonProperties: { ...(candidate.commonProperties as { [key: string]: JsonType }) },
    exceptionList: (candidate.exceptionList as Array<{ [key: string]: JsonType }>).map((e) => ({
      ...e,
    })),
    exceptionSteps:
      candidate.exceptionSteps === undefined
        ? undefined
        : (candidate.exceptionSteps as Array<{ [key: string]: JsonType }>).map((s) => ({ ...s })),
    optedOut: candidate.optedOut,
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

// Reconstitutes the $exception event using the captured crash-time snapshot so a recovered
// event preserves attribution instead of inheriting the next launch's runtime state.
export const entryToEventProperties = (
  entry: FatalJournalEntry
): {
  properties: PostHogEventProperties
  uuid: string
  timestamp: string
} => {
  const properties: PostHogEventProperties = {
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