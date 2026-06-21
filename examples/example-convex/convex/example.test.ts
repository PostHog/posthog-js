/// <reference types="vite/client" />
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { initConvexTest } from './setup.test.js'
import { api, components } from './_generated/api.js'

// Keep a guard above Jest's 5s default; scheduled functions are driven deterministically below.
jest.setTimeout(15000)

// Collect all fetch calls for assertion
let fetchCalls: Array<{ url: string; body: unknown }> = []
const originalFetch = global.fetch

function mockFetch(responseByUrl?: Record<string, unknown>) {
    fetchCalls = []
    return jest.fn(async (url: string | URL, init?: RequestInit) => {
        const urlStr = url.toString()
        let body: unknown
        if (init?.body) {
            let rawText: string
            if (init.body instanceof Blob) {
                const headers = init.headers as Record<string, string> | undefined
                if (headers?.['Content-Encoding'] === 'gzip') {
                    const ds = new DecompressionStream('gzip')
                    rawText = await new Response(init.body.stream().pipeThrough(ds)).text()
                } else {
                    rawText = await init.body.text()
                }
            } else {
                rawText = init.body as string
            }
            try {
                body = JSON.parse(rawText)
            } catch {
                body = rawText
            }
        }
        fetchCalls.push({ url: urlStr, body })

        if (responseByUrl) {
            for (const [pattern, response] of Object.entries(responseByUrl)) {
                if (urlStr.includes(pattern)) {
                    return new Response(JSON.stringify(response), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    })
                }
            }
        }

        return new Response(JSON.stringify({ status: 1 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })
    }) as unknown as typeof fetch
}

function batchCalls() {
    return fetchCalls.filter((c) => c.url.includes('/batch'))
}

function flagsCalls() {
    return fetchCalls.filter((c) => c.url.includes('/flags'))
}

// Extract the first event from the first batch call
function firstBatchEvent(): Record<string, unknown> {
    const batches = batchCalls()
    const batch = batches[0]?.body as { batch: Record<string, unknown>[] }
    return batch?.batch?.[0] ?? {}
}

async function finishScheduledFunctions(t: ReturnType<typeof initConvexTest>) {
    // Let convex-test advance scheduler timers and wait for each scheduled function to finish.
    // A single timer pass can race with the scheduled action starting, which makes assertions
    // observe no PostHog batch call or leaves scheduled writes running during the next test.
    await t.finishAllScheduledFunctions(() => {
        jest.runOnlyPendingTimers()
    })
}

describe('capture', () => {
    beforeEach(() => {
        process.env.POSTHOG_PROJECT_TOKEN = 'phc_test_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_PROJECT_TOKEN
        delete process.env.POSTHOG_HOST
        fetchCalls = []
    })

    test('sends event to PostHog API with correct distinct_id and event name', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        const result = await t.mutation(api.example.testCapture, {
            distinctId: 'user-123',
            event: 'button_clicked',
        })
        expect(result).toEqual({ success: true })
        await finishScheduledFunctions(t)

        expect(batchCalls().length).toBeGreaterThanOrEqual(1)
        const batch = batchCalls()[0].body as { api_key: string }
        expect(batch.api_key).toBe('phc_test_key')

        const event = firstBatchEvent()
        expect(event.distinct_id).toBe('user-123')
        expect(event.event).toBe('button_clicked')
    })

    test('sends properties and groups', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        await t.mutation(api.example.testCapture, {
            distinctId: 'user-456',
            event: 'purchase',
            properties: { plan: 'pro', amount: 99 },
            groups: { company: 'acme' },
        })
        await finishScheduledFunctions(t)

        const event = firstBatchEvent()
        const props = event.properties as Record<string, unknown>
        expect(props.plan).toBe('pro')
        expect(props.amount).toBe(99)
        expect(props.$groups).toEqual({ company: 'acme' })
    })

    test('beforeSend enriches properties with environment', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        await t.mutation(api.example.testCapture, {
            distinctId: 'user-123',
            event: 'test',
            properties: { foo: 'bar' },
        })
        await finishScheduledFunctions(t)

        const props = firstBatchEvent().properties as Record<string, unknown>
        expect(props.environment).toBe('example-app')
        expect(props.foo).toBe('bar')
    })

    test('sends disableGeoip flag', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        await t.mutation(api.example.testCapture, {
            distinctId: 'user-123',
            event: 'test',
            disableGeoip: true,
        })
        await finishScheduledFunctions(t)

        const props = firstBatchEvent().properties as Record<string, unknown>
        expect(props.$geoip_disable).toBe(true)
    })

    test('sends custom uuid', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        await t.mutation(api.example.testCapture, {
            distinctId: 'user-123',
            event: 'test',
            uuid: 'custom-uuid-abc',
        })
        await finishScheduledFunctions(t)

        const event = firstBatchEvent()
        expect(event.uuid).toBe('custom-uuid-abc')
    })

    test('sends timestamp', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        await t.mutation(api.example.testCapture, {
            distinctId: 'user-123',
            event: 'test',
            timestamp: '2024-06-15T12:00:00Z',
        })
        await finishScheduledFunctions(t)

        const event = firstBatchEvent()
        expect(event.timestamp).toContain('2024-06-15')
    })
})

