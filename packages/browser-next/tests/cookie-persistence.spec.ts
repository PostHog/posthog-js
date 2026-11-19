import { cookiePersistence, type CookiePersistenceOptions } from '../src/persistence/cookie'
import type { IPostHog } from '../src/core/types'
import { createClient, MemoryStorage, STATE_KEY, storedState, uuidv7, type SentEvent } from './identity-fixtures'

const COOKIE = 'ph_ph_test_posthog'

const currentHost = (): string => (globalThis.location as Location | undefined)?.hostname ?? ''

/**
 * A cookie jar for one site. Cookies are keyed by name and scope: a domain cookie is visible on every subdomain and a
 * host-only cookie only on its host. As in browsers, `cookie` lists older cookies first, and cookies for the listed
 * public suffixes are rejected.
 */
class CookieJar {
    private readonly _cookies = new Map<string, { name: string; scope: string; value: string }>()
    readonly writes: string[] = []
    constructor(private readonly _publicSuffixes: readonly string[] = ['com']) {}

    private _visible(): Array<{ name: string; scope: string; value: string }> {
        return Array.from(this._cookies.values()).filter(
            ({ scope }) => scope.startsWith('.') || scope === currentHost()
        )
    }

    get cookie(): string {
        return this._visible()
            .map(({ name, value }) => `${name}=${value}`)
            .join('; ')
    }

    set cookie(raw: string) {
        this.writes.push(raw)
        const [pair = '', ...parts] = raw.split(';')
        const separator = pair.indexOf('=')
        const name = pair.slice(0, separator).trim()
        const attributes = new Map(
            parts.map((part) => {
                const [key = '', ...value] = part.trim().split('=')
                return [key.toLowerCase(), value.join('=')] as const
            })
        )
        const domain = attributes.get('domain')?.replace(/^\./, '')
        if (domain !== undefined && this._publicSuffixes.includes(domain)) return
        const scope = domain === undefined ? currentHost() : `.${domain}`
        const key = `${scope}|${name}`
        const expires = attributes.get('expires')
        if (attributes.get('max-age') === '0' || (expires && new Date(expires).getTime() < Date.now())) {
            this._cookies.delete(key)
        } else {
            // Replacing a cookie keeps its position, as browsers keep its creation time.
            this._cookies.set(key, { name, scope, value: pair.slice(separator + 1) })
        }
    }

    /** The cookie the page reads first, or the cookie at `scope`. */
    read(name = COOKIE, scope?: string): Record<string, any> | undefined {
        const cookie = this._visible().find(
            (entry) => entry.name === name && (scope === undefined || entry.scope === scope)
        )
        return cookie === undefined ? undefined : JSON.parse(decodeURIComponent(cookie.value))
    }

    /** Stores a cookie as posthog-js would: shared by the site by default, or host-only for a host name. */
    write(value: Record<string, unknown>, scope = '.example.com', name = COOKIE): void {
        this._cookies.set(`${scope}|${name}`, { name, scope, value: encodeURIComponent(JSON.stringify(value)) })
    }

    lastWrite(name = COOKIE): string | undefined {
        return this.writes.filter((write) => write.startsWith(`${name}=`)).at(-1)
    }
}

const clients: IPostHog[] = []
let jar: CookieJar

const visit = (hostname: string, protocol = 'https:'): void => {
    vi.stubGlobal('location', { hostname, protocol })
}

const create = async (
    storage: MemoryStorage | false,
    sent: SentEvent[] = [],
    options: CookiePersistenceOptions = {},
    bootstrap?: Parameters<typeof createClient>[2]
): Promise<IPostHog> => {
    const client = await createClient(storage, sent, { cookie: cookiePersistence(options), ...bootstrap })
    clients.push(client)
    return client
}

beforeEach(() => {
    jar = new CookieJar()
    vi.stubGlobal('document', jar)
    visit('app.example.com')
})

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.shutdown()))
    vi.unstubAllGlobals()
})

