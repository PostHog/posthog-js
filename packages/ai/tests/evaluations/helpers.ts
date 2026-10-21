import { randomUUID } from 'node:crypto'
import { OfflineEvaluations } from '../../src/evaluations'
import type { WireObject } from '../../src/evaluations/serialization'
export const ID = '8cba6d9e-d2ee-4b23-a545-a61057da5870'
export const ITEM = '7d1e9d28-9b64-4c95-b4ad-3e6fa6b975b1'
export const VERSION = 'f72481ec-1310-41de-b5bb-d20e1c59f121'
export const DATASET = '015e4ac4-3659-456b-998c-4345b4e4c846'
export const REVISION = 'ba71a1bb-836f-4c19-9d06-1d36d44948a4'
export const TIME = '2026-10-02T12:00:00.000Z'
export const client = (options = {}) =>
    new OfflineEvaluations({ projectId: 123, secretKey: 'test-secret', maxRetries: 0, ...options })
export function reply(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(value), { status, headers })
}
export function experimentResponse(overrides: WireObject = {}): WireObject {
    return {
        id: ID,
        status: 'uploading',
        created: true,
        started_at: TIME,
        created_at: TIME,
        finished_at: null,
        expected_item_count: null,
        expected_result_count: null,
        accepted_item_count: 0,
        accepted_result_count: 0,
        ...overrides,
    }
}
export function uploadResponse(body: string, created = true): WireObject {
    const data = JSON.parse(body)
    return {
        items: Array.from(new Set(data.results.map((r: WireObject) => r.item_id))).map((id) => ({
            id,
            created,
            accepted_at: TIME,
        })),
        results: data.results.map((r: WireObject) => ({
            id: randomUUID(),
            item_id: r.item_id,
            scorer_version_id: r.scorer_version_id,
            created,
            accepted_at: TIME,
        })),
    }
}
export function datasetResponse(overrides: WireObject = {}): WireObject {
    return {
        id: DATASET,
        name: 'Cases',
        description: '',
        metadata: {},
        tags: [],
        archived: false,
        current_revision: 3,
        current_revision_id: REVISION,
        created_at: TIME,
        updated_at: null,
        created_by: null,
        team_id: 123,
        ...overrides,
    }
}
export function itemResponse(overrides: WireObject = {}): WireObject {
    return {
        id: ITEM,
        dataset: DATASET,
        client_item_id: 'case-A',
        version: 2,
        version_id: VERSION,
        dataset_revision: 2,
        dataset_revision_id: REVISION,
        archived: false,
        input: false,
        expected_output: 0,
        source_output: 'old-output',
        metadata: {},
        source_trace_id: 'old-trace',
        source_event_id: null,
        source_timestamp: TIME,
        created_at: TIME,
        updated_at: null,
        created_by: null,
        version_created_at: TIME,
        version_created_by: null,
        team_id: 123,
        ...overrides,
    }
}
export function scorerResponse(overrides: WireObject = {}): WireObject {
    return {
        id: ID,
        name: 'Quality',
        description: '',
        kind: 'numeric',
        config: { min: 0, max: 1 },
        archived: false,
        current_version: 1,
        current_version_id: VERSION,
        created_at: TIME,
        updated_at: TIME,
        created_by: null,
        team: 123,
        ...overrides,
    }
}
export function pageResponse(results: WireObject[], next: string | null = null): WireObject {
    return { count: results.length, results, next, previous: null }
}
export function mockFetch(): ReturnType<typeof vi.fn> {
    const mock = vi.fn()
    vi.stubGlobal('fetch', mock)
    return mock
}
export function requestBody(mock: ReturnType<typeof vi.fn>, index = 0): WireObject {
    return JSON.parse(mock.mock.calls[index][1].body)
}
export function requestURL(mock: ReturnType<typeof vi.fn>, index = 0): URL {
    return new URL(String(mock.mock.calls[index][0]))
}