describe('identify', () => {
    beforeEach(() => {
        process.env.POSTHOG_PROJECT_TOKEN = 'phc_test_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_PROJECT_TOKEN
        delete process.env.POSTHOG_HOST
        fetchCalls = []
    })

    test('sends $identify event', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        const result = await t.mutation(api.example.testIdentify, {
            distinctId: 'user-123',
        })
        expect(result).toEqual({ success: true })
        await finishScheduledFunctions(t)

        expect(batchCalls().length).toBeGreaterThanOrEqual(1)
        const event = firstBatchEvent()
        expect(event.event).toBe('$identify')
        expect(event.distinct_id).toBe('user-123')
    })

    test('sends user properties', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        await t.mutation(api.example.testIdentify, {
            distinctId: 'user-123',
            properties: {
                name: 'Test User',
                email: 'test@example.com',
            },
        })
        await finishScheduledFunctions(t)

        const event = firstBatchEvent()
        // posthog-node puts properties into $set inside event.properties
        const props = event.properties as Record<string, unknown>
        const $set = props.$set as Record<string, unknown>
        expect($set.name).toBe('Test User')
        expect($set.email).toBe('test@example.com')
    })

    test('sends disableGeoip', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        await t.mutation(api.example.testIdentify, {
            distinctId: 'user-123',
            disableGeoip: true,
        })
        await finishScheduledFunctions(t)

        const props = firstBatchEvent().properties as Record<string, unknown>
        expect(props.$geoip_disable).toBe(true)
    })
})

describe('captureException', () => {
    beforeEach(() => {
        process.env.POSTHOG_PROJECT_TOKEN = 'phc_test_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_PROJECT_TOKEN
        delete process.env.POSTHOG_HOST
        fetchCalls = []
    })

    test('sends $exception event with Error object', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        const result = await t.mutation(api.example.testCaptureException, {
            errorMessage: 'Something went wrong',
            errorType: 'error',
        })
        expect(result).toEqual({ success: true })
        await finishScheduledFunctions(t)

        expect(batchCalls().length).toBeGreaterThanOrEqual(1)
        const event = firstBatchEvent()
        expect(event.event).toBe('$exception')
        const props = event.properties as Record<string, unknown>
        // posthog-node v5 uses $exception_list instead of $exception_message
        const exceptionList = props.$exception_list as Array<{
            value: string
            type: string
        }>
        expect(exceptionList[0].value).toBe('Something went wrong')
    })

    test('sends $exception event with string error', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        await t.mutation(api.example.testCaptureException, {
            errorMessage: 'string error',
            errorType: 'string',
        })
        await finishScheduledFunctions(t)

        const props = firstBatchEvent().properties as Record<string, unknown>
        const exceptionList = props.$exception_list as Array<{
            value: string
        }>
        expect(exceptionList[0].value).toBe('string error')
    })

    test('sends $exception event with object error', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        await t.mutation(api.example.testCaptureException, {
            errorMessage: 'obj error',
            errorType: 'object',
        })
        await finishScheduledFunctions(t)

        const props = firstBatchEvent().properties as Record<string, unknown>
        const exceptionList = props.$exception_list as Array<{
            value: string
        }>
        expect(exceptionList[0].value).toBe('obj error')
    })

    test('includes additional properties', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        await t.mutation(api.example.testCaptureException, {
            errorMessage: 'test',
            additionalProperties: { page: '/checkout', step: 3 },
        })
        await finishScheduledFunctions(t)

        const props = firstBatchEvent().properties as Record<string, unknown>
        expect(props.page).toBe('/checkout')
        expect(props.step).toBe(3)
    })

    test('uses distinctId when provided', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        await t.mutation(api.example.testCaptureException, {
            errorMessage: 'test',
            distinctId: 'specific-user',
        })
        await finishScheduledFunctions(t)

        expect(firstBatchEvent().distinct_id).toBe('specific-user')
    })
})

