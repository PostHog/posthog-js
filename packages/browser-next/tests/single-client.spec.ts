import type { Extension } from '@posthog/browser-common'
import { createPostHog as createDefault } from '../src/composition/npm/core'
import { createPostHog as createLite } from '../src/composition/npm/lite'
import { group, groupIdentify, resetGroups } from '../src/products/analytics/groups'
import { alias, setPersonProperties, unsetPersonProperties } from '../src/products/analytics/person'
import type { BrowserFetch, CorePostHogOptions, IPostHog, StorageLike } from '../src/core/types'

class MemoryStorage implements StorageLike {
    readonly values = new Map<string, string>()
    getItem(key: string): string | null {
        return this.values.get(key) ?? null
    }
    setItem(key: string, value: string): void {
        this.values.set(key, value)
    }
    removeItem(key: string): void {
        this.values.delete(key)
    }
}

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
    remoteConfig: {
        supportedCompression: [],
        toolbarParams: {},
        toolbarVersion: 'toolbar',
        isAuthenticated: false,
        siteApps: [],
    },
    analytics: { flushAt: 100, flushInterval: 0 },
})

describe.each([
    ['default', createDefault],
    ['lite', createLite],
] as const)('single client (%s delivery)', (_name, create) => {
    let sent: Sent[]
    let posthog: IPostHog

    beforeEach(async () => {
        sent = []
        posthog = await create(options(capture(sent)))
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
        posthog = await create({ ...options(capture(sent)), extensions: [shared] })
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
        group(posthog, 'company', 'acme', { name: 'Acme' })
        groupIdentify(posthog, 'company', 'other', { plan: 'paid' })
        setPersonProperties(posthog, { plan: 'paid' })
        unsetPersonProperties(posthog, 'legacy')
        alias(posthog, 'alias-1')
        posthog.capture('after_group')
        resetGroups(posthog)
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

describe('lite delivery', () => {
    it('hands queued events to a keepalive request on page hide', async () => {
        const target = new EventTarget()
        vi.stubGlobal('addEventListener', target.addEventListener.bind(target))
        vi.stubGlobal('removeEventListener', target.removeEventListener.bind(target))
        try {
            const sent: Sent[] = []
            const posthog = await createLite(options(capture(sent)))
            posthog.capture('before_hide')
            target.dispatchEvent(new Event('pagehide'))
            await Promise.resolve()
            expect(sent).toHaveLength(1)
            expect(sent[0]?.keepalive).toBe(true)
            expect(sent[0]?.batch[0]?.event).toBe('before_hide')
            await posthog.shutdown()
        } finally {
            vi.unstubAllGlobals()
        }
    })

    it('reports immediate capture as unavailable without admitting the event', async () => {
        const posthog = await createLite(options(capture([])))
        const observed: string[] = []
        posthog.onEvent(({ event }) => observed.push(event))
        const summary = await posthog.captureImmediate('now')
        expect(summary.allPersisted).toBe(false)
        expect(summary.error?.message).toBe('Immediate analytics delivery is unavailable')
        expect(observed).toEqual([])
        await posthog.shutdown()
    })

    it('sends a count-triggered batch after the capture commits', async () => {
        const sent: Sent[] = []
        const posthog = await createLite({ ...options(capture(sent)), analytics: { flushAt: 1, flushInterval: 0 } })
        posthog.capture('first')
        expect(sent).toHaveLength(0)
        await Promise.resolve()
        expect(events(sent).map((event) => event.event)).toEqual(['first'])
        await posthog.shutdown()
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
