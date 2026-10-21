import { randomUUID } from 'node:crypto'
import {
  bytes,
  defined,
  encode,
  identifier,
  json,
  keys,
  metadata,
  object,
  timestamp,
  uuid,
  type JSONObject,
  type JSONValue,
  type WireObject,
} from './serialization'
import type { DatasetItem } from './datasets'

export interface ItemPayload {
  input?: JSONValue
  output?: JSONValue
  expectedOutput?: JSONValue
  metadata?: JSONObject | null
}
export interface ResultPayload {
  reasoning?: string | null
  errorMessage?: string | null
  metadata?: JSONObject | null
}
type PayloadOptions<T> = (T & { payload?: never }) | ({ payload: T } & { [K in keyof T]?: never })
export interface ItemIdentifiers {
  id?: string
  caseKey?: string | null
  trial?: string | null
  datasetItemIdentifier?: string | null
  datasetItemVersionIdentifier?: string | null
  datasetItemVersionId?: string | null
  applicationTraceId?: string | null
}
export type EvaluationItemOptions = ItemIdentifiers & PayloadOptions<ItemPayload>
export type ScoreValue = boolean | number | readonly string[]
/** bigint inputs are converted only if exactly representable as finite binary64 scores. */
export type ScoreInput = ScoreValue | bigint
export type ResultStatus = 'ok' | 'error' | 'skipped' | 'not_applicable'
type Outcome =
  | ({ status?: 'ok'; value: ScoreInput; errorCode?: never } & PayloadOptions<
      Omit<ResultPayload, 'errorMessage'> & { errorMessage?: null }
    >)
  | ({ status: 'error'; value?: never; errorCode?: string } & PayloadOptions<ResultPayload>)
  | ({ status: 'skipped' | 'not_applicable'; value?: never; errorCode?: never } & PayloadOptions<
      Omit<ResultPayload, 'errorMessage'> & { errorMessage?: null }
    >)
export type EvaluationResultOptions = Outcome & {
  item: EvaluationItem | string
  scorerVersionId: string
  evaluatorTraceId?: string | null
  evaluatedAt?: string | Date | null
}
const ITEM_FIELDS: Record<string, string> = {
  input: 'input',
  output: 'output',
  expectedOutput: 'expected_output',
  metadata: 'metadata',
}
const RESULT_FIELDS: Record<string, string> = {
  reasoning: 'reasoning',
  errorMessage: 'error_message',
  metadata: 'metadata',
}
const ITEM_IDS: Record<string, string> = {
  caseKey: 'case_key',
  trial: 'trial',
  datasetItemIdentifier: 'dataset_item_identifier',
  datasetItemVersionIdentifier: 'dataset_item_version_identifier',
  applicationTraceId: 'application_trace_id',
}
const items = new WeakMap<EvaluationItem, string>()
const results = new WeakMap<EvaluationResult, string>()