// --- Local feature flag evaluation tests ---
//
// In v1, feature flags are evaluated locally against definitions cached by the component cron.
// Tests mock `/flags/definitions`, trigger the refresh action to populate the cache, then
// invoke the user-defined queries.

type FlagDefinition = {
    id: number
    name: string
    key: string
    filters: {
        groups: Array<{
            properties: Array<{ key: string; value: unknown; operator?: string; type?: string }>
            rollout_percentage?: number
            variant?: string
        }>
        multivariate?: { variants: Array<{ key: string; rollout_percentage: number }> }
        payloads?: Record<string, string>
        aggregation_group_type_index?: number
    }
    deleted: boolean
    active: boolean
    rollout_percentage: number | null
    ensure_experience_continuity: boolean
    experiment_set: number[]
}

function flagDef(key: string, overrides: Partial<FlagDefinition> = {}): FlagDefinition {
    return {
        id: 1,
        name: key,
        key,
        deleted: false,
        active: true,
        rollout_percentage: null,
        ensure_experience_continuity: false,
        experiment_set: [],
        filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
        ...overrides,
    }
}

function definitionsResponse(flags: FlagDefinition[]) {
    return {
        '/flags/definitions': {
            flags,
            group_type_mapping: {},
            cohorts: {},
        },
    }
}

async function loadDefinitions(t: ReturnType<typeof initConvexTest>) {
    // Credentials are read from POSTHOG_PROJECT_TOKEN / POSTHOG_HOST / POSTHOG_PERSONAL_API_KEY env vars
    // inside the component action, so the call itself takes no args.
    await t.action(components.posthog.lib.refreshFlagDefinitions, {})
}

describe('getFeatureFlag (local eval)', () => {
    beforeEach(() => {
        process.env.POSTHOG_PROJECT_TOKEN = 'phc_test_key'
        process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test_personal_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_PROJECT_TOKEN
        delete process.env.POSTHOG_PERSONAL_API_KEY
        delete process.env.POSTHOG_HOST
        fetchCalls = []
    })

    test('returns true for fully-rolled-out boolean flag', async () => {
        global.fetch = mockFetch(definitionsResponse([flagDef('test-flag')]))
        const t = initConvexTest()
        await loadDefinitions(t)

        const result = await t.query(api.example.testGetFeatureFlag, {
            distinctId: 'user-123',
            flagKey: 'test-flag',
        })

        expect(result).toEqual({ flagKey: 'test-flag', value: true })
    })

    test('returns null for non-existent flag', async () => {
        global.fetch = mockFetch(definitionsResponse([]))
        const t = initConvexTest()
        await loadDefinitions(t)

        const result = await t.query(api.example.testGetFeatureFlag, {
            distinctId: 'user-123',
            flagKey: 'missing',
        })

        expect(result).toEqual({ flagKey: 'missing', value: null })
    })

    test('returns null when local definitions have not loaded yet', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()
        // Intentionally skip loadDefinitions — the cache is empty.

        const result = await t.query(api.example.testGetFeatureFlag, {
            distinctId: 'user-123',
            flagKey: 'test-flag',
        })

        expect(result).toEqual({ flagKey: 'test-flag', value: null })
    })

    test('matches by person properties', async () => {
        global.fetch = mockFetch(
            definitionsResponse([
                flagDef('test-flag', {
                    filters: {
                        groups: [
                            {
                                properties: [{ key: 'email', value: ['user@acme.com'], operator: 'exact', type: 'person' }],
                                rollout_percentage: 100,
                            },
                        ],
                    },
                }),
            ])
        )
        const t = initConvexTest()
        await loadDefinitions(t)

        const matched = await t.query(api.example.testGetFeatureFlag, {
            distinctId: 'user-123',
            flagKey: 'test-flag',
            personProperties: { email: 'user@acme.com' },
        })
        expect(matched.value).toBe(true)

        const unmatched = await t.query(api.example.testGetFeatureFlag, {
            distinctId: 'user-123',
            flagKey: 'test-flag',
            personProperties: { email: 'other@example.com' },
        })
        expect(unmatched.value).toBe(false)
    })

    test('returns variant key for multivariate flags', async () => {
        global.fetch = mockFetch(
            definitionsResponse([
                flagDef('mv-flag', {
                    filters: {
                        groups: [{ properties: [], rollout_percentage: 100, variant: 'variant-a' }],
                        multivariate: {
                            variants: [
                                { key: 'variant-a', rollout_percentage: 100 },
                                { key: 'variant-b', rollout_percentage: 0 },
                            ],
                        },
                    },
                }),
            ])
        )
        const t = initConvexTest()
        await loadDefinitions(t)

        const result = await t.query(api.example.testGetFeatureFlag, {
            distinctId: 'user-123',
            flagKey: 'mv-flag',
        })

        expect(result.value).toBe('variant-a')
    })
})

