import { createPostHog } from '../src/composition/npm'
import type { IPostHog, PostHogOptions } from '../src/core/types'
import { localRemoteConfig, requireInstalledExtension } from './helpers'

const options = {
    projectToken: 'ph_root_delivery',
    storage: false,
    navigator: false,
    capturePageview: false,
    flags: false,
    logs: false,
    surveys: false,
    autocapture: false,
    analytics: { flushAt: 100, flushInterval: 0 },
    remoteConfig: localRemoteConfig,
} satisfies PostHogOptions

const clients: IPostHog[] = []
const create = async (settings: Partial<PostHogOptions> = {}) => {
    const batches: Array<Array<Record<string, unknown>>> = []
    const urls: string[] = []
    const client = await createPostHog({
        ...options,
        fetch: async (input, init) => {
            urls.push(String(input))
            const { batch } = JSON.parse(String(init?.body)) as { batch: Array<Record<string, unknown>> }
            batches.push(batch)
            return new Response(
                JSON.stringify({
                    results: Object.fromEntries(batch.map(({ uuid }) => [String(uuid), { result: 'ok' }])),
                })
            )
        },
        ...settings,
    })
    clients.push(client)
    return { client, batches, urls }
}

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.shutdown(0)))
})

it.each([false, true])('sends nothing after flags dependency startup without captures (denied: %s)', async (denied) => {
    const { client, batches } = await create({ flags: { featureFlagEvaluation: false }, optOutByDefault: denied })
    expect(client.featureFlags).toBeDefined()
    await client.flush()
    await client.shutdown()
    expect(client.session).toBeUndefined()
    expect(batches).toEqual([])
})

it('sends nothing for rejected captures', async () => {
    const { client, batches } = await create()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    client.capture('invalid', circular)
    client.capture('')
    client.optOut()
    client.capture('denied')
    await client.flush()
    expect(client.session).toBeUndefined()
    expect(batches).toEqual([])
})

it('delivers finalized admission snapshots through Capture V1', async () => {
    const { client, batches, urls } = await create()
    const observed: string[] = []
    client.onEvent(({ event }) => observed.push(event))
    const properties = { phase: 'admitted' }
    const timestamp = new Date('2026-01-01T00:00:00.000Z')
    const originalId = client.distinctId
    expect(client.capture('first', properties, { uuid: 'first-uuid', timestamp })).toBe(true)
    const session = requireInstalledExtension(client.session)
    client.capture('second')
    expect(observed).toEqual(['first', 'second'])
    properties.phase = 'mutated'
    timestamp.setUTCFullYear(2030)
    client.identify('later-identity')
    expect(batches).toEqual([])
    await client.flush()
    expect(urls).toEqual(['https://us.i.posthog.com/i/v1/analytics/events'])
    expect(batches.flat().map(({ event }) => event)).toEqual(['first', 'second', '$identify'])
    expect(batches[0]?.[0]).toMatchObject({
        event: 'first',
        uuid: 'first-uuid',
        timestamp: '2026-01-01T00:00:00.000Z',
        distinct_id: originalId,
        session_id: session.sessionId,
        properties: { phase: 'admitted' },
    })
})

it('reports immediate capture outcomes', async () => {
    const { client, batches } = await create()
    const summary = await client.captureImmediate('now', null, { uuid: 'now-uuid' })
    expect(summary).toMatchObject({ submitted: 1, notPersisted: 0, allPersisted: true, results: { 'now-uuid': {} } })
    expect(batches.flat().map(({ event }) => event)).toEqual(['now'])
})

it('purges queued work on opt-out without reviving it after opt-in', async () => {
    const { client, batches } = await create()
    client.capture('purged')
    client.optOut()
    client.optIn()
    client.capture('after-grant')
    await client.flush()
    expect(batches.flat().map(({ event }) => event)).toEqual(['after-grant'])
})

it('drains admitted events during shutdown and rejects captures after closing starts', async () => {
    const { client, batches } = await create()
    client.capture('shutdown-pending')
    const closing = client.shutdown(1_000)
    client.capture('after-closing')
    await closing
    expect(batches.flat().map(({ event }) => event)).toEqual(['shutdown-pending'])
})
