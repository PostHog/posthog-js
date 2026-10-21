import fixtures from './python-parity.json'
import {
    EvaluationItem,
    EvaluationResult,
    type EvaluationItemOptions,
    type EvaluationResultOptions,
} from '../../src/evaluations'
import { client, ID, mockFetch, reply, requestBody, requestURL } from './helpers'

// Normalize only schema-owned timestamps; payload strings remain untouched.
function normalize(value: unknown, key = ''): unknown {
    if (typeof value === 'string' && ['started_at', 'evaluated_at', 'source_timestamp'].includes(key))
        return value
            .replace('+00:00', 'Z')
            .replace(/(\.\d*?)0+Z$/, '$1Z')
            .replace('.Z', 'Z')
    if (Array.isArray(value)) return value.map((v) => normalize(v))
    if (value !== null && typeof value === 'object')
        return Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, k === 'payload' || k === 'metadata' ? v : normalize(v, k)])
        )
    return value
}
function invoke(instance: ReturnType<typeof client>, row: (typeof fixtures.cases)[number]): Promise<unknown> {
    const target =
        row.resource === 'client'
            ? instance
            : row.resource === 'experiment'
              ? instance.resumeExperiment(ID)
              : instance[row.resource as 'datasets' | 'scorers']
    const method = (target as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[row.method]
    return method.apply(target, row.args)
}
afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
})
describe('Python SDK wire parity (generated from the recorded Python revision)', () => {
    it.each(fixtures.cases)('$name sends the Python request and accepts its response', async (row) => {
        const fetch = mockFetch().mockResolvedValue(reply(row.response))
        await invoke(client(), row)
        expect(fetch).toHaveBeenCalledTimes(1)
        const url = requestURL(fetch)
        expect(url.pathname).toBe(row.request.path)
        expect(Object.fromEntries(url.searchParams)).toEqual(
            Object.fromEntries(
                Object.entries(row.request.params).map(([k, v]) => [
                    k,
                    typeof v === 'string' && k === 'tags' ? JSON.stringify(JSON.parse(v)) : String(v),
                ])
            )
        )
        expect(fetch.mock.calls[0][1].method).toBe(row.request.method)
        if ('body' in row.request) expect(normalize(requestBody(fetch))).toEqual(normalize(row.request.body))
        else expect(fetch.mock.calls[0][1].body).toBeUndefined()
    })
    it.each(fixtures.cases)('$name preserves the Python retry policy', async (row) => {
        vi.useFakeTimers()
        const fetch = mockFetch().mockImplementation(() => Promise.resolve(reply({ code: 'unavailable' }, 503)))
        const promise = invoke(client({ maxRetries: 1 }), row).catch((e) => e)
        await vi.runAllTimersAsync()
        expect(await promise).toMatchObject({ status: 503, persistence: 'unknown' })
        expect(fetch).toHaveBeenCalledTimes(row.request.retrySafe ? 2 : 1)
    })
    it.each(fixtures.declarations)('restores Python $kind declaration %#', (row) => {
        const declaration =
            row.kind === 'item'
                ? new EvaluationItem(row.options as EvaluationItemOptions)
                : new EvaluationResult(row.options as unknown as EvaluationResultOptions)
        expect(normalize(declaration.toJSON())).toEqual(normalize(row.wire))
        const restored = row.kind === 'item' ? EvaluationItem.fromJSON(row.wire) : EvaluationResult.fromJSON(row.wire)
        expect(normalize(restored.toJSON())).toEqual(normalize(row.wire))
    })
    it('uploads the exact Python item/result declarations and accepts the Python receipt', async () => {
        const fetch = mockFetch().mockResolvedValue(reply(fixtures.upload.response))
        const item = EvaluationItem.fromJSON(fixtures.upload.body.items[0])
        const result = EvaluationResult.fromJSON(fixtures.upload.body.results[0], { item })
        const receipt = await client().resumeExperiment(ID).uploadResults([result])
        expect(requestBody(fetch)).toEqual(fixtures.upload.body)
        expect(receipt.chunks[0].results[0].id).toBe(fixtures.upload.response.results[0].id)
    })
})