describe('isFeatureEnabled (local eval)', () => {
    beforeEach(() => {
        process.env.POSTHOG_PROJECT_TOKEN = 'phc_test_key'
        process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test_personal_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_PROJECT_TOKEN
        delete process.env.POSTHOG_PERSONAL_API_KEY
        delete process.env.POSTHOG_HOST
        fetchCalls = []
    })

    test('returns true for enabled boolean flag', async () => {
        global.fetch = mockFetch(definitionsResponse([flagDef('on-flag')]))
        const t = initConvexTest()
        await loadDefinitions(t)

        const result = await t.query(api.example.testIsFeatureEnabled, {
            distinctId: 'user-123',
            flagKey: 'on-flag',
        })
        expect(result).toEqual({ flagKey: 'on-flag', enabled: true })
    })

    test('returns true for a string variant', async () => {
        global.fetch = mockFetch(
            definitionsResponse([
                flagDef('mv-flag', {
                    filters: {
                        groups: [{ properties: [], rollout_percentage: 100, variant: 'variant-a' }],
                        multivariate: {
                            variants: [
                                { key: 'variant-a', rollout_percentage: 100 },
                                { key: 'variant-b', rollout_percentage: 0 },
                            ],
                        },
                    },
                }),
            ])
        )
        const t = initConvexTest()
        await loadDefinitions(t)

        const result = await t.query(api.example.testIsFeatureEnabled, {
            distinctId: 'user-123',
            flagKey: 'mv-flag',
        })
        expect(result).toEqual({ flagKey: 'mv-flag', enabled: true })
    })

    test('returns null for non-existent flag', async () => {
        global.fetch = mockFetch(definitionsResponse([]))
        const t = initConvexTest()
        await loadDefinitions(t)

        const result = await t.query(api.example.testIsFeatureEnabled, {
            distinctId: 'user-123',
            flagKey: 'missing',
        })
        expect(result).toEqual({ flagKey: 'missing', enabled: null })
    })
})

describe('getFeatureFlagPayload (local eval)', () => {
    beforeEach(() => {
        process.env.POSTHOG_PROJECT_TOKEN = 'phc_test_key'
        process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test_personal_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_PROJECT_TOKEN
        delete process.env.POSTHOG_PERSONAL_API_KEY
        delete process.env.POSTHOG_HOST
        fetchCalls = []
    })

    test('returns payload for matching flag', async () => {
        global.fetch = mockFetch(
            definitionsResponse([
                flagDef('test-flag', {
                    filters: {
                        groups: [{ properties: [], rollout_percentage: 100 }],
                        payloads: { true: JSON.stringify({ key: 'value' }) },
                    },
                }),
            ])
        )
        const t = initConvexTest()
        await loadDefinitions(t)

        const result = await t.query(api.example.testGetFeatureFlagPayload, {
            distinctId: 'user-123',
            flagKey: 'test-flag',
        })
        expect(result).toEqual({ flagKey: 'test-flag', payload: { key: 'value' } })
    })

    test('returns null when no payload is configured', async () => {
        global.fetch = mockFetch(definitionsResponse([flagDef('test-flag')]))
        const t = initConvexTest()
        await loadDefinitions(t)

        const result = await t.query(api.example.testGetFeatureFlagPayload, {
            distinctId: 'user-123',
            flagKey: 'test-flag',
        })
        expect(result).toEqual({ flagKey: 'test-flag', payload: null })
    })

    test('honours matchValue parameter', async () => {
        global.fetch = mockFetch(
            definitionsResponse([
                flagDef('mv-flag', {
                    filters: {
                        groups: [{ properties: [], rollout_percentage: 0 }],
                        multivariate: {
                            variants: [
                                { key: 'variant-a', rollout_percentage: 50 },
                                { key: 'variant-b', rollout_percentage: 50 },
                            ],
                        },
                        payloads: { 'variant-a': 'payload-data' },
                    },
                }),
            ])
        )
        const t = initConvexTest()
        await loadDefinitions(t)

        const result = await t.query(api.example.testGetFeatureFlagPayload, {
            distinctId: 'user-123',
            flagKey: 'mv-flag',
            matchValue: 'variant-a',
        })
        expect(result.flagKey).toBe('mv-flag')
        expect(result.payload).toBe('payload-data')
    })
})