function payload(options: WireObject, fields: Record<string, string>, limit: number): WireObject | undefined {
  const supplied = Object.keys(fields).filter((key) => options[key] !== undefined)
  if (options.payload !== undefined && supplied.length)
    throw new TypeError('Supply payload or individual fields, not both.')
  if (options.payload === undefined && !supplied.length) return undefined
  const source =
    options.payload === undefined
      ? Object.fromEntries(supplied.map((key) => [key, options[key]]))
      : object(options.payload)
  keys(source, Object.keys(fields))
  const value = Object.fromEntries(
    Object.entries(source).map(([key, v]) => {
      if (key === 'metadata' && v !== null) metadata(v)
      if ((key === 'reasoning' || key === 'errorMessage') && v !== null && typeof v !== 'string')
        throw new TypeError('Expected a string or null.')
      return [fields[key], v]
    })
  )
  const snapshot = json(value) as WireObject
  if (bytes(encode(snapshot)) > limit) throw new TypeError('Evaluation payload exceeds its UTF-8 byte limit.')
  return snapshot
}
function restoredPayload(value: unknown, fields: Record<string, string>): WireObject {
  const source = object(value)
  keys(source, Object.values(fields))
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, wire]) => Object.hasOwn(source, wire))
      .map(([key, wire]) => [key, source[wire]])
  )
}
function score(value: unknown): boolean | number | string[] {
  if (typeof value === 'boolean') return value
  if (typeof value === 'bigint') {
    const result = Number(value)
    if (!Number.isFinite(result) || BigInt(result) !== value)
      throw new TypeError('Integer scores must be exactly representable as binary64.')
    return result
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
      throw new TypeError('Use bigint for exact integer scores outside the safe number range.')
    return value
  }
  if (!Array.isArray(value) || !value.length)
    throw new TypeError('Expected a boolean, finite number, or nonempty category list.')
  for (let i = 0; i < value.length; i++) {
    if (!Object.hasOwn(value, i)) throw new TypeError('Category lists cannot be sparse.')
  }
  const categories = value.map((v) => identifier(v, 128))
  if (new Set(categories).size !== categories.length) throw new TypeError('Category keys must be distinct.')
  // Python sorts Unicode code points; UTF-16's default sort differs for supplementary characters.
  return categories.sort((a, b) => {
    const aa = Array.from(a, (c) => c.codePointAt(0)!),
      bb = Array.from(b, (c) => c.codePointAt(0)!)
    for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i]
    return aa.length - bb.length
  })
}

/** One immutable execution. Reuse across scorers; construct a new item for each trial. */
export class EvaluationItem {
  readonly id: string
  constructor(options: EvaluationItemOptions = {}) {
    object(options)
    keys(options, ['id', 'datasetItemVersionId', 'payload', ...Object.keys(ITEM_IDS), ...Object.keys(ITEM_FIELDS)])
    this.id = uuid(options.id ?? randomUUID())
    const body: WireObject = { id: this.id }
    for (const [key, wire] of Object.entries(ITEM_IDS)) {
      const value = (options as WireObject)[key]
      if (value !== undefined && value !== null) body[wire] = identifier(value)
    }
    if (options.datasetItemVersionId != null) body.dataset_item_version_id = uuid(options.datasetItemVersionId)
    const data = payload(options as WireObject, ITEM_FIELDS, 1024 * 1024)
    if (data !== undefined) body.payload = data
    items.set(this, encode(body))
    Object.freeze(this)
  }
  /** Detached wire-format JSON; preserve this before sending if restart recovery is needed. */
  toJSON(): WireObject {
    return JSON.parse(itemJSON(this)) as WireObject
  }
  static fromJSON(value: unknown): EvaluationItem {
    const data = object(value)
    keys(data, ['id', 'dataset_item_version_id', 'payload', ...Object.values(ITEM_IDS)])
    const options: WireObject = { id: uuid(data.id) }
    for (const [key, wire] of Object.entries(ITEM_IDS)) if (Object.hasOwn(data, wire)) options[key] = data[wire]
    if (Object.hasOwn(data, 'dataset_item_version_id')) options.datasetItemVersionId = data.dataset_item_version_id
    if (Object.hasOwn(data, 'payload')) options.payload = restoredPayload(data.payload, ITEM_FIELDS)
    return new EvaluationItem(options as EvaluationItemOptions)
  }
  static fromDatasetItem(
    item: DatasetItem,
    options: { output?: JSONValue; id?: string; caseKey?: string; trial?: string; applicationTraceId?: string } = {}
  ): EvaluationItem {
    if (item.archived !== false) throw new TypeError('Archived dataset items cannot be evaluated.')
    keys(options, ['output', 'id', 'caseKey', 'trial', 'applicationTraceId'])
    return new EvaluationItem({
      ...options,
      caseKey: options.caseKey ?? item.clientItemId ?? item.id,
      input: item.input,
      expectedOutput: item.expectedOutput,
      metadata: item.metadata,
      datasetItemIdentifier: uuid(item.id),
      datasetItemVersionIdentifier: uuid(item.versionId),
      datasetItemVersionId: item.versionId,
    })
  }
}

