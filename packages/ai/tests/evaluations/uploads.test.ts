import { randomUUID } from 'node:crypto'
import { BulkUploadError, EvaluationItem, EvaluationResult } from '../../src/evaluations'
import { bytes } from '../../src/evaluations/serialization'
import {
    client,
    ID,
    ITEM,
    VERSION,
    TIME,
    experimentResponse,
    mockFetch,
    reply,
    requestBody,
    uploadResponse,
} from './helpers'
const result = (item: EvaluationItem | string = new EvaluationItem(), version = VERSION) =>
    new EvaluationResult({ item, scorerVersionId: version, value: false })
afterEach(() => vi.unstubAllGlobals())
it('Resume does not discover or create a run', () => {
    const fetch = mockFetch(),
        experiment = client().resumeExperiment(ID)
    expect(experiment.id).toBe(ID)
    expect(experiment.receipt).toBeUndefined()
    expect(experiment.submission).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
})
it('Multiple scorers share one item declaration', async () => {
    const fetch = mockFetch().mockImplementation((_url, init) => reply(uploadResponse(init.body)))
    const item = new EvaluationItem({ input: 'question' })
    const receipt = await client()
        .resumeExperiment(ID)
        .uploadResults([result(item), result(item, randomUUID())])
    expect(requestBody(fetch).items).toHaveLength(1)
    expect(receipt.chunks[0].results).toHaveLength(2)
})
it('Exact replay is observable without duplication', async () => {
    let saved: unknown
    mockFetch().mockImplementation((_url, init) => {
        if (!saved) saved = uploadResponse(init.body)
        else {
            const data = saved as { items: { created: boolean }[]; results: { created: boolean }[] }
            data.items.forEach((i) => {
                i.created = false
            })
            data.results.forEach((r) => {
                r.created = false
            })
        }
        return reply(saved)
    })
    const run = client().resumeExperiment(ID),
        declarations = [result()]
    const first = await run.uploadResults(declarations),
        second = await run.uploadResults(declarations)
    expect(second.chunks[0].results[0]).toEqual({ ...first.chunks[0].results[0], created: false })
})
it.each([
    'missing result',
    'missing item',
    'duplicate item',
    'duplicate result ID',
    'reordered pairs',
    'wrong scorer',
    'bad created',
    'bad timestamp',
])('Missing acknowledgments remain uncertain: %s', async (fault) => {
    const fetch = mockFetch().mockImplementation((_url, init) => {
        const data = uploadResponse(init.body) as {
            items: Record<string, unknown>[]
            results: Record<string, unknown>[]
        }
        if (fault === 'missing result') data.results.pop()
        if (fault === 'missing item') data.items.pop()
        if (fault === 'duplicate item') data.items.push(data.items[0])
        if (fault === 'duplicate result ID') data.results[1].id = data.results[0].id
        if (fault === 'reordered pairs') data.results.reverse()
        if (fault === 'wrong scorer') data.results[0].scorer_version_id = randomUUID()
        if (fault === 'bad created') data.results[0].created = 'yes'
        if (fault === 'bad timestamp') data.results[0].accepted_at = 'yesterday'
        return reply(data)
    })
    const error = await client({ maxRetries: 3 })
        .resumeExperiment(ID)
        .uploadResults([result(), result()])
        .catch((e) => e)
    expect(error).toBeInstanceOf(BulkUploadError)
    expect(error).toMatchObject({ code: 'invalid_response', persistence: 'unknown', failedIndex: 0 })
    expect(fetch).toHaveBeenCalledTimes(1)
})
it('Count boundaries preserve independently replayable declarations', async () => {
    const fetch = mockFetch().mockImplementation((_url, init) => reply(uploadResponse(init.body)))
    const item = new EvaluationItem({ input: 'one' })
    const declarations = Array.from({ length: 1001 }, () => result(item, randomUUID()))
    const receipt = await client().resumeExperiment(ID).uploadResults(declarations)
    expect(receipt.chunks.map((c) => c.results.length)).toEqual([1000, 1])
    for (let i = 0; i < 2; i++) expect(requestBody(fetch, i).items).toEqual([item.toJSON()])
})
it('UTF-8 request size includes the envelope', async () => {
    const fetch = mockFetch().mockImplementation((_url, init) => reply(uploadResponse(init.body)))
    const declarations = Array.from({ length: 8 }, () => result(new EvaluationItem({ input: 'é'.repeat(500000) })))
    await client().resumeExperiment(ID).uploadResults(declarations)
    expect(fetch).toHaveBeenCalledTimes(2)
    for (const [, init] of fetch.mock.calls) expect(bytes(init.body)).toBeLessThanOrEqual(5 * 1024 * 1024)
    expect(
        fetch.mock.calls.flatMap(([, init]) => JSON.parse(init.body).results.map((r: { item_id: string }) => r.item_id))
    ).toEqual(declarations.map((r) => r.itemId))
})
it('Invalid bulk input sends no partial work', async () => {
    const fetch = mockFetch(),
        run = client().resumeExperiment(ID),
        item = new EvaluationItem({ id: ITEM })
    await expect(run.uploadResults([result(item), result(item)])).rejects.toThrow('Duplicate')
    await expect(
        run.uploadResults([result(item), result(new EvaluationItem({ id: ITEM, input: 'different' }), randomUUID())])
    ).rejects.toThrow('Conflicting')
    await expect(run.uploadResults([result(), {} as EvaluationResult])).rejects.toThrow()
    expect(await run.uploadResults([])).toEqual({ chunks: [] })
    expect(fetch).not.toHaveBeenCalled()
})
it('The second chunk fails after the first is acknowledged', async () => {
    const fetch = mockFetch()
        .mockImplementationOnce((_url, init) => reply(uploadResponse(init.body)))
        .mockRejectedValueOnce(new Error('lost response'))
    const item = new EvaluationItem({ input: 'shared' }),
        run = client().resumeExperiment(ID)
    // Only the first result attaches the item. All later references still need it for recovery.
    const declarations = Array.from({ length: 2001 }, (_, i) => result(i === 0 ? item : item.id, randomUUID()))
    const error = (await run.uploadResults(declarations).catch((e) => e)) as BulkUploadError
    expect(error).toBeInstanceOf(BulkUploadError)
    expect(error.completed.chunks).toHaveLength(1)
    expect(error.failedIndex).toBe(1000)
    expect(error.pendingResults).toHaveLength(1001)
    expect(error.persistence).toBe('unknown')
    expect(fetch).toHaveBeenCalledTimes(2)
    const failed = error.failedChunk
    failed.items = []
    expect(error.failedChunk.items).toHaveLength(1)
    fetch.mockImplementation((_url, init) => reply(uploadResponse(init.body)))
    await run.uploadResults(error.pendingResults)
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[2][1].body)
    expect(fetch).toHaveBeenCalledTimes(4)
})
it('Count mismatch leaves the experiment open', async () => {
    const fetch = mockFetch()
        .mockResolvedValueOnce(reply(experimentResponse()))
        .mockResolvedValueOnce(reply({ code: 'count_mismatch', detail: { expected: 2, accepted: 1 } }, 409))
    const run = await client().createExperiment({ name: 'Run', id: ID, expectedResultCount: 2 })
    await expect(run.complete()).rejects.toMatchObject({
        status: 409,
        persistence: 'rejected',
        detail: { expected: 2, accepted: 1 },
    })
    expect(run.receipt?.status).toBe('uploading')
    expect(fetch).toHaveBeenCalledTimes(2)
})
it('Failure is explicit and repeatable', async () => {
    const fetch = mockFetch().mockImplementation(() =>
        reply(experimentResponse({ status: 'failed', finished_at: TIME }))
    )
    const run = client().resumeExperiment(ID)
    const first = await run.fail(),
        second = await run.fail()
    expect(first).toEqual(second)
    expect(run.receipt?.status).toBe('failed')
    expect(fetch.mock.calls.every(([url]) => String(url).endsWith('/fail/'))).toBe(true)
})
it('Closed experiments permit exact replay but reject new data', async () => {
    const fetch = mockFetch()
        .mockResolvedValueOnce(reply(experimentResponse({ status: 'completed', finished_at: TIME })))
        .mockImplementationOnce((_url, init) => reply(uploadResponse(init.body, false)))
        .mockResolvedValueOnce(reply({ code: 'closed' }, 409))
    const run = client().resumeExperiment(ID)
    await run.complete()
    expect((await run.uploadResults([result()])).chunks[0].results[0].created).toBe(false)
    await expect(run.uploadResults([result()])).rejects.toMatchObject({ status: 409, persistence: 'rejected' })
    expect(fetch).toHaveBeenCalledTimes(3)
})
it('Experiment tags can change after completion', async () => {
    const fetch = mockFetch()
        .mockResolvedValueOnce(reply(experimentResponse()))
        .mockResolvedValueOnce(reply(experimentResponse({ status: 'completed', finished_at: TIME })))
        .mockResolvedValueOnce(reply({ id: ID, tags: ['regression'] }))
    const run = await client().createExperiment({ name: 'Run', id: ID })
    const original = run.submission
    await run.complete()
    expect(await run.setTags([' Regression ', 'regression'])).toEqual(['regression'])
    expect(requestBody(fetch, 2)).toEqual({ tags: [' Regression ', 'regression'] })
    expect(run.submission).toEqual(original)
    expect(run.receipt?.status).toBe('completed')
})
it('serializes all chunks before completion and lets a cancelled queued operation leave the queue', async () => {
    let release!: (response: Response) => void
    const fetch = mockFetch()
        .mockImplementationOnce(
            (_url, init) =>
                new Promise((resolve) => {
                    release = () => resolve(reply(uploadResponse(init.body)))
                })
        )
        .mockImplementation((url, init) =>
            String(url).endsWith('/upload/')
                ? reply(uploadResponse(init.body))
                : reply(experimentResponse({ status: 'completed', finished_at: TIME }))
        )
    const run = client().resumeExperiment(ID)
    const upload = run.uploadResults(Array.from({ length: 1001 }, () => result()))
    const abort = new AbortController()
    const cancelled = run.getTags({ signal: abort.signal }).catch((e) => e)
    const complete = run.complete()
    await Promise.resolve()
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1)
    abort.abort()
    expect((await cancelled).name).toBe('AbortError')
    release(reply({}))
    await upload
    await complete
    expect(fetch.mock.calls.map(([url]) => String(url).split('/').at(-2))).toEqual(['upload', 'upload', 'complete'])
})
it('snapshots pending caller arrays and recovers the queue after a rejected operation', async () => {
    mockFetch()
        .mockResolvedValueOnce(reply({}, 409))
        .mockImplementation((_url, init) => reply(uploadResponse(init.body)))
    const run = client().resumeExperiment(ID)
    await expect(run.complete()).rejects.toThrow()
    const results = [result()]
    const pending = run.uploadResults(results)
    results.push(result())
    expect((await pending).chunks[0].results).toHaveLength(1)
})