describe('getFeatureFlagResult (local eval)', () => {
    beforeEach(() => {
        process.env.POSTHOG_PROJECT_TOKEN = 'phc_test_key'
        process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test_personal_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_PROJECT_TOKEN
        delete process.env.POSTHOG_PERSONAL_API_KEY
        delete process.env.POSTHOG_HOST
        fetchCalls = []
    })

    test('returns variant and payload for multivariate flag', async () => {
        global.fetch = mockFetch(
            definitionsResponse([
                flagDef('test-flag', {
                    filters: {
                        groups: [{ properties: [], rollout_percentage: 100, variant: 'variant-a' }],
                        multivariate: {
                            variants: [
                                { key: 'variant-a', rollout_percentage: 100 },
                                { key: 'variant-b', rollout_percentage: 0 },
                            ],
                        },
                        payloads: { 'variant-a': JSON.stringify({ config: true }) },
                    },
                }),
            ])
        )
        const t = initConvexTest()
        await loadDefinitions(t)

        const result = await t.query(api.example.testGetFeatureFlagResult, {
            distinctId: 'user-123',
            flagKey: 'test-flag',
        })
        expect(result.flagKey).toBe('test-flag')
        expect(result.result).not.toBeNull()
        expect(result.result!.enabled).toBe(true)
        expect(result.result!.variant).toBe('variant-a')
        expect(result.result!.payload).toEqual({ config: true })
    })

    test('returns null for non-existent flag', async () => {
        global.fetch = mockFetch(definitionsResponse([]))
        const t = initConvexTest()
        await loadDefinitions(t)

        const result = await t.query(api.example.testGetFeatureFlagResult, {
            distinctId: 'user-123',
            flagKey: 'missing',
        })
        expect(result).toEqual({ flagKey: 'missing', result: null })
    })
})

describe('getAllFlags (local eval)', () => {
    beforeEach(() => {
        process.env.POSTHOG_PROJECT_TOKEN = 'phc_test_key'
        process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test_personal_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_PROJECT_TOKEN
        delete process.env.POSTHOG_PERSONAL_API_KEY
        delete process.env.POSTHOG_HOST
        fetchCalls = []
    })

    test('returns all flag values', async () => {
        global.fetch = mockFetch(
            definitionsResponse([
                flagDef('flag-a'),
                flagDef('flag-b', {
                    filters: {
                        groups: [{ properties: [], rollout_percentage: 100, variant: 'variant-1' }],
                        multivariate: {
                            variants: [
                                { key: 'variant-1', rollout_percentage: 100 },
                                { key: 'variant-2', rollout_percentage: 0 },
                            ],
                        },
                    },
                }),
                flagDef('flag-c', { active: false }),
            ])
        )
        const t = initConvexTest()
        await loadDefinitions(t)

        const result = await t.query(api.example.testGetAllFlags, { distinctId: 'user-123' })

        expect(result.flags).toEqual({
            'flag-a': true,
            'flag-b': 'variant-1',
            'flag-c': false,
        })
    })

    test('respects flagKeys filter', async () => {
        global.fetch = mockFetch(
            definitionsResponse([flagDef('flag-a'), flagDef('flag-b'), flagDef('flag-c')])
        )
        const t = initConvexTest()
        await loadDefinitions(t)

        const result = await t.query(api.example.testGetAllFlags, {
            distinctId: 'user-123',
            flagKeys: ['flag-a', 'flag-b'],
        })

        expect(Object.keys(result.flags).sort()).toEqual(['flag-a', 'flag-b'])
    })
})

describe('getAllFlagsAndPayloads (local eval)', () => {
    beforeEach(() => {
        process.env.POSTHOG_PROJECT_TOKEN = 'phc_test_key'
        process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test_personal_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_PROJECT_TOKEN
        delete process.env.POSTHOG_PERSONAL_API_KEY
        delete process.env.POSTHOG_HOST
        fetchCalls = []
    })

    test('returns flag values and payloads', async () => {
        global.fetch = mockFetch(
            definitionsResponse([
                flagDef('flag-a', {
                    filters: {
                        groups: [{ properties: [], rollout_percentage: 100 }],
                        payloads: { true: JSON.stringify({ config: 'value' }) },
                    },
                }),
                flagDef('flag-b', {
                    filters: {
                        groups: [{ properties: [], rollout_percentage: 100, variant: 'variant' }],
                        multivariate: {
                            variants: [{ key: 'variant', rollout_percentage: 100 }],
                        },
                    },
                }),
            ])
        )
        const t = initConvexTest()
        await loadDefinitions(t)

        const result = await t.query(api.example.testGetAllFlagsAndPayloads, { distinctId: 'user-123' })

        expect(result.featureFlags).toEqual({ 'flag-a': true, 'flag-b': 'variant' })
        expect(result.featureFlagPayloads).toEqual({ 'flag-a': { config: 'value' } })
    })
})

