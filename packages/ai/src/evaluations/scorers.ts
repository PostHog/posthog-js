import { parseResponse } from './errors'
import {
  boolean,
  count,
  defined,
  encode,
  identifier,
  integer,
  json,
  keys,
  metadata,
  nullable,
  object,
  page,
  pageParams,
  responseTags,
  responseMetadata,
  tagParams,
  tags,
  text,
  timestamp,
  uuid,
  type EvaluationCount,
  type JSONObject,
  type Page,
  type WireObject,
} from './serialization'
import { Transport, type RequestOptions } from './transport'
import type { PageOptions } from './datasets'

export interface BooleanScorerConfig {
  trueLabel?: string
  falseLabel?: string
  trueIsFailure?: boolean | null
}
export interface NumericPassingRule {
  operator: 'gte' | 'lte'
  threshold: number
}
export interface NumericScorerConfig {
  min?: number | null
  max?: number | null
  step?: number | null
  passingRule?: NumericPassingRule | null
}
export interface CategoricalScorerOption {
  key: string
  label: string
}
export interface CategoricalScorerConfig {
  options: readonly CategoricalScorerOption[]
  selectionMode?: 'single' | 'multiple'
  minSelections?: number | null
  maxSelections?: number | null
  passingRule?: { categories: readonly string[] } | null
}
export interface ScorerConfigs {
  boolean: BooleanScorerConfig
  numeric: NumericScorerConfig
  categorical: CategoricalScorerConfig
}
export type ScorerKind = keyof ScorerConfigs
export type ScorerCalculation = 'reported' | 'composite'
export interface ScorerCompositionInput {
  alias: string
  scorerVersionId: string
}
/** Server-evaluated formula with 1–16 pinned reported inputs; nested composites are unsupported. */
export interface ScorerComposition {
  expression: string
  inputs: readonly ScorerCompositionInput[]
}
/** Pinned input configuration alongside the source scorer's latest version. */
export type ScorerInput = {
  [K in ScorerKind]: {
    alias: string
    scorerVersionId: string
    definitionId: string
    name: string
    kind: K
    version: number
    config: ScorerConfigs[K]
    latestVersionId: string | null
    latestVersion: number | null
  }
}[ScorerKind]
export type ScorerConfig = ScorerConfigs[ScorerKind]
interface ScorerRecord {
  calculation: ScorerCalculation
  composition: ScorerComposition | null
  inputScorers: ScorerInput[]
  dependentCompositeCount: number
  id: string
  name: string
  description: string
  archived: boolean
  tags: string[]
  currentVersion: number
  currentVersionId: string
  team: number
  createdAt: string
  updatedAt: string
  createdBy: JSONObject | null
}
interface VersionRecord {
  calculation: ScorerCalculation
  composition: ScorerComposition | null
  id: string
  definitionId: string
  version: number
  createdAt: string
  createdBy: JSONObject | null
}
export type Scorer = { [K in ScorerKind]: ScorerRecord & { kind: K; config: ScorerConfigs[K] } }[ScorerKind]
export type ScorerVersion = { [K in ScorerKind]: VersionRecord & { kind: K; config: ScorerConfigs[K] } }[ScorerKind]
export interface ScorerPage extends Page<Scorer> {
  next: string | null
  previous: string | null
}
export interface ScorerVersionPage {
  count: EvaluationCount
  results: ScorerVersion[]
  nextCursor: string | null
}
export type ScorerOrder =
  | 'name'
  | '-name'
  | 'kind'
  | '-kind'
  | 'created_at'
  | '-created_at'
  | 'updated_at'
  | '-updated_at'
  | 'current_version'
  | '-current_version'