describe('cookie persistence', () => {
    it('writes identity and session state with posthog-js cookie keys', async () => {
        const posthog = await create(new MemoryStorage())
        posthog.identify('user-1')
        posthog.capture('event')
        const session = posthog.session!
        expect(jar.read()).toEqual({
            distinct_id: 'user-1',
            $device_id: posthog.deviceId,
            $user_state: 'identified',
            // Activity is persisted at most once a minute, so only identity and start are exact.
            $sesid: [expect.any(Number), session.sessionId, session.sessionStartTimestamp, expect.any(String)],
            $epp: true,
        })
    })

    it('scopes the cookie to the site with secure attributes', async () => {
        await create(new MemoryStorage())
        expect(jar.lastWrite()).toMatch(/; expires=[^;]+; SameSite=Lax; path=\/; domain=\.example\.com; secure$/)
    })

    it('skips public suffixes when choosing the site domain', async () => {
        jar = new CookieJar(['uk', 'co.uk'])
        vi.stubGlobal('document', jar)
        visit('www.example.co.uk')
        await create(new MemoryStorage())
        expect(jar.lastWrite()).toContain('; domain=.example.co.uk')
    })

    it.each([
        ['the option disables it', 'app.example.com', { crossSubdomain: false }],
        ['the site is on shared hosting', 'app.herokuapp.com', {}],
        ['the host is local', 'localhost', {}],
    ] as const)('keeps the cookie on the current host when %s', async (_case, hostname, options) => {
        visit(hostname, 'http:')
        await create(new MemoryStorage(), [], options)
        expect(jar.lastWrite()).not.toContain('domain=')
        expect(jar.lastWrite()).not.toContain('secure')
    })

    it('uses a custom cookie name and lifetime', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
        try {
            await create(new MemoryStorage(), [], { name: 'custom', expirationDays: 1 })
            expect(jar.lastWrite('custom')).toContain('expires=Fri, 02 Jan 2026 00:00:00 GMT')
            expect(jar.read()).toBeUndefined()
        } finally {
            vi.useRealTimers()
        }
    })

    it('shares identity and session with another subdomain', async () => {
        const app = await create(new MemoryStorage())
        app.identify('user-1')
        app.capture('on_app')
        const { sessionId } = app.session!

        visit('www.example.com')
        const sent: SentEvent[] = []
        const www = await create(new MemoryStorage(), sent)
        www.capture('on_www')
        await www.flush()
        expect(www.distinctId).toBe('user-1')
        expect(www.deviceId).toBe(app.deviceId)
        expect(sent[0]).toMatchObject({ distinct_id: 'user-1', session_id: sessionId })
    })

    it('continues a posthog-js cookie identity and session', async () => {
        const start = Date.now() - 60_000
        jar.write({
            distinct_id: 'legacy-user',
            $device_id: 'legacy-device',
            $user_state: 'identified',
            $sesid: [Date.now() - 1_000, 'legacy-session', start],
            $initial_person_info: { r: '$direct' },
        })
        const sent: SentEvent[] = []
        const storage = new MemoryStorage()
        const posthog = await create(storage, sent)
        posthog.capture('event')
        await posthog.flush()
        expect(sent[0]).toMatchObject({
            distinct_id: 'legacy-user',
            session_id: 'legacy-session',
            properties: { $device_id: 'legacy-device' },
        })
        expect(storedState(storage)).toMatchObject({ distinctId: 'legacy-user', isIdentified: true })
        expect(jar.read()).toMatchObject({ $initial_person_info: { r: '$direct' } })
    })

    it('prefers the cookie identity and drops caches that belonged to the local user', async () => {
        const storage = new MemoryStorage()
        const local = await create(storage)
        local.register({ plan: 'pro' })
        local.kv.set('$enabled_feature_flags', { beta: true })
        await local.shutdown()
        jar.write({ distinct_id: 'user-2', $device_id: 'device-2', $user_state: 'identified' })

        const posthog = await create(storage)
        expect(posthog.distinctId).toBe('user-2')
        expect(posthog.getProperty('plan')).toBe('pro')
        expect(posthog.kv.get('$enabled_feature_flags')).toBeUndefined()
    })

    it('carries a reset to another subdomain', async () => {
        const wwwStorage = new MemoryStorage()
        const www = await create(wwwStorage)
        www.identify('user-1')
        www.capture('before_reset')
        const { sessionId } = www.session!
        await www.shutdown()

        const app = await create(new MemoryStorage())
        app.reset()
        const sent: SentEvent[] = []
        const reopened = await create(wwwStorage, sent)
        reopened.capture('after_reset')
        await reopened.flush()
        expect(reopened.distinctId).toBe(app.distinctId)
        expect(sent[0]?.session_id).not.toBe(sessionId)
        expect(storedState(wwwStorage).isIdentified).toBe(false)
    })

    it('sends the identity and session another subdomain reset to from an open tab', async () => {
        const app = await create(new MemoryStorage())
        app.capture('baseline')
        visit('www.example.com')
        const sent: SentEvent[] = []
        const www = await create(new MemoryStorage(), sent)
        expect(www.distinctId).toBe(app.distinctId)

        visit('app.example.com')
        app.reset(true)
        app.capture('after_reset')

        visit('www.example.com')
        www.capture('continuation')
        await www.flush()
        expect(sent.find((event) => event.event === 'continuation')).toMatchObject({
            distinct_id: app.distinctId,
            session_id: app.session!.sessionId,
            properties: { $device_id: app.deviceId },
        })
    })

    it('notifies listeners when an open tab adopts another subdomain identity', async () => {
        const app = await create(new MemoryStorage())
        const anonymousId = app.distinctId
        visit('www.example.com')
        const www = await create(new MemoryStorage())
        const changes: unknown[] = []
        www.onIdentify(({ distinctId, previousDistinctId, wasIdentified }) =>
            changes.push({ distinctId, previousDistinctId, wasIdentified })
        )
        www.onReset(() => changes.push('reset'))

        visit('app.example.com')
        app.identify('user-1')
        visit('www.example.com')
        www.capture('after_identify')
        visit('app.example.com')
        app.reset()
        visit('www.example.com')
        www.capture('after_reset')

        expect(changes).toEqual([
            { distinctId: 'user-1', previousDistinctId: anonymousId, wasIdentified: false },
            'reset',
        ])
    })

    it('keeps the newest session when a stale subdomain writes', async () => {
        const app = await create(new MemoryStorage())
        app.capture('on_app')
        visit('www.example.com')
        const www = await create(new MemoryStorage())
        www.capture('on_www')
        expect(www.session?.sessionId).toBe(app.session?.sessionId)

        app.reset()
        app.capture('after_reset')
        const rotated = app.session!.sessionId
        www.kv.set('stale', true)
        expect(jar.read()?.$sesid[1]).toBe(rotated)
        www.capture('adopt')
        expect(www.session?.sessionId).toBe(rotated)
    })

    it('continues a session that posthog-js keeps active on another subdomain', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
            const now = Date.now()
            const start = now - 60_000
            const sessionId = uuidv7(start)
            const sent: SentEvent[] = []
            const app = await create(new MemoryStorage(), sent, {}, { bootstrap: { sessionId } })
            app.capture('first')
            expect(app.session?.sessionId).toBe(sessionId)

            // posthog-js records activity as [lastActivityTimestamp, sessionId, sessionStartTimestamp].
            vi.setSystemTime(now + 25 * 60_000)
            jar.write({ ...jar.read(), $sesid: [Date.now(), sessionId, start] })

            vi.setSystemTime(now + 31 * 60_000)
            app.capture('continuation')
            await app.flush()

            expect(sent.find((event) => event.event === 'continuation')?.session_id).toBe(sessionId)
            expect(jar.read()?.$sesid[1]).toBe(sessionId)
        } finally {
            vi.useRealTimers()
        }
    })

    it('shares person processing with another subdomain', async () => {
        jar.write({ distinct_id: 'anon-1', $device_id: 'anon-1', $user_state: 'anonymous', $epp: true })
        const sent: SentEvent[] = []
        const posthog = await create(new MemoryStorage(), sent)
        posthog.capture('event')
        await posthog.flush()
        expect(sent[0]).toMatchObject({ options: { process_person_profile: true } })
    })

    it('replaces a host-only posthog-js cookie with the shared one', async () => {
        jar.write({ distinct_id: 'legacy', $device_id: 'legacy', $user_state: 'anonymous' }, 'app.example.com')
        const storage = new MemoryStorage()
        const posthog = await create(storage)
        expect(posthog.distinctId).toBe('legacy')
        posthog.identify('user-1')
        await posthog.shutdown()

        expect(jar.read(COOKIE, 'app.example.com')).toBeUndefined()
        expect((await create(storage)).distinctId).toBe('user-1')
    })

    it('replaces a shared cookie with a host-only one when subdomains are not shared', async () => {
        jar.write({ distinct_id: 'legacy', $device_id: 'legacy', $user_state: 'anonymous' })
        const storage = new MemoryStorage()
        const posthog = await create(storage, [], { crossSubdomain: false })
        expect(posthog.distinctId).toBe('legacy')
        posthog.identify('user-1')
        await posthog.shutdown()

        expect(jar.read(COOKIE, '.example.com')).toBeUndefined()
        expect((await create(storage, [], { crossSubdomain: false })).distinctId).toBe('user-1')
    })

    it('does not let a stale subdomain overwrite a newer identity', async () => {
        const app = await create(new MemoryStorage())
        visit('auth.example.com')
        const auth = await create(new MemoryStorage())
        auth.identify('user-1')

        app.register({ stale: true })
        app.capture('stale_activity')
        expect(jar.read()).toMatchObject({ distinct_id: 'user-1', $user_state: 'identified' })
        visit('www.example.com')
        expect((await create(new MemoryStorage())).distinctId).toBe('user-1')

        app.identify('user-2')
        expect(jar.read()).toMatchObject({ distinct_id: 'user-2', $user_state: 'identified' })
    })

    it('keeps posthog-js cookie keys through identify and drops them on reset', async () => {
        jar.write({
            distinct_id: 'anon-1',
            $device_id: 'anon-1',
            $user_state: 'anonymous',
            $initial_person_info: { r: 'x' },
        })
        const posthog = await create(new MemoryStorage())
        posthog.identify('user-1')
        expect(jar.read()).toMatchObject({ distinct_id: 'user-1', $initial_person_info: { r: 'x' } })
        posthog.reset()
        expect(jar.read()?.$initial_person_info).toBeUndefined()
    })

    it('ignores a cookieless posthog-js identity', async () => {
        const storage = new MemoryStorage()
        const distinctId = (await create(storage)).distinctId
        jar.write({ distinct_id: '$posthog_cookieless', $device_id: null })
        expect((await create(storage)).distinctId).toBe(distinctId)
    })

    it('does not write cookies when storage is disabled', async () => {
        await create(false)
        expect(jar.writes).toEqual([])
    })

    it('keeps local storage as the source of truth when cookies are blocked', async () => {
        vi.stubGlobal('document', {
            get cookie(): string {
                throw new Error('blocked')
            },
            set cookie(_value: string) {
                throw new Error('blocked')
            },
        })
        const storage = new MemoryStorage()
        const posthog = await create(storage)
        posthog.identify('user-1')
        expect(storedState(storage).distinctId).toBe('user-1')
        expect((await create(storage)).distinctId).toBe('user-1')
        expect(storage.getItem(STATE_KEY)).not.toBeNull()
    })

    it('drops the previous identity registered properties when an open tab adopts a reset', async () => {
        const app = await create(new MemoryStorage())
        app.identify('user-1')
        visit('www.example.com')
        const sent: SentEvent[] = []
        const www = await create(new MemoryStorage(), sent)
        www.register({ cohort: 'cohort-1' })
        const resets: unknown[] = []
        www.onReset(() => resets.push('reset'))

        visit('app.example.com')
        app.reset()
        visit('www.example.com')
        www.capture('after_reset')
        await www.flush()
        expect(sent.find((event) => event.event === 'after_reset')).toMatchObject({ distinct_id: app.distinctId })
        expect(sent.find((event) => event.event === 'after_reset')?.properties).not.toHaveProperty('cohort')
        expect(resets).toEqual(['reset'])
    })

    it('keeps registered properties when an open tab adopts an identify', async () => {
        const app = await create(new MemoryStorage())
        visit('www.example.com')
        const sent: SentEvent[] = []
        const www = await create(new MemoryStorage(), sent)
        www.register({ cohort: 'cohort-1' })

        visit('app.example.com')
        app.identify('user-1')
        visit('www.example.com')
        www.capture('after_identify')
        await www.flush()
        expect(sent.find((event) => event.event === 'after_identify')).toMatchObject({
            distinct_id: 'user-1',
            properties: { cohort: 'cohort-1' },
        })
    })

    it('does not let a write from an open tab restore an identity it adopted before a later reset', async () => {
        const app = await create(new MemoryStorage())
        app.capture('app_started')
        visit('www.example.com')
        const www = await create(new MemoryStorage())
        www.capture('www_started')

        visit('app.example.com')
        app.identify('user-1')
        visit('www.example.com')
        www.capture('adopt_identify')
        expect(www.distinctId).toBe('user-1')

        visit('app.example.com')
        app.reset()
        visit('www.example.com')
        www.register({ color: 'blue' })
        expect(jar.read()?.distinct_id).toBe(app.distinctId)
    })

    it('starts a new session in an open tab after a posthog-js reset', async () => {
        const now = Date.now()
        const oldSession = uuidv7(now - 60_000)
        jar.write({
            distinct_id: 'legacy-user',
            $device_id: 'legacy-device',
            $user_state: 'identified',
            $sesid: [now, oldSession, now - 60_000],
        })
        visit('www.example.com')
        const sent: SentEvent[] = []
        const www = await create(new MemoryStorage(), sent)
        www.capture('before_reset')
        const sessions: string[] = []
        www.onSessionId(({ sessionId }) => sessions.push(sessionId))

        // posthog-js reset() writes a new anonymous identity and an empty session.
        jar.write({
            distinct_id: 'legacy-anonymous',
            $device_id: 'legacy-device',
            $user_state: 'anonymous',
            $sesid: [null, null, null],
        })
        www.capture('after_reset')
        await www.flush()

        const after = sent.find((event) => event.event === 'after_reset')
        expect(after).toMatchObject({ distinct_id: 'legacy-anonymous' })
        expect(after?.session_id).not.toBe(oldSession)
        expect(sessions).toEqual([oldSession, after?.session_id])
    })

    it('shares person processing that another subdomain enables for the same identity', async () => {
        const app = await create(new MemoryStorage())
        app.capture('app_started')
        visit('www.example.com')
        const sent: SentEvent[] = []
        const www = await create(new MemoryStorage(), sent)
        www.capture('before_profile')

        visit('app.example.com')
        app.createPersonProfile()
        visit('www.example.com')
        www.register({ color: 'blue' })
        expect(jar.read()?.$epp).toBe(true)
        www.capture('after_profile')
        await www.flush()
        expect(sent.find((event) => event.event === 'after_profile')).toMatchObject({
            distinct_id: app.distinctId,
            options: { process_person_profile: true },
        })
    })
})
