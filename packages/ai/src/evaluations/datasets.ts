import { parseResponse } from './errors'
import {
  boolean,
  defined,
  encode,
  identifier,
  integer,
  json,
  keys,
  metadata,
  nullable,
  page,
  pageParams,
  responseTags,
  responseJSON,
  responseMetadata,
  tagParams,
  tags,
  text,
  timestamp,
  uuid,
  type JSONObject,
  type JSONValue,
  type Page,
  type WireObject,
} from './serialization'
import { Transport, type RequestOptions } from './transport'

interface Audit {
  createdAt: string
  createdBy: JSONObject | null
  teamId: number
}
export interface Dataset extends Audit {
  id: string
  name: string
  description: string
  metadata: JSONObject
  tags: string[]
  archived: boolean
  currentRevision: number | null
  currentRevisionId: string | null
  updatedAt: string | null
}
export interface DatasetRevision extends Audit {
  id: string
  datasetId: string
  revision: number
}
export interface DatasetItem extends Audit {
  id: string
  datasetId: string
  clientItemId: string | null
  version: number
  versionId: string
  datasetRevision: number
  datasetRevisionId: string
  archived: boolean
  input: JSONValue
  expectedOutput: JSONValue
  sourceOutput: JSONValue
  metadata: JSONObject
  sourceTraceId: string | null
  sourceEventId: string | null
  sourceTimestamp: string | null
  updatedAt: string | null
  versionCreatedAt: string
  versionCreatedBy: JSONObject | null
}
export type DatasetPage = Page<Dataset>
export type DatasetRevisionPage = Page<DatasetRevision>
export type DatasetItemPage = Page<DatasetItem>
export type DatasetOrder = 'created_at' | '-created_at' | 'updated_at' | '-updated_at'
export interface DatasetMetadata {
  name?: string
  description?: string
  metadata?: JSONObject
  tags?: readonly string[]
}
export interface PageOptions extends RequestOptions {
  limit?: number
  offset?: number
}
export interface DatasetListOptions extends PageOptions {
  search?: string
  archived?: boolean
  orderBy?: DatasetOrder
  tags?: readonly string[]
  tagMatch?: 'any' | 'all'
}
export interface ItemListOptions extends PageOptions {
  revision?: number
  archived?: boolean
}
export interface CreateDatasetItemOptions {
  input: Exclude<JSONValue, null>
  expectedOutput?: JSONValue
  sourceOutput?: JSONValue
  metadata?: JSONObject
  clientItemId?: string | null
  sourceTraceId?: string | null
  sourceEventId?: string | null
  sourceTimestamp?: string | Date | null
}
export interface UpdateDatasetItemOptions {
  baseVersion: number
  input?: Exclude<JSONValue, null>
  expectedOutput?: JSONValue
  metadata?: JSONObject
}
function audit(data: WireObject, project: number): Audit {
  if (integer(data.team_id) !== project) throw new TypeError('Response belongs to another project.')
  return {
    createdAt: timestamp(data.created_at),
    createdBy: nullable(data.created_by, responseMetadata),
    teamId: project,
  }
}
function dataset(data: WireObject, project: number, id?: string): Dataset {
  const identity = uuid(data.id)
  if (id !== undefined && identity !== id) throw new TypeError('Mismatched dataset.')
  if ((data.current_revision === null) !== (data.current_revision_id === null))
    throw new TypeError('Incomplete revision reference.')
  return {
    ...audit(data, project),
    id: identity,
    name: text(data.name),
    description: text(data.description),
    metadata: responseMetadata(data.metadata),
    tags: responseTags(data.tags === undefined ? [] : data.tags),
    archived: boolean(data.archived),
    currentRevision: nullable(data.current_revision, integer),
    currentRevisionId: nullable(data.current_revision_id, uuid),
    updatedAt: nullable(data.updated_at, timestamp),
  }
}
function revision(data: WireObject, project: number, datasetId: string): DatasetRevision {
  if (uuid(data.dataset_id) !== datasetId) throw new TypeError('Mismatched revision dataset.')
  return { ...audit(data, project), id: uuid(data.id), datasetId, revision: integer(data.revision) }
}
function item(
  data: WireObject,
  project: number,
  scope: { id?: string; datasetId?: string; revision?: number; archived?: boolean } = {}
): DatasetItem {
  const id = uuid(data.id),
    datasetId = uuid(data.dataset),
    introduced = integer(data.dataset_revision),
    archived = boolean(data.archived)
  if (
    (scope.id !== undefined && scope.id !== id) ||
    (scope.datasetId !== undefined && scope.datasetId !== datasetId) ||
    (scope.revision !== undefined && introduced > scope.revision) ||
    (scope.archived !== undefined && archived !== scope.archived)
  )
    throw new TypeError('Item is outside requested scope.')
  if (data.input === null) throw new TypeError('Dataset input cannot be null.')
  return {
    ...audit(data, project),
    id,
    datasetId,
    datasetRevision: introduced,
    archived,
    clientItemId: nullable(data.client_item_id, identifier),
    version: integer(data.version),
    versionId: uuid(data.version_id),
    datasetRevisionId: uuid(data.dataset_revision_id),
    input: responseJSON(data.input),
    expectedOutput: responseJSON(data.expected_output),
    sourceOutput: responseJSON(data.source_output),
    metadata: responseMetadata(data.metadata),
    sourceTraceId: nullable(data.source_trace_id, identifier),
    sourceEventId: nullable(data.source_event_id, identifier),
    sourceTimestamp: nullable(data.source_timestamp, timestamp),
    updatedAt: nullable(data.updated_at, timestamp),
    versionCreatedAt: timestamp(data.version_created_at),
    versionCreatedBy: nullable(data.version_created_by, responseMetadata),
  }
}
function body(fields: WireObject): string {
  const data = defined(fields)
  for (const key of ['name', 'description']) {
    if (Object.hasOwn(data, key)) {
      const value = text(data[key]),
        maximum = key === 'name' ? 400 : 10000
      if ([...value].length > maximum || (key === 'name' && !value.trim()))
        throw new TypeError('Invalid dataset metadata.')
    }
  }
  if (Object.hasOwn(data, 'input') && data.input === null) throw new TypeError('Dataset input cannot be null.')
  if (Object.hasOwn(data, 'metadata')) metadata(data.metadata)
  if (Object.hasOwn(data, 'tags')) data.tags = tags(data.tags)
  return encode(json(data))
}
const METADATA_KEYS = ['name', 'description', 'metadata', 'tags']
const ITEM_KEYS = [
  'input',
  'expectedOutput',
  'sourceOutput',
  'metadata',
  'clientItemId',
  'sourceTraceId',
  'sourceEventId',
  'sourceTimestamp',
]