describe('refreshFlagDefinitions cron action', () => {
    // The retry loop awaits `setTimeout`s — with the default jest fakeTimers config those never
    // fire and the action hangs. Switch to real timers for this block and cut the backoff down
    // to 1ms via the env override so the retry-heavy tests stay snappy.
    beforeEach(() => {
        jest.useRealTimers()
        process.env.POSTHOG_PROJECT_TOKEN = 'phc_test_key'
        process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test_personal_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
        process.env.POSTHOG_FLAGS_RETRY_DELAY_MS_OVERRIDE = '1'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_PROJECT_TOKEN
        delete process.env.POSTHOG_PERSONAL_API_KEY
        delete process.env.POSTHOG_HOST
        delete process.env.POSTHOG_FLAGS_RETRY_DELAY_MS_OVERRIDE
        fetchCalls = []
        jest.useFakeTimers()
    })

    // No credentials are passed to the action — they're env-driven (POSTHOG_PROJECT_TOKEN,
    // POSTHOG_HOST, POSTHOG_PERSONAL_API_KEY) and configured in beforeEach.
    const noArgs = {}

    /** Builds a fetch mock whose responses are picked per call from the supplied sequence. */
    function sequencedFetch(
        responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>
    ) {
        fetchCalls = []
        let i = 0
        // Statuses where the spec forbids a body (Response constructor throws on non-null body).
        const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304])
        return jest.fn(async (url: string | URL) => {
            fetchCalls.push({ url: url.toString(), body: undefined })
            const r = responses[Math.min(i, responses.length - 1)]
            i++
            const payload =
                NULL_BODY_STATUSES.has(r.status) || r.body === undefined
                    ? null
                    : typeof r.body === 'string'
                      ? r.body
                      : JSON.stringify(r.body)
            return new Response(payload, { status: r.status, headers: r.headers ?? {} })
        }) as unknown as typeof fetch
    }

    test('hits /flags/definitions with personal API key', async () => {
        global.fetch = mockFetch(definitionsResponse([flagDef('flag-a')]))
        const t = initConvexTest()

        await t.action(components.posthog.lib.refreshFlagDefinitions, noArgs)

        const definitionCalls = fetchCalls.filter((c) => c.url.includes('/flags/definitions'))
        expect(definitionCalls).toHaveLength(1)
        expect(definitionCalls[0].url).toContain('token=phc_test_key')
        expect(definitionCalls[0].url).toContain('send_cohorts')
    })

    test('no-ops when POSTHOG_PERSONAL_API_KEY env var is missing', async () => {
        // Clearing the env var simulates a deployment where local evaluation isn't configured —
        // the refresh action returns a skip status rather than fetching.
        delete process.env.POSTHOG_PERSONAL_API_KEY
        global.fetch = mockFetch()
        const t = initConvexTest()

        const result = (await t.action(components.posthog.lib.refreshFlagDefinitions, noArgs)) as { status: string }

        expect(result.status).toBe('skipped')
        expect(fetchCalls.filter((c) => c.url.includes('/flags/definitions'))).toHaveLength(0)
    })

    test('retries transient 5xx and persists on eventual 200', async () => {
        // First two calls flap as 502/503, third succeeds — definitions still land in the cache.
        const flag = flagDef('flag-a')
        global.fetch = sequencedFetch([
            { status: 502 },
            { status: 503 },
            {
                status: 200,
                body: { flags: [flag], group_type_mapping: {}, cohorts: {} },
                headers: { ETag: 'W/"fresh"' },
            },
        ])
        const t = initConvexTest()

        const result = (await t.action(components.posthog.lib.refreshFlagDefinitions, noArgs)) as {
            status: string
        }

        expect(result.status).toBe('updated')
        expect(fetchCalls.filter((c) => c.url.includes('/flags/definitions'))).toHaveLength(3)
    })

    test('503 cold-cache with no prior cache writes an empty snapshot', async () => {
        global.fetch = sequencedFetch([
            { status: 503, body: 'Required data not found in cache. This is likely a temporary issue.' },
        ])
        const t = initConvexTest()

        const result = (await t.action(components.posthog.lib.refreshFlagDefinitions, noArgs)) as {
            status: string
        }

        expect(result.status).toBe('empty')
        // Subsequent reads see the empty snapshot rather than null.
        const row = await t.query(components.posthog.lib.getFlagDefinitions, {})
        expect(row).not.toBeNull()
        expect(JSON.parse(row!.data)).toEqual({ flags: [], groupTypeMapping: {}, cohorts: {} })
    })

    test('503 cold-cache with a fresh prior cache keeps the existing snapshot', async () => {
        // Seed the cache with real defs.
        const t = initConvexTest()
        global.fetch = mockFetch(definitionsResponse([flagDef('seed')]))
        await t.action(components.posthog.lib.refreshFlagDefinitions, noArgs)

        // Now PostHog flaps cold-cache 503s. Cache is < 5min old so we keep what we have.
        global.fetch = sequencedFetch([
            { status: 503, body: 'Required data not found in cache.' },
        ])
        const result = (await t.action(components.posthog.lib.refreshFlagDefinitions, noArgs)) as {
            status: string
        }

        expect(result.status).toBe('stale')
        const row = await t.query(components.posthog.lib.getFlagDefinitions, {})
        expect(JSON.parse(row!.data).flags).toHaveLength(1)
    })

    test('503 cold-cache with a stale (>5min) prior cache replaces with empty', async () => {
        // Fake `Date.now` only — leave `setTimeout`/`setImmediate` real so the retry loop's
        // `await new Promise(r => setTimeout(r, …))` still resolves.
        jest.useFakeTimers({ doNotFake: ['setTimeout', 'setImmediate', 'queueMicrotask'] })
        try {
            const t = initConvexTest()
            global.fetch = mockFetch(definitionsResponse([flagDef('seed')]))
            await t.action(components.posthog.lib.refreshFlagDefinitions, noArgs)

            // Jump 6 minutes forward; the cached defs now count as stale.
            jest.setSystemTime(new Date(Date.now() + 6 * 60 * 1000))

            global.fetch = sequencedFetch([
                { status: 503, body: 'Required data not found in cache.' },
            ])
            const result = (await t.action(components.posthog.lib.refreshFlagDefinitions, noArgs)) as {
                status: string
            }

            expect(result.status).toBe('empty')
            const row = await t.query(components.posthog.lib.getFlagDefinitions, {})
            expect(JSON.parse(row!.data).flags).toHaveLength(0)
        } finally {
            jest.useRealTimers()
        }
    })

    test('304 not-modified leaves the existing snapshot in place', async () => {
        // Seed.
        const t = initConvexTest()
        global.fetch = mockFetch({
            '/flags/definitions': { flags: [flagDef('seed')], group_type_mapping: {}, cohorts: {} },
        })
        await t.action(components.posthog.lib.refreshFlagDefinitions, noArgs)

        // Now PostHog returns 304 — no body, just the not-modified status.
        global.fetch = sequencedFetch([{ status: 304 }])
        const result = (await t.action(components.posthog.lib.refreshFlagDefinitions, noArgs)) as {
            status: string
        }

        expect(result.status).toBe('unchanged')
        const row = await t.query(components.posthog.lib.getFlagDefinitions, {})
        expect(JSON.parse(row!.data).flags).toHaveLength(1)
    })
})

