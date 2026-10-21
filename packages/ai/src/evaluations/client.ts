import { randomUUID } from 'node:crypto'
import { Datasets } from './datasets'
import { EvaluationItem, EvaluationResult, itemJSON, resultJSON, type EvaluationResultOptions } from './declarations'
import { EvaluationAPIError, parseResponse } from './errors'
import { Scorers } from './scorers'
import {
    boolean,
    bytes,
    copy,
    count,
    decode,
    encode,
    identifier,
    keys,
    nullable,
    object,
    responseTags,
    tags,
    timestamp,
    uuid,
    type EvaluationCount,
    type WireObject,
} from './serialization'
import { OperationQueue, Transport, type OfflineEvaluationsOptions, type RequestOptions } from './transport'

export interface ExperimentOptions {
    name: string
    id?: string
    startedAt?: string | Date
    runSource?: 'ci' | 'local' | 'scheduled' | null
    expectedItemCount?: EvaluationCount | null
    expectedResultCount?: EvaluationCount | null
    suiteKey?: string | null
    datasetSource?: string | null
    datasetIdentifier?: string | null
    datasetRevisionIdentifier?: string | null
    datasetRevisionId?: string | null
    applicationVersion?: string | null
    modelVersion?: string | null
    promptVersion?: string | null
}
export interface ExperimentReceipt {
    id: string
    status: 'uploading' | 'completed' | 'failed'
    created: boolean
    startedAt: string
    createdAt: string
    finishedAt: string | null
    expectedItemCount: EvaluationCount | null
    expectedResultCount: EvaluationCount | null
    acceptedItemCount: EvaluationCount
    acceptedResultCount: EvaluationCount
}
export interface ItemReceipt {
    id: string
    created: boolean
    acceptedAt: string
}
export interface ResultReceipt extends ItemReceipt {
    itemId: string
    scorerVersionId: string
}
export interface UploadReceipt {
    items: ItemReceipt[]
    results: ResultReceipt[]
}
export interface BulkUploadReceipt {
    chunks: UploadReceipt[]
}
const EXPERIMENT_TEXT: Record<string, string> = {
    suiteKey: 'suite_key',
    datasetSource: 'dataset_source',
    datasetIdentifier: 'dataset_identifier',
    datasetRevisionIdentifier: 'dataset_revision_identifier',
    applicationVersion: 'application_version',
    modelVersion: 'model_version',
    promptVersion: 'prompt_version',
}
function experimentBody(options: ExperimentOptions): string {
    keys(options, [
        'name',
        'id',
        'startedAt',
        'runSource',
        'expectedItemCount',
        'expectedResultCount',
        'datasetRevisionId',
        ...Object.keys(EXPERIMENT_TEXT),
    ])
    const body: WireObject = {
        name: identifier(options.name, 400),
        id: uuid(options.id === undefined ? randomUUID() : options.id),
        started_at: timestamp(options.startedAt === undefined ? new Date() : options.startedAt),
    }
    for (const [key, wire] of Object.entries(EXPERIMENT_TEXT)) {
        const value = (options as unknown as WireObject)[key]
        if (value !== undefined) body[wire] = nullable(value, identifier)
    }
    if (options.runSource !== undefined) {
        if (options.runSource !== null && !['ci', 'local', 'scheduled'].includes(options.runSource))
            throw new TypeError('Invalid run source.')
        body.run_source = options.runSource
    }
    if (options.expectedItemCount !== undefined) body.expected_item_count = nullable(options.expectedItemCount, count)
    if (options.expectedResultCount !== undefined)
        body.expected_result_count = nullable(options.expectedResultCount, count)
    if (options.datasetRevisionId !== undefined) body.dataset_revision_id = nullable(options.datasetRevisionId, uuid)
    return encode(body)
}
function experimentReceipt(data: WireObject, id: string): ExperimentReceipt {
    if (uuid(data.id) !== id || !['uploading', 'completed', 'failed'].includes(String(data.status)))
        throw new TypeError('Mismatched experiment receipt.')
    return {
        id,
        status: data.status as ExperimentReceipt['status'],
        created: boolean(data.created),
        startedAt: timestamp(data.started_at),
        createdAt: timestamp(data.created_at),
        finishedAt: nullable(data.finished_at, timestamp),
        expectedItemCount: nullable(data.expected_item_count, count),
        expectedResultCount: nullable(data.expected_result_count, count),
        acceptedItemCount: count(data.accepted_item_count),
        acceptedResultCount: count(data.accepted_result_count),
    }
}
function itemReceipt(value: unknown): ItemReceipt {
    const data = object(value)
    return { id: uuid(data.id), created: boolean(data.created), acceptedAt: timestamp(data.accepted_at) }
}
function uploadReceipt(data: WireObject, submitted: readonly EvaluationResult[]): UploadReceipt {
    if (!Array.isArray(data.items) || !Array.isArray(data.results))
        throw new TypeError('Expected acknowledgment lists.')
    const items = data.items.map(itemReceipt)
    const results = data.results.map((value) => {
        const row = object(value)
        return { ...itemReceipt(row), itemId: uuid(row.item_id), scorerVersionId: uuid(row.scorer_version_id) }
    })
    const expectedItems = new Set(submitted.map((r) => r.itemId)),
        actualItems = new Set(items.map((i) => i.id))
    if (
        actualItems.size !== items.length ||
        actualItems.size !== expectedItems.size ||
        [...expectedItems].some((id) => !actualItems.has(id))
    )
        throw new TypeError('Incomplete item acknowledgments.')
    if (
        results.length !== submitted.length ||
        results.some(
            (r, i) => r.itemId !== submitted[i].itemId || r.scorerVersionId !== submitted[i].scorerVersionId
        ) ||
        new Set(results.map((r) => r.id)).size !== results.length
    )
        throw new TypeError('Incomplete result acknowledgments.')
    return { items, results }
}
interface Chunk {
    start: number
    results: EvaluationResult[]
    body: string
}
function uploadBody(items: string[], results: string[]): string {
    return `{"items":[${items.join(',')}],"results":[${results.join(',')}]}`
}
function chunks(input: readonly EvaluationResult[]): { chunks: Chunk[]; prepared: EvaluationResult[] } {
    if (!Array.isArray(input))
        throw new TypeError('uploadResults expects a finite array of EvaluationResult declarations.')
    const original = Array.from(input),
        identities = new Set<string>(),
        declarations = new Map<string, EvaluationItem>()
    for (const result of original) {
        resultJSON(result)
        const pair = `${result.itemId}/${result.scorerVersionId}`
        if (identities.has(pair)) throw new TypeError('Duplicate item/scorer-version pair.')
        identities.add(pair)
        if (result.item instanceof EvaluationItem) {
            const previous = declarations.get(result.itemId)
            if (previous && itemJSON(previous) !== itemJSON(result.item))
                throw new TypeError('Conflicting item declarations.')
            declarations.set(result.itemId, result.item)
        }
    }
    // Attach known declarations even to references, so pending work stays independently replayable.
    const prepared = original.map((r) =>
        typeof r.item === 'string' && declarations.has(r.itemId)
            ? EvaluationResult.fromJSON(r.toJSON(), { item: declarations.get(r.itemId) })
            : r
    )
    const output: Chunk[] = []
    let start = 0,
        size = bytes(uploadBody([], [])),
        encodedItems: string[] = [],
        encodedResults: string[] = [],
        itemIds = new Set<string>()
    for (let index = 0; index < prepared.length; index++) {
        const result = prepared[index],
            resultBody = resultJSON(result),
            declaration = declarations.get(result.itemId)
        let itemBody = declaration && !itemIds.has(result.itemId) ? itemJSON(declaration) : undefined
        let extra =
            bytes(resultBody) +
            (encodedResults.length ? 1 : 0) +
            (itemBody === undefined ? 0 : bytes(itemBody) + (encodedItems.length ? 1 : 0))
        if (
            encodedResults.length &&
            (encodedResults.length >= 1000 ||
                encodedItems.length + (itemBody === undefined ? 0 : 1) > 1000 ||
                size + extra > 5 * 1024 * 1024)
        ) {
            output.push({
                start,
                results: prepared.slice(start, index),
                body: uploadBody(encodedItems, encodedResults),
            })
            start = index
            size = bytes(uploadBody([], []))
            encodedItems = []
            encodedResults = []
            itemIds = new Set()
            itemBody = declaration ? itemJSON(declaration) : undefined
            extra = bytes(resultBody) + (itemBody === undefined ? 0 : bytes(itemBody))
        }
        if (size + extra > 5 * 1024 * 1024) throw new TypeError('One item/result pair exceeds the request byte limit.')
        if (itemBody !== undefined) {
            itemIds.add(result.itemId)
            encodedItems.push(itemBody)
        }
        encodedResults.push(resultBody)
        size += extra
    }
    if (encodedResults.length)
        output.push({ start, results: prepared.slice(start), body: uploadBody(encodedItems, encodedResults) })
    return { chunks: output, prepared }
}
/** Earlier chunks are acknowledged; pendingResults includes the uncertain failed chunk. */
export class BulkUploadError extends EvaluationAPIError {
    readonly failedIndex: number
    readonly #completed: BulkUploadReceipt
    readonly #pending: readonly EvaluationResult[]
    readonly #failed: string
    constructor(
        cause: EvaluationAPIError,
        completed: BulkUploadReceipt,
        failed: Chunk,
        pending: readonly EvaluationResult[]
    ) {
        super(cause)
        this.name = 'BulkUploadError'
        this.failedIndex = failed.start
        this.#completed = copy(completed)
        this.#pending = pending.slice()
        this.#failed = failed.body
    }
    get completed(): BulkUploadReceipt {
        return copy(this.#completed)
    }
    get pendingResults(): readonly EvaluationResult[] {
        return this.#pending.slice()
    }
    get failedChunk(): WireObject {
        return JSON.parse(this.#failed) as WireObject
    }
}

export class Experiment {
    readonly id: string
    readonly #transport: Transport
    readonly #base: string
    readonly #queue = new OperationQueue()
    readonly #submission?: string
    #receipt?: ExperimentReceipt
    constructor(transport: Transport, id: string, receipt?: ExperimentReceipt, submission?: string) {
        this.id = uuid(id)
        this.#transport = transport
        this.#receipt = receipt
        this.#submission = submission
        this.#base = `/api/projects/${transport.projectId}/ai_observability/offline_experiments/${this.id}/`
        Object.freeze(this)
    }
    get receipt(): ExperimentReceipt | undefined {
        return this.#receipt === undefined ? undefined : copy(this.#receipt)
    }
    /** Original creation options, suitable for createExperiment(submission). Large counts may be bigint. */
    get submission(): ExperimentOptions | undefined {
        return this.#submission === undefined ? undefined : submissionOptions(object(decode(this.#submission)))
    }
    async uploadResult(options: EvaluationResultOptions, request: RequestOptions = {}): Promise<UploadReceipt> {
        const chunk = chunks([new EvaluationResult(options)]).chunks[0]
        return this.#queue.run(() => this.#upload(chunk, request), request.signal)
    }
    async #upload(chunk: Chunk, request: RequestOptions): Promise<UploadReceipt> {
        return parseResponse(
            await this.#transport.request('POST', `${this.#base}upload/`, {
                ...request,
                body: chunk.body,
                retrySafe: true,
            }),
            (data) => uploadReceipt(data, chunk.results)
        )
    }
    async uploadResults(
        results: readonly EvaluationResult[],
        request: RequestOptions = {}
    ): Promise<BulkUploadReceipt> {
        const prepared = chunks(results)
        return this.#queue.run(async () => {
            const receipts: UploadReceipt[] = []
            for (const chunk of prepared.chunks) {
                try {
                    receipts.push(await this.#upload(chunk, request))
                } catch (error) {
                    if (!(error instanceof EvaluationAPIError)) throw error
                    throw new BulkUploadError(error, { chunks: receipts }, chunk, prepared.prepared.slice(chunk.start))
                }
            }
            return { chunks: receipts }
        }, request.signal)
    }
    async complete(request: RequestOptions = {}): Promise<ExperimentReceipt> {
        return this.#finish('complete', request)
    }
    async fail(request: RequestOptions = {}): Promise<ExperimentReceipt> {
        return this.#finish('fail', request)
    }
    async #finish(action: 'complete' | 'fail', request: RequestOptions): Promise<ExperimentReceipt> {
        return this.#queue.run(async () => {
            const receipt = parseResponse(
                await this.#transport.request('POST', `${this.#base}${action}/`, {
                    ...request,
                    body: '{}',
                    retrySafe: true,
                }),
                (data) => {
                    const result = experimentReceipt(data, this.id)
                    if (result.status !== (action === 'complete' ? 'completed' : 'failed'))
                        throw new TypeError('Unexpected experiment status.')
                    return result
                }
            )
            this.#receipt = copy(receipt)
            return receipt
        }, request.signal)
    }
    async getTags(request: RequestOptions = {}): Promise<string[]> {
        return this.#tags('GET', undefined, request)
    }
    async setTags(names: readonly string[], request: RequestOptions = {}): Promise<string[]> {
        return this.#tags('PATCH', encode({ tags: tags(names) }), request)
    }
    async #tags(method: string, body: string | undefined, request: RequestOptions): Promise<string[]> {
        return this.#queue.run(
            async () =>
                parseResponse(await this.#transport.request(method, this.#base, { ...request, body }), (data) => {
                    if (uuid(data.id) !== this.id) throw new TypeError('Mismatched experiment.')
                    return responseTags(data.tags)
                }),
            request.signal
        )
    }
}
function submissionOptions(data: WireObject): ExperimentOptions {
    const result: WireObject = { name: data.name, id: data.id, startedAt: data.started_at }
    for (const [key, wire] of Object.entries({
        ...EXPERIMENT_TEXT,
        runSource: 'run_source',
        expectedItemCount: 'expected_item_count',
        expectedResultCount: 'expected_result_count',
        datasetRevisionId: 'dataset_revision_id',
    }))
        if (Object.hasOwn(data, wire)) result[key] = data[wire]
    return result as unknown as ExperimentOptions
}
/** Acknowledged management APIs, independent of analytics capture and flush. */
export class OfflineEvaluations {
    readonly datasets: Datasets
    readonly scorers: Scorers
    readonly #transport: Transport
    constructor(options: OfflineEvaluationsOptions) {
        this.#transport = new Transport(options)
        this.datasets = new Datasets(this.#transport)
        this.scorers = new Scorers(this.#transport)
        Object.freeze(this)
    }
    async createExperiment(options: ExperimentOptions, request: RequestOptions = {}): Promise<Experiment> {
        const body = experimentBody(options),
            submission = object(decode(body)),
            id = uuid(submission.id)
        try {
            const data = await this.#transport.request(
                'POST',
                `/api/projects/${this.#transport.projectId}/ai_observability/offline_experiments/`,
                { ...request, body, retrySafe: true }
            )
            return new Experiment(
                this.#transport,
                id,
                parseResponse(data, (value) => experimentReceipt(value, id)),
                body
            )
        } catch (error) {
            if (!(error instanceof EvaluationAPIError)) throw error
            throw new EvaluationAPIError({
                ...error,
                detail: error.detail,
                errors: error.errors,
                response: error.response,
                submission: submissionOptions(submission),
            })
        }
    }
    /** Local only; existence and permissions are checked on the next network operation. */
    resumeExperiment(id: string): Experiment {
        return new Experiment(this.#transport, id)
    }
    /** Stop owned requests and timers. This never completes or fails experiments. */
    close(): void {
        this.#transport.close()
    }
}