/** Dataset management. Writes require a personal key with dataset:write. */
export class Datasets {
  readonly #transport: Transport
  readonly #base: string
  readonly #items: string
  constructor(transport: Transport) {
    this.#transport = transport
    this.#base = `/api/projects/${transport.projectId}/datasets/`
    this.#items = `/api/projects/${transport.projectId}/dataset_items/`
  }
  async #request<T>(
    method: string,
    path: string,
    parse: (data: WireObject) => T,
    options: RequestOptions & { body?: string; params?: WireObject; retrySafe?: boolean }
  ): Promise<T> {
    return parseResponse(await this.#transport.request(method, path, options), parse)
  }
  async create(options: DatasetMetadata & { name: string }, request: RequestOptions = {}): Promise<Dataset> {
    keys(options, METADATA_KEYS)
    if (options.name === undefined) throw new TypeError('Dataset name is required.')
    return this.#request('POST', this.#base, (data) => dataset(data, this.#transport.projectId), {
      ...request,
      body: body({ ...options }),
    })
  }
  async get(datasetId: string, request: RequestOptions = {}): Promise<Dataset> {
    const id = uuid(datasetId)
    return this.#request('GET', `${this.#base}${id}/`, (data) => dataset(data, this.#transport.projectId, id), request)
  }
  async list(options: DatasetListOptions = {}): Promise<DatasetPage> {
    const { limit = 50, offset = 0, archived = false, orderBy = '-created_at' } = options
    if (!['created_at', '-created_at', 'updated_at', '-updated_at'].includes(orderBy))
      throw new TypeError('Invalid dataset order.')
    const params = {
      ...pageParams(limit, offset),
      ...tagParams(options.tags, options.tagMatch),
      archived: String(boolean(archived)),
      order_by: orderBy,
    }
    if (options.search !== undefined && !text(options.search).trim()) throw new TypeError('Search cannot be blank.')
    return this.#request(
      'GET',
      this.#base,
      (data) => page(data, (row) => dataset(row, this.#transport.projectId), offset),
      { signal: options.signal, params: { ...params, ...defined({ search: options.search }) } }
    )
  }
  async update(datasetId: string, options: DatasetMetadata, request: RequestOptions = {}): Promise<Dataset> {
    const id = uuid(datasetId)
    keys(options, METADATA_KEYS)
    return this.#request('PATCH', `${this.#base}${id}/`, (data) => dataset(data, this.#transport.projectId, id), {
      ...request,
      body: body({ ...options }),
    })
  }
  async archive(datasetId: string, request: RequestOptions = {}): Promise<Dataset> {
    return this.#state(datasetId, 'archive', request)
  }
  async restore(datasetId: string, request: RequestOptions = {}): Promise<Dataset> {
    return this.#state(datasetId, 'restore', request)
  }
  async #state(datasetId: string, action: string, request: RequestOptions): Promise<Dataset> {
    const id = uuid(datasetId)
    return this.#request(
      'POST',
      `${this.#base}${id}/${action}/`,
      (data) => dataset(data, this.#transport.projectId, id),
      { ...request, body: '{}' }
    )
  }
  async listRevisions(datasetId: string, options: PageOptions = {}): Promise<DatasetRevisionPage> {
    const id = uuid(datasetId),
      { limit = 50, offset = 0 } = options
    return this.#request(
      'GET',
      `${this.#base}${id}/revisions/`,
      (data) => page(data, (row) => revision(row, this.#transport.projectId, id), offset),
      { signal: options.signal, params: pageParams(limit, offset) }
    )
  }
  async listItems(datasetId: string, options: ItemListOptions = {}): Promise<DatasetItemPage> {
    const id = uuid(datasetId),
      { limit = 25, offset = 0, archived = false, revision: selectedRevision } = options
    const params = {
      ...pageParams(limit, offset, 25),
      dataset: id,
      archived: String(boolean(archived)),
      ...defined({ revision: selectedRevision === undefined ? undefined : integer(selectedRevision) }),
    }
    return this.#request(
      'GET',
      this.#items,
      (data) =>
        page(
          data,
          (row) => item(row, this.#transport.projectId, { datasetId: id, revision: selectedRevision, archived }),
          offset
        ),
      { signal: options.signal, params }
    )
  }
  async getItem(itemId: string, options: RequestOptions & { revision?: number } = {}): Promise<DatasetItem> {
    const id = uuid(itemId),
      selectedRevision = options.revision
    const params = defined({ revision: selectedRevision === undefined ? undefined : integer(selectedRevision) })
    return this.#request(
      'GET',
      `${this.#items}${id}/`,
      (data) => item(data, this.#transport.projectId, { id, revision: selectedRevision }),
      { signal: options.signal, params }
    )
  }
  async createItem(
    datasetId: string,
    options: CreateDatasetItemOptions,
    request: RequestOptions = {}
  ): Promise<DatasetItem> {
    const id = uuid(datasetId)
    keys(options, ITEM_KEYS)
    if (options.input === undefined) throw new TypeError('Dataset input is required.')
    const clientId = options.clientItemId == null ? null : identifier(options.clientItemId)
    const trace = options.sourceTraceId == null ? null : identifier(options.sourceTraceId)
    const event = options.sourceEventId == null ? null : identifier(options.sourceEventId)
    const time = options.sourceTimestamp == null ? null : timestamp(options.sourceTimestamp)
    if ((trace === null) !== (time === null) || (event !== null && trace === null))
      throw new TypeError('Source provenance requires a trace and timezone-qualified timestamp.')
    const prepared = body({
      dataset: id,
      input: options.input,
      expected_output: options.expectedOutput,
      source_output: options.sourceOutput,
      metadata: options.metadata,
      client_item_id: clientId,
      source_trace_id: trace,
      source_event_id: event,
      source_timestamp: time,
    })
    return this.#request(
      'POST',
      this.#items,
      (data) => item(data, this.#transport.projectId, { datasetId: id, archived: false }),
      { ...request, body: prepared, retrySafe: clientId !== null }
    )
  }
  async updateItem(
    itemId: string,
    options: UpdateDatasetItemOptions,
    request: RequestOptions = {}
  ): Promise<DatasetItem> {
    const id = uuid(itemId)
    keys(options, ['baseVersion', 'input', 'expectedOutput', 'metadata'])
    const prepared = body({
      base_version: integer(options.baseVersion),
      input: options.input,
      expected_output: options.expectedOutput,
      metadata: options.metadata,
    })
    return this.#request(
      'PATCH',
      `${this.#items}${id}/`,
      (data) => item(data, this.#transport.projectId, { id, archived: false }),
      { ...request, body: prepared }
    )
  }
  async archiveItem(
    itemId: string,
    options: { baseVersion: number },
    request: RequestOptions = {}
  ): Promise<DatasetItem> {
    keys(options, ['baseVersion'])
    return this.#itemState(itemId, 'archive', { base_version: integer(options.baseVersion) }, request)
  }
  async restoreItem(
    itemId: string,
    options: { baseVersion: number; sourceVersion?: number },
    request: RequestOptions = {}
  ): Promise<DatasetItem> {
    keys(options, ['baseVersion', 'sourceVersion'])
    return this.#itemState(
      itemId,
      'restore',
      {
        base_version: integer(options.baseVersion),
        source_version: options.sourceVersion === undefined ? null : integer(options.sourceVersion),
      },
      request
    )
  }
  async #itemState(itemId: string, action: string, fields: WireObject, request: RequestOptions): Promise<DatasetItem> {
    const id = uuid(itemId)
    return this.#request(
      'POST',
      `${this.#items}${id}/${action}/`,
      (data) => item(data, this.#transport.projectId, { id, archived: action === 'archive' }),
      { ...request, body: body(fields) }
    )
  }
  async listItemVersions(itemId: string, options: PageOptions = {}): Promise<DatasetItemPage> {
    const id = uuid(itemId),
      { limit = 25, offset = 0 } = options
    return this.#request(
      'GET',
      `${this.#items}${id}/versions/`,
      (data) => page(data, (row) => item(row, this.#transport.projectId, { id }), offset),
      { signal: options.signal, params: pageParams(limit, offset) }
    )
  }
  async snapshot(datasetId: string, options: RequestOptions & { revision?: number } = {}): Promise<DatasetSnapshot> {
    const selectedRevision = options.revision
    if (selectedRevision !== undefined) integer(selectedRevision)
    const data = await this.get(datasetId, options),
      selected = selectedRevision ?? data.currentRevision
    if (selected === null) throw new TypeError('Dataset has no revision. Add an item first.')
    if (data.currentRevision === null || selected > data.currentRevision)
      throw new TypeError('Dataset revision does not exist.')
    if (selected === data.currentRevision && data.currentRevisionId !== null)
      return new DatasetSnapshot(this, data, selected, data.currentRevisionId)
    const candidate = await this.listRevisions(data.id, {
      limit: 1,
      offset: data.currentRevision - selected,
      signal: options.signal,
    })
    const found = candidate.results.find((r) => r.revision === selected)
    if (found) return new DatasetSnapshot(this, data, selected, found.id)
    let offset = 0
    for (;;) {
      const revisions = await this.listRevisions(data.id, { limit: 100, offset, signal: options.signal })
      const match = revisions.results.find((r) => r.revision === selected)
      if (match) return new DatasetSnapshot(this, data, selected, match.id)
      if (revisions.nextOffset === null || revisions.results.at(-1)!.revision < selected)
        throw new TypeError('Dataset revision does not exist.')
      offset = revisions.nextOffset
    }
  }
}
/** A repeatable, lazy read of active items at one immutable revision. Keep its client open. */
export class DatasetSnapshot implements AsyncIterable<DatasetItem> {
  readonly #datasets: Datasets
  readonly #dataset: Dataset
  readonly revision: number
  readonly revisionId: string
  constructor(datasets: Datasets, dataset: Dataset, revisionNumber: number, revisionId: string) {
    this.#datasets = datasets
    this.#dataset = structuredClone(dataset)
    this.revision = revisionNumber
    this.revisionId = revisionId
    Object.freeze(this)
  }
  get dataset(): Dataset {
    return structuredClone(this.#dataset)
  }
  async *iterItems(options: RequestOptions & { pageSize?: number } = {}): AsyncIterableIterator<DatasetItem> {
    const limit = integer(options.pageSize ?? 25, 1, 25)
    let offset = 0
    for (;;) {
      const result = await this.#datasets.listItems(this.#dataset.id, {
        revision: this.revision,
        archived: false,
        limit,
        offset,
        signal: options.signal,
      })
      for (const row of result.results) {
        options.signal?.throwIfAborted()
        yield row
      }
      if (result.nextOffset === null) return
      offset = result.nextOffset
    }
  }
  [Symbol.asyncIterator](): AsyncIterableIterator<DatasetItem> {
    return this.iterItems()
  }
}