describe('getFlagDefinitions query', () => {
    // The query exposes a `localEvalConfigured` flag based on whether the component sees
    // `POSTHOG_PERSONAL_API_KEY` in its env. The client uses this to distinguish "not configured"
    // (throw) from "configured but not warmed up" (undefined). These tests guard the query
    // surface that promise rests on.
    beforeEach(() => {
        process.env.POSTHOG_PROJECT_TOKEN = 'phc_test_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        delete process.env.POSTHOG_PROJECT_TOKEN
        delete process.env.POSTHOG_PERSONAL_API_KEY
        delete process.env.POSTHOG_HOST
    })

    test('reports localEvalConfigured=false when POSTHOG_PERSONAL_API_KEY is unset', async () => {
        const t = initConvexTest()
        const row = await t.query(components.posthog.lib.getFlagDefinitions, {})
        expect(row.localEvalConfigured).toBe(false)
        expect(row.data).toBeNull()
        expect(row.fetchedAt).toBeNull()
    })

    test('reports localEvalConfigured=true when POSTHOG_PERSONAL_API_KEY is set', async () => {
        process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test'
        const t = initConvexTest()
        const row = await t.query(components.posthog.lib.getFlagDefinitions, {})
        expect(row.localEvalConfigured).toBe(true)
        expect(row.data).toBeNull()
    })
})

