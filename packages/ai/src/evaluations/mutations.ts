import { EDITABLE_ITEM_IDS, score, validateResultStatus, type ItemIdentifiers, type ScoreInput } from './declarations'
import { identifier, keys, nullable, object, type WireObject } from './serialization'

export interface RevisionOptions {
  /** The revision last observed for this item or result. Its payload shares the same revision. */
  revision: number
}

type AtLeastOne<T> = { [K in keyof T]-?: Required<Pick<T, K>> & Omit<T, K> }[keyof T]

/** Omit a field to keep its stored value, or pass null to clear it. */
export type ItemUpdate = AtLeastOne<Pick<ItemIdentifiers, keyof typeof EDITABLE_ITEM_IDS>>

/** Omit the status to correct a field against the result's stored status. */
export type ResultUpdate =
  | { status: 'ok'; value?: ScoreInput; errorCode?: null }
  | { status: 'error'; value?: null; errorCode?: string | null }
  | { status: 'skipped' | 'not_applicable'; value?: null; errorCode?: null }
  | { status?: undefined; value: ScoreInput | null; errorCode?: null }
  | { status?: undefined; value?: null; errorCode: string | null }

export function itemChanges(options: RevisionOptions & ItemUpdate): WireObject {
  const source = object(options)
  keys(source, ['revision', ...Object.keys(EDITABLE_ITEM_IDS)])
  const changes: WireObject = {}
  for (const [key, wire] of Object.entries(EDITABLE_ITEM_IDS)) {
    if (source[key] !== undefined) changes[wire] = nullable(source[key], identifier)
  }
  return changes
}

export function resultChanges(options: RevisionOptions & ResultUpdate): WireObject {
  keys(object(options), ['revision', 'status', 'value', 'errorCode'])
  const changes: WireObject = {}
  if (options.status !== undefined) {
    if (options.status === 'ok' && options.value === null)
      throw new TypeError('A successful result cannot clear its score.')
    validateResultStatus(options.status, options.value, options.errorCode)
    changes.status = options.status
  }
  if (options.value !== undefined) changes.value = nullable(options.value, score)
  if (options.errorCode !== undefined)
    changes.error_code = nullable(options.errorCode, (value) => identifier(value, 128))
  return changes
}