export interface ScorerListOptions extends PageOptions {
  calculation?: ScorerCalculation
  inputDefinitionId?: string
  search?: string
  kind?: ScorerKind
  archived?: boolean
  orderBy?: ScorerOrder
  tags?: readonly string[]
  tagMatch?: 'any' | 'all'
}
export interface ScorerMetadata {
  name?: string
  description?: string | null
  archived?: boolean
  tags?: readonly string[]
}
export type CreateScorerOptions = {
  [K in ScorerKind]: {
    name: string
    kind: K
    config: ScorerConfigs[K]
    calculation?: ScorerCalculation
    composition?: ScorerComposition | null
    description?: string | null
    tags?: readonly string[]
  }
}[ScorerKind]
export type ValidateCompositionOptions = {
  [K in ScorerKind]: { kind: K; composition: ScorerComposition; config?: ScorerConfigs[K] }
}[ScorerKind]
const CONFIG_KEYS: Record<string, string> = {
  trueLabel: 'true_label',
  falseLabel: 'false_label',
  trueIsFailure: 'true_is_failure',
  passingRule: 'passing_rule',
  selectionMode: 'selection_mode',
  minSelections: 'min_selections',
  maxSelections: 'max_selections',
}
function calculation(value: unknown): ScorerCalculation {
  if (value !== 'reported' && value !== 'composite') throw new TypeError('Unsupported scorer calculation.')
  return value
}
function alias(value: unknown): string {
  const name = text(value)
  if (
    name.trim() !== name ||
    !/^[a-z][a-z0-9_]{0,31}$/.test(name) ||
    ['number', 'min', 'max', 'abs', 'and', 'or', 'not', 'if', 'else', 'in', 'is', 'lambda', 'for', 'await'].includes(
      name
    )
  )
    throw new TypeError('Invalid composite input alias.')
  return name
}
function composition(value: unknown, fromWire = false): ScorerComposition {
  const data = object(value)
  const expression = text(data.expression)
  if (!expression.trim() || Array.from(expression).length > 1024)
    throw new TypeError('A formula must contain 1–1024 characters.')
  if (!Array.isArray(data.inputs) || data.inputs.length < 1 || data.inputs.length > 16)
    throw new TypeError('A composite requires 1–16 reported inputs.')
  const inputs = Array.from(data.inputs, (entry) => {
    const input = object(entry)
    return {
      alias: alias(input.alias),
      scorerVersionId: uuid(input[fromWire ? 'scorer_version_id' : 'scorerVersionId']),
    }
  })
  if (new Set(inputs.map((input) => input.alias)).size !== inputs.length)
    throw new TypeError('Composite input aliases must be unique.')
  return { expression, inputs }
}
function compositionBody(value: ScorerComposition): WireObject {
  const parsed = composition(value)
  return {
    expression: parsed.expression,
    inputs: parsed.inputs.map((input) => ({ alias: input.alias, scorer_version_id: input.scorerVersionId })),
  }
}
function scoring(data: WireObject): Pick<Scorer, 'calculation' | 'composition'> {
  const selected = calculation(data.calculation === undefined ? 'reported' : data.calculation)
  if (selected === 'composite') return { calculation: selected, composition: composition(data.composition, true) }
  if (data.composition != null) throw new TypeError('Reported scorers cannot contain a composition.')
  return { calculation: selected, composition: null }
}
function compositeConfig(value: WireObject): void {
  if (value.step != null) throw new TypeError('Numeric composite scorers do not accept a step.')
}
function kind(value: unknown): ScorerKind {
  if (value !== 'boolean' && value !== 'numeric' && value !== 'categorical')
    throw new TypeError('Unsupported scorer kind.')
  return value
}
function config(value: unknown, toWire: boolean): WireObject {
  const fields = toWire ? CONFIG_KEYS : Object.fromEntries(Object.entries(CONFIG_KEYS).map(([k, v]) => [v, k]))
  // Only schema-owned keys are translated. Category keys and user text are opaque.
  return Object.fromEntries(
    Object.entries(toWire ? metadata(value) : responseMetadata(value)).map(([key, v]) => [
      Object.hasOwn(fields, key) ? fields[key] : key,
      v,
    ])
  )
}
type ConfigSnapshot = { [K in ScorerKind]: { kind: K; config: ScorerConfigs[K] } }[ScorerKind]
function parsedConfig(value: unknown, raw: unknown): ConfigSnapshot {
  const selected = kind(value)
  const snapshot = config(raw, false)
  const finite = (v: unknown): void => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError('Expected a finite configuration number.')
  }
  if (selected === 'boolean') {
    for (const key of ['trueLabel', 'falseLabel']) if (snapshot[key] !== undefined) text(snapshot[key])
    if (snapshot.trueIsFailure != null) boolean(snapshot.trueIsFailure)
    return { kind: selected, config: snapshot as BooleanScorerConfig }
  }
  if (selected === 'numeric') {
    for (const key of ['min', 'max', 'step']) if (snapshot[key] != null) finite(snapshot[key])
    if (snapshot.passingRule != null) {
      const rule = object(snapshot.passingRule)
      if (rule.operator !== 'gte' && rule.operator !== 'lte') throw new TypeError('Invalid passing operator.')
      finite(rule.threshold)
    }
    return { kind: selected, config: snapshot as NumericScorerConfig }
  }
  if (!Array.isArray(snapshot.options)) throw new TypeError('Expected categorical options.')
  for (const option of snapshot.options) {
    const row = object(option)
    text(row.key)
    text(row.label)
  }
  if (
    snapshot.selectionMode !== undefined &&
    snapshot.selectionMode !== 'single' &&
    snapshot.selectionMode !== 'multiple'
  )
    throw new TypeError('Invalid selection mode.')
  for (const key of ['minSelections', 'maxSelections']) if (snapshot[key] != null) integer(snapshot[key])
  if (snapshot.passingRule != null) {
    const categories = object(snapshot.passingRule).categories
    if (!Array.isArray(categories)) throw new TypeError('Expected passing categories.')
    categories.forEach(text)
  }
  return { kind: selected, config: snapshot as unknown as CategoricalScorerConfig }
}
function scorer(data: WireObject, project: number, id?: string): Scorer {
  const identity = uuid(data.id)
  if ((id !== undefined && identity !== id) || integer(data.team) !== project)
    throw new TypeError('Mismatched scorer scope.')
  return {
    id: identity,
    ...scoring(data),
    inputScorers: inputScorers(data.input_scorers === undefined ? [] : data.input_scorers),
    dependentCompositeCount:
      data.dependent_composite_count === undefined ? 0 : integer(data.dependent_composite_count, 0),
    name: text(data.name),
    description: text(data.description),
    archived: boolean(data.archived),
    ...parsedConfig(data.kind, data.config),
    tags: responseTags(data.tags === undefined ? [] : data.tags),
    currentVersion: integer(data.current_version),
    currentVersionId: uuid(data.current_version_id),
    team: project,
    createdAt: timestamp(data.created_at),
    updatedAt: timestamp(data.updated_at),
    createdBy: nullable(data.created_by, responseMetadata),
  }
}
function version(data: WireObject, scorerId: string, versionId?: string): ScorerVersion {
  const id = uuid(data.id)
  if (uuid(data.definition_id) !== scorerId || (versionId !== undefined && versionId !== id))
    throw new TypeError('Mismatched scorer version.')
  return {
    id,
    ...scoring(data),
    definitionId: scorerId,
    version: integer(data.version),
    ...parsedConfig(data.kind, data.config),
    createdAt: timestamp(data.created_at),
    createdBy: nullable(data.created_by, responseMetadata),
  }
}
function inputScorers(value: unknown): ScorerInput[] {
  if (!Array.isArray(value)) throw new TypeError('Expected input scorer metadata.')
  return Array.from(value, (entry) => {
    const row = object(entry)
    return {
      alias: alias(row.alias),
      scorerVersionId: uuid(row.scorer_version_id),
      definitionId: uuid(row.definition_id),
      name: text(row.name),
      version: integer(row.version),
      ...parsedConfig(row.kind, row.config),
      latestVersionId: nullable(row.latest_version_id, uuid),
      latestVersion: nullable(row.latest_version, integer),
    }
  })
}
function fields(options: ScorerMetadata): WireObject {
  return defined({
    name: options.name === undefined ? undefined : identifier(options.name, 400),
    description: options.description === undefined ? undefined : nullable(options.description, text),
    archived: options.archived === undefined ? undefined : boolean(options.archived),
    tags: options.tags === undefined ? undefined : tags(options.tags),
  })
}
/** Versioned scorer definitions. Reported evaluators run in the caller; composites calculate on the server. */
export class Scorers {
  readonly #transport: Transport
  readonly #base: string
  constructor(transport: Transport) {
    this.#transport = transport
    this.#base = `/api/projects/${transport.projectId}/llm_analytics/score_definitions/`
  }
  async #request<T>(
    method: string,
    path: string,
    parse: (data: WireObject) => T,
    options: RequestOptions & { body?: string; params?: WireObject; retrySafe?: boolean }
  ): Promise<T> {
    return parseResponse(await this.#transport.request(method, path, options), parse)
  }
  async create<T extends CreateScorerOptions>(
    options: T,
    request: RequestOptions = {}
  ): Promise<Extract<Scorer, { kind: T['kind'] }>> {
    keys(options, ['name', 'kind', 'config', 'description', 'tags', 'calculation', 'composition'])
    const selectedCalculation = calculation(options.calculation === undefined ? 'reported' : options.calculation)
    if ((selectedCalculation === 'composite') !== (options.composition != null))
      throw new TypeError('Provide composition only for a composite scorer.')
    const selectedKind = kind(options.kind)
    const outputConfig = config(options.config, true)
    if (selectedCalculation === 'composite') compositeConfig(outputConfig)
    const body = encode(
      json({
        ...fields(options),
        name: identifier(options.name, 400),
        kind: selectedKind,
        config: outputConfig,
        ...(selectedCalculation === 'composite'
          ? { calculation: selectedCalculation, composition: compositionBody(options.composition!) }
          : {}),
      })
    )
    return this.#request(
      'POST',
      this.#base,
      (data) => {
        const result = scorer(data, this.#transport.projectId)
        if (result.kind !== selectedKind) throw new TypeError('Mismatched scorer kind.')
        if (result.calculation !== selectedCalculation) throw new TypeError('Mismatched scorer calculation.')
        return result
      },
      {
        ...request,
        body,
      }
    ) as Promise<Extract<Scorer, { kind: T['kind'] }>>
  }
  async get(scorerId: string, request: RequestOptions = {}): Promise<Scorer> {
    const id = uuid(scorerId)
    return this.#request('GET', `${this.#base}${id}/`, (data) => scorer(data, this.#transport.projectId, id), request)
  }
  async list(options: ScorerListOptions = {}): Promise<ScorerPage> {
    const { limit = 100, offset = 0 } = options
    if (
      options.orderBy !== undefined &&
      ![
        'name',
        '-name',
        'kind',
        '-kind',
        'created_at',
        '-created_at',
        'updated_at',
        '-updated_at',
        'current_version',
        '-current_version',
      ].includes(options.orderBy)
    )
      throw new TypeError('Unsupported scorer order.')
    const params = {
      ...pageParams(limit, offset, Number.MAX_SAFE_INTEGER),
      ...tagParams(options.tags, options.tagMatch),
      ...defined({
        search: options.search === undefined ? undefined : text(options.search),
        kind: options.kind === undefined ? undefined : kind(options.kind),
        calculation: options.calculation === undefined ? undefined : calculation(options.calculation),
        input_definition_id: options.inputDefinitionId === undefined ? undefined : uuid(options.inputDefinitionId),
        archived: options.archived === undefined ? undefined : String(boolean(options.archived)),
        order_by: options.orderBy,
      }),
    }
    return this.#request(
      'GET',
      this.#base,
      (data) => ({
        ...page(data, (row) => scorer(row, this.#transport.projectId), offset),
        next: nullable(data.next, text),
        previous: nullable(data.previous, text),
      }),
      { signal: options.signal, params }
    )
  }
  async update(scorerId: string, options: ScorerMetadata, request: RequestOptions = {}): Promise<Scorer> {
    keys(options, ['name', 'description', 'archived', 'tags'])
    const id = uuid(scorerId)
    return this.#request('PATCH', `${this.#base}${id}/`, (data) => scorer(data, this.#transport.projectId, id), {
      ...request,
      body: encode(json(fields(options))),
    })
  }
  /** Composite versions require a complete composition, even when only changing output config. */
  async createVersion(
    scorerId: string,
    options: {
      config: ScorerConfig
      composition?: ScorerComposition | null
      baseVersion?: number
      name?: string
      description?: string | null
    },
    request: RequestOptions = {}
  ): Promise<Scorer> {
    keys(options, ['config', 'composition', 'baseVersion', 'name', 'description'])
    const id = uuid(scorerId)
    const outputConfig = config(options.config, true)
    if (options.composition != null) compositeConfig(outputConfig)
    const body = encode(
      json({
        ...fields(options),
        config: outputConfig,
        ...defined({
          composition: options.composition == null ? undefined : compositionBody(options.composition),
          base_version: options.baseVersion === undefined ? undefined : integer(options.baseVersion),
        }),
      })
    )
    return this.#request(
      'POST',
      `${this.#base}${id}/new_version/`,
      (data) => scorer(data, this.#transport.projectId, id),
      { ...request, body }
    )
  }
  /** Validate syntax and types without saving, using llm_analytics:read access. Omit config for syntax/type checks only. */
  async validateComposition(options: ValidateCompositionOptions, request: RequestOptions = {}): Promise<boolean> {
    keys(options, ['kind', 'composition', 'config'])
    const outputConfig = options.config === undefined ? undefined : config(options.config, true)
    if (outputConfig) compositeConfig(outputConfig)
    const body = encode(
      json(
        defined({
          kind: kind(options.kind),
          composition: compositionBody(options.composition),
          config: outputConfig,
        })
      )
    )
    return this.#request(
      'POST',
      `${this.#base}validate_composition/`,
      (data) => {
        if (data.valid !== true) throw new TypeError('Expected successful formula validation.')
        return true
      },
      { ...request, body, retrySafe: true }
    )
  }
  async getVersion(scorerId: string, versionId: string, request: RequestOptions = {}): Promise<ScorerVersion> {
    const id = uuid(scorerId),
      selected = uuid(versionId)
    return this.#request(
      'GET',
      `${this.#base}${id}/versions/${selected}/`,
      (data) => version(data, id, selected),
      request
    )
  }
  async listVersions(
    scorerId: string,
    options: RequestOptions & { limit?: number; cursor?: string } = {}
  ): Promise<ScorerVersionPage> {
    const id = uuid(scorerId),
      cursor = options.cursor
    const params = {
      limit: integer(options.limit ?? 50, 1, 100),
      ...defined({ cursor: cursor === undefined ? undefined : text(cursor) }),
    }
    return this.#request(
      'GET',
      `${this.#base}${id}/versions/`,
      (data) => {
        if (!Array.isArray(data.results)) throw new TypeError('Expected version results.')
        const next = nullable(data.next_cursor, text)
        if (next !== null && (!next || next === cursor || !data.results.length))
          throw new TypeError('Invalid cursor continuation.')
        return {
          count: count(data.count),
          results: data.results.map((row) => version(object(row), id)),
          nextCursor: next,
        }
      },
      { signal: options.signal, params }
    )
  }
}