/** An evaluator outcome pinned to an exact scorer version. `ok` does not imply passing. */
export class EvaluationResult {
  readonly item: EvaluationItem | string
  readonly scorerVersionId: string
  readonly itemId: string
  constructor(options: EvaluationResultOptions) {
    object(options)
    keys(options, [
      'item',
      'scorerVersionId',
      'status',
      'value',
      'errorCode',
      'evaluatorTraceId',
      'evaluatedAt',
      'payload',
      ...Object.keys(RESULT_FIELDS),
    ])
    this.item = options.item instanceof EvaluationItem ? options.item : uuid(options.item)
    this.itemId = typeof this.item === 'string' ? this.item : this.item.id
    this.scorerVersionId = uuid(options.scorerVersionId)
    const status = options.status ?? 'ok'
    if (!['ok', 'error', 'skipped', 'not_applicable'].includes(status))
      throw new TypeError('Unsupported result status.')
    if (status !== 'ok' && options.value !== undefined && options.value !== null)
      throw new TypeError('Only ok results can contain a score.')
    if (status !== 'error' && options.errorCode != null)
      throw new TypeError('Only error results can contain an error code.')
    const body: WireObject = { item_id: this.itemId, scorer_version_id: this.scorerVersionId, status }
    if (status === 'ok') body.value = score(options.value)
    if (options.errorCode != null) body.error_code = identifier(options.errorCode, 128)
    if (options.evaluatorTraceId != null) body.evaluator_trace_id = identifier(options.evaluatorTraceId)
    if (options.evaluatedAt != null) body.evaluated_at = timestamp(options.evaluatedAt)
    const data = payload(options as WireObject, RESULT_FIELDS, 256 * 1024)
    if (data !== undefined) {
      if (status !== 'error' && data.error_message != null)
        throw new TypeError('Only error results can contain an error message.')
      body.payload = data
    }
    results.set(this, encode(body))
    Object.freeze(this)
  }
  /** The attached item is saved separately, matching the Python declaration format. */
  toJSON(): WireObject {
    return JSON.parse(resultJSON(this)) as WireObject
  }
  static fromJSON(value: unknown, options: { item?: EvaluationItem } = {}): EvaluationResult {
    const data = object(value)
    keys(data, [
      'item_id',
      'scorer_version_id',
      'status',
      'value',
      'error_code',
      'evaluator_trace_id',
      'evaluated_at',
      'payload',
    ])
    const itemId = uuid(data.item_id)
    if (options.item !== undefined && options.item.id !== itemId)
      throw new TypeError('Restored item identity does not match.')
    // Saved binary64 numbers are already the acknowledged representation. Large exact integers
    // use the explicit bigint input path to distinguish restoration from an unsafe number input.
    const valueInput =
      typeof data.value === 'number' &&
      Number.isInteger(data.value) &&
      !Number.isSafeInteger(data.value) &&
      Number.isFinite(data.value)
        ? BigInt(data.value)
        : data.value
    return new EvaluationResult(
      defined({
        item: options.item ?? itemId,
        scorerVersionId: data.scorer_version_id,
        status: data.status,
        value: valueInput,
        errorCode: data.error_code,
        evaluatorTraceId: data.evaluator_trace_id,
        evaluatedAt: data.evaluated_at,
        payload: Object.hasOwn(data, 'payload') ? restoredPayload(data.payload, RESULT_FIELDS) : undefined,
      }) as EvaluationResultOptions
    )
  }
}
export function itemJSON(item: EvaluationItem): string {
  const value = items.get(item)
  if (value === undefined) throw new TypeError('Expected an EvaluationItem.')
  return value
}
export function resultJSON(result: EvaluationResult): string {
  const value = results.get(result)
  if (value === undefined) throw new TypeError('Expected an EvaluationResult.')
  return value
}
