/// <reference types="vite/client" />
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { initConvexTest } from './setup.test.js'
import { api, components } from './_generated/api.js'

// CI can be slow with ESM + convex-test startup; default 5s is occasionally too tight.
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

describe('capture', () => {
    beforeEach(() => {
        process.env.POSTHOG_API_KEY = 'phc_test_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_API_KEY
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
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

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
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

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
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

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
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

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
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

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
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

        const event = firstBatchEvent()
        expect(event.timestamp).toContain('2024-06-15')
    })
})

describe('identify', () => {
    beforeEach(() => {
        process.env.POSTHOG_API_KEY = 'phc_test_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_API_KEY
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
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

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
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

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
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

        const props = firstBatchEvent().properties as Record<string, unknown>
        expect(props.$geoip_disable).toBe(true)
    })
})

describe('groupIdentify', () => {
    beforeEach(() => {
        process.env.POSTHOG_API_KEY = 'phc_test_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_API_KEY
        delete process.env.POSTHOG_HOST
        fetchCalls = []
    })

    test('sends $groupidentify event with group type and key', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        const result = await t.mutation(api.example.testGroupIdentify, {
            groupType: 'company',
            groupKey: 'acme',
        })
        expect(result).toEqual({ success: true })
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

        expect(batchCalls().length).toBeGreaterThanOrEqual(1)
        const event = firstBatchEvent()
        expect(event.event).toBe('$groupidentify')
        const props = event.properties as Record<string, unknown>
        expect(props.$group_type).toBe('company')
        expect(props.$group_key).toBe('acme')
    })

    test('sends group properties via $group_set', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        await t.mutation(api.example.testGroupIdentify, {
            groupType: 'company',
            groupKey: 'acme',
            properties: { industry: 'Technology', size: 100 },
        })
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

        const props = firstBatchEvent().properties as Record<string, unknown>
        const groupSet = props.$group_set as Record<string, unknown>
        expect(groupSet.industry).toBe('Technology')
        expect(groupSet.size).toBe(100)
    })

    test('uses distinctId override when provided', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        await t.mutation(api.example.testGroupIdentify, {
            groupType: 'company',
            groupKey: 'acme',
            distinctId: 'override-user',
        })
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

        expect(firstBatchEvent().distinct_id).toBe('override-user')
    })
})

describe('alias', () => {
    beforeEach(() => {
        process.env.POSTHOG_API_KEY = 'phc_test_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_API_KEY
        delete process.env.POSTHOG_HOST
        fetchCalls = []
    })

    test('sends $create_alias event', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        const result = await t.mutation(api.example.testAlias, {
            distinctId: 'user-123',
            alias: 'anon-456',
        })
        expect(result).toEqual({ success: true })
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

        expect(batchCalls().length).toBeGreaterThanOrEqual(1)
        const event = firstBatchEvent()
        expect(event.event).toBe('$create_alias')
        const props = event.properties as Record<string, unknown>
        expect(props.distinct_id).toBe('user-123')
        expect(props.alias).toBe('anon-456')
    })

    test('sends disableGeoip', async () => {
        global.fetch = mockFetch()
        const t = initConvexTest()

        await t.mutation(api.example.testAlias, {
            distinctId: 'user-123',
            alias: 'anon-456',
            disableGeoip: true,
        })
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

        const props = firstBatchEvent().properties as Record<string, unknown>
        expect(props.$geoip_disable).toBe(true)
    })
})

describe('captureException', () => {
    beforeEach(() => {
        process.env.POSTHOG_API_KEY = 'phc_test_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_API_KEY
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
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

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
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

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
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

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
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

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
        jest.runAllTimers()
        await t.finishInProgressScheduledFunctions()

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
    await t.action(components.posthog.lib.refreshFlagDefinitions, {})
}

describe('getFeatureFlag (local eval)', () => {
    beforeEach(() => {
        process.env.POSTHOG_API_KEY = 'phc_test_key'
        process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test_personal_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_API_KEY
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
        process.env.POSTHOG_API_KEY = 'phc_test_key'
        process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test_personal_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_API_KEY
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
        process.env.POSTHOG_API_KEY = 'phc_test_key'
        process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test_personal_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_API_KEY
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
        process.env.POSTHOG_API_KEY = 'phc_test_key'
        process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test_personal_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_API_KEY
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
        process.env.POSTHOG_API_KEY = 'phc_test_key'
        process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test_personal_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_API_KEY
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
        process.env.POSTHOG_API_KEY = 'phc_test_key'
        process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test_personal_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_API_KEY
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
    beforeEach(() => {
        process.env.POSTHOG_API_KEY = 'phc_test_key'
        process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test_personal_key'
        process.env.POSTHOG_HOST = 'https://test.posthog.com'
    })

    afterEach(() => {
        global.fetch = originalFetch
        delete process.env.POSTHOG_API_KEY
        delete process.env.POSTHOG_PERSONAL_API_KEY
        delete process.env.POSTHOG_HOST
        fetchCalls = []
    })

    test('hits /flags/definitions with personal API key', async () => {
        global.fetch = mockFetch(definitionsResponse([flagDef('flag-a')]))
        const t = initConvexTest()

        await t.action(components.posthog.lib.refreshFlagDefinitions, {})

        const definitionCalls = fetchCalls.filter((c) => c.url.includes('/flags/definitions'))
        expect(definitionCalls).toHaveLength(1)
        expect(definitionCalls[0].url).toContain('token=phc_test_key')
        expect(definitionCalls[0].url).toContain('send_cohorts')
    })

    test('no-ops when POSTHOG_PERSONAL_API_KEY is missing', async () => {
        delete process.env.POSTHOG_PERSONAL_API_KEY
        global.fetch = mockFetch()
        const t = initConvexTest()

        const result = (await t.action(components.posthog.lib.refreshFlagDefinitions, {})) as { status: string }

        expect(result.status).toBe('skipped')
        expect(fetchCalls.filter((c) => c.url.includes('/flags/definitions'))).toHaveLength(0)
    })
})