// --- Remote feature flag evaluation tests ---
//
// These hit posthog-node's `evaluateFlags` under the hood, which posts to PostHog's `/flags`
// endpoint with the user's distinctId + properties. Mocked at the fetch level.

function flagsResponse(featureFlags: Record<string, unknown>, featureFlagPayloads: Record<string, unknown> = {}) {
    return {
        '/flags': {
            featureFlags,
            featureFlagPayloads,
            requestId: 'test-request-id',
        },
    }
}

describe('evaluateFlag (remote)', () => {
    beforeEach(() => {
        process.env.POSTHOG_PROJECT_TOKEN = 'phc_test_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_PROJECT_TOKEN
        delete process.env.POSTHOG_HOST
        fetchCalls = []
    })

    test('returns the flag value from /flags', async () => {
        global.fetch = mockFetch(flagsResponse({ 'test-flag': 'variant-a' }))
        const t = initConvexTest()

        const value = await t.action(components.posthog.lib.evaluateFlag, {
            key: 'test-flag',
            distinctId: 'user-123',
        })

        expect(value).toBe('variant-a')
        const flagsCalls = fetchCalls.filter((c) => c.url.includes('/flags'))
        expect(flagsCalls.length).toBeGreaterThanOrEqual(1)
    })

    test('returns null for missing flags', async () => {
        global.fetch = mockFetch(flagsResponse({}))
        const t = initConvexTest()

        const value = await t.action(components.posthog.lib.evaluateFlag, {
            key: 'missing',
            distinctId: 'user-123',
        })

        expect(value).toBeNull()
    })

    test('forwards person and group properties', async () => {
        global.fetch = mockFetch(flagsResponse({ 'test-flag': true }))
        const t = initConvexTest()

        await t.action(components.posthog.lib.evaluateFlag, {
            key: 'test-flag',
            distinctId: 'user-123',
            groups: { company: 'acme' },
            personProperties: { email: 'test@example.com' },
            groupProperties: { company: { industry: 'tech' } },
        })

        const flagsCalls = fetchCalls.filter((c) => c.url.includes('/flags'))
        const body = flagsCalls[0].body as Record<string, unknown>
        expect(body.distinct_id).toBe('user-123')
        expect(body.groups).toEqual({ company: 'acme' })
        expect(body.person_properties).toMatchObject({ email: 'test@example.com' })
        expect(body.group_properties).toMatchObject({ company: { industry: 'tech' } })
    })
})

describe('evaluateFlagPayload (remote)', () => {
    beforeEach(() => {
        process.env.POSTHOG_PROJECT_TOKEN = 'phc_test_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_PROJECT_TOKEN
        delete process.env.POSTHOG_HOST
        fetchCalls = []
    })

    test('returns the payload from /flags', async () => {
        global.fetch = mockFetch(flagsResponse({ 'test-flag': true }, { 'test-flag': { config: 'value' } }))
        const t = initConvexTest()

        const payload = await t.action(components.posthog.lib.evaluateFlagPayload, {
            key: 'test-flag',
            distinctId: 'user-123',
        })

        expect(payload).toEqual({ config: 'value' })
    })

    test('returns null when no payload is configured', async () => {
        global.fetch = mockFetch(flagsResponse({ 'test-flag': true }))
        const t = initConvexTest()

        const payload = await t.action(components.posthog.lib.evaluateFlagPayload, {
            key: 'test-flag',
            distinctId: 'user-123',
        })

        expect(payload).toBeNull()
    })
})

describe('evaluateAllFlags (remote)', () => {
    beforeEach(() => {
        process.env.POSTHOG_PROJECT_TOKEN = 'phc_test_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_PROJECT_TOKEN
        delete process.env.POSTHOG_HOST
        fetchCalls = []
    })

    test('returns all flags and payloads', async () => {
        global.fetch = mockFetch(
            flagsResponse(
                { 'flag-a': true, 'flag-b': 'variant', 'flag-c': false },
                { 'flag-a': { config: 'value' } }
            )
        )
        const t = initConvexTest()

        const result = (await t.action(components.posthog.lib.evaluateAllFlags, {
            distinctId: 'user-123',
        })) as { featureFlags: Record<string, unknown>; featureFlagPayloads: Record<string, unknown> }

        expect(result.featureFlags).toEqual({
            'flag-a': true,
            'flag-b': 'variant',
            'flag-c': false,
        })
        expect(result.featureFlagPayloads).toEqual({ 'flag-a': { config: 'value' } })
    })
})
