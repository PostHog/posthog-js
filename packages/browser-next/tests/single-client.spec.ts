import type { Extension } from '@posthog/browser-common'
import { createPostHog as createDefault } from '../src/composition/npm/core'
import type { BrowserFetch, CorePostHogOptions, IPostHog } from '../src/core/types'
import { localRemoteConfig, MemoryStorage } from './helpers'

interface CapturedEvent {
    event: string
    distinct_id: string
    properties: Record<string, unknown>
}

interface Sent {
    url: string
    keepalive: boolean | undefined
    batch: CapturedEvent[]
}

const capture = (sent: Sent[]): BrowserFetch => {
    return async (input, init = {}) => {
        const url = String(input)
        if (url.includes('/i/v1/analytics/events')) {
            const body = JSON.parse(String(init.body)) as { batch: CapturedEvent[] }
            sent.push({ url, keepalive: init.keepalive, batch: body.batch })
            const results = Object.fromEntries(
                body.batch.map((event) => [(event as unknown as { uuid: string }).uuid, { result: 'ok' }])
            )
            return new Response(JSON.stringify({ results }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        }
        return new Response('{}', { status: 404 })
    }
}

const events = (sent: Sent[]): CapturedEvent[] => sent.flatMap((request) => request.batch)

const options = (fetch: BrowserFetch): CorePostHogOptions => ({
    projectToken: 'ph_test',
    capturePageview: false,
    storage: new MemoryStorage(),
    navigator: false,
    fetch,
    remoteConfig: localRemoteConfig,
    analytics: { flushAt: 100, flushInterval: 0 },
})

describe('single client', () => {
    let sent: Sent[]
    let posthog: IPostHog

    beforeEach(async () => {
        sent = []
        posthog = await createDefault(options(capture(sent)))
    })

    afterEach(async () => {
        await posthog.shutdown()
    })

    it('captures and delivers through Capture V1', async () => {
        posthog.register({ plan: 'pro' })
        expect(posthog.capture('signed_up', { source: 'test' })).toBe(true)
        await posthog.flush()
        const [event] = events(sent)
        expect(event).toMatchObject({ event: 'signed_up', properties: { plan: 'pro', source: 'test' } })
        expect(event?.distinct_id).toBe(posthog.distinctId)
    })

    it('hands the client itself to shared and browser extensions', async () => {
        let host: unknown
        const shared: Extension = {
            name: 'shared-test',
            setup(client) {
                host = client
                client.capture('from_extension')
            },
        }
        await posthog.shutdown()
        posthog = await createDefault({ ...options(capture(sent)), extensions: [shared] })
        expect(host).toBe(posthog)
        expect(posthog.getExtension('shared-test')).toBe(shared)
        await posthog.flush()
        expect(events(sent).map((event) => event.event)).toContain('from_extension')
    })

    it('identifies and notifies identity listeners', async () => {
        const identified: string[] = []
        posthog.onIdentify(({ distinctId }) => identified.push(distinctId))
        const anonymousId = posthog.distinctId
        posthog.identify('user-1', { email: 'a@example.com' })
        await posthog.flush()
        expect(identified).toEqual(['user-1'])
        expect(events(sent)[0]).toMatchObject({
            event: '$identify',
            distinct_id: 'user-1',
            properties: { $anon_distinct_id: anonymousId },
        })
    })

    it('keeps groups and person helpers outside the client', async () => {
        posthog.identify('user-1')
        posthog.group('company', 'acme', { name: 'Acme' })
        posthog.groupIdentify('company', 'other', { plan: 'paid' })
        posthog.setPersonProperties({ plan: 'paid' })
        posthog.unsetPersonProperties('legacy')
        posthog.alias('alias-1')
        posthog.capture('after_group')
        posthog.resetGroups()
        posthog.capture('after_reset')
        await posthog.flush()
        const byName = (name: string) => events(sent).filter((event) => event.event === name)
        expect(byName('$groupidentify')).toHaveLength(2)
        expect(byName('$create_alias')[0]?.properties).toMatchObject({ alias: 'alias-1' })
        expect(byName('$set').map((event) => event.properties)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ $set: { plan: 'paid' } }),
                expect.objectContaining({ $unset: ['legacy'] }),
            ])
        )
        expect(byName('after_group')[0]?.properties.$groups).toEqual({ company: 'acme' })
        expect(byName('after_reset')[0]?.properties.$groups).toEqual({})
        expect(posthog.groups).toEqual({})
    })

    it('sends nothing after opt-out', async () => {
        posthog.optOut()
        posthog.capture('blocked')
        await posthog.flush()
        expect(sent).toHaveLength(0)
    })
})

describe('default delivery', () => {
    it('reports immediate capture outcomes', async () => {
        const sent: Sent[] = []
        const posthog = await createDefault(options(capture(sent)))
        const summary = await posthog.captureImmediate('now')
        expect(summary).toMatchObject({ submitted: 1, allPersisted: true })
        await posthog.shutdown()
    })
})

describe('extension lifecycle', () => {
    it('does not reinstall an extension instance disposed after a failed setup', async () => {
        let setups = 0
        const failing: Extension = {
            name: 'failing',
            setup() {
                setups++
                throw new Error('setup failed')
            },
        }
        const posthog = await createDefault({ ...options(capture([])), extensions: [failing] })
        expect(await posthog.resolveExtension('failing')).toBeUndefined()
        expect(setups).toBe(1)
        await posthog.shutdown()
    })
})
