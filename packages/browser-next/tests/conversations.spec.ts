// @vitest-environment jsdom
import type { ConversationsRemoteConfig } from '@posthog/browser-common'
import { createPostHog as createRootPostHog } from '../src/composition/npm'
import { createPostHog as createCorePostHog } from '../src/composition/npm/core'
import { conversations } from '../src/products/conversations/conversations'
import { createConversations, loadConversationsRenderer } from '../src/products/conversations/conversations-extension'
import type { ConversationsExtension } from '../src/products/conversations/conversations-options'
import type { BrowserFetch, IPostHog, PostHogOptions, RemoteConfig, StorageLike } from '../src/core/types'

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

interface ConversationsRequest {
    url: URL
    method: string
    headers: Record<string, string>
    body: Record<string, any> | undefined
}

const widgetConfig = (overrides: Partial<ConversationsRemoteConfig> = {}): ConversationsRemoteConfig => ({
    enabled: true,
    token: 'conversations-token',
    widgetEnabled: false,
    ...overrides,
})

/** Answers conversations API requests and records them; other requests succeed with an empty body. */
const createConversationsFetch = (requests: ConversationsRequest[]): BrowserFetch => {
    let ticket = 0
    return async (input, init = {}) => {
        const url = new URL(String(input))
        if (!url.pathname.startsWith('/api/conversations/')) return new Response('{}', { status: 200 })
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
        requests.push({ url, method: init.method ?? 'GET', headers: { ...(init.headers as object) }, body })
        let json: unknown = {}
        if (url.pathname.endsWith('/widget/message')) {
            json = { ticket_id: body?.ticket_id ?? `ticket-${++ticket}`, message_id: 'message', created_at: 'now' }
        } else if (url.pathname.endsWith('/widget/tickets')) {
            json = { count: 0, results: [] }
        } else if (url.pathname.includes('/widget/messages/')) {
            json = { ticket_id: 'ticket-1', messages: [], has_more: false, unread_count: 0 }
        }
        return new Response(JSON.stringify(json), { status: 200 })
    }
}

const conversationRequests = (requests: ConversationsRequest[], path: string): ConversationsRequest[] =>
    requests.filter((request) => request.url.pathname.endsWith(path))

const baseOptions = {
    projectToken: 'test-token',
    capturePageview: false,
    navigator: false,
    flags: false,
} satisfies PostHogOptions

/** Tests supply only the remote configuration fields conversations reads. */
const remote = (config: Partial<RemoteConfig>): RemoteConfig => config as RemoteConfig

const clients: IPostHog[] = []

const createClient = async (
    remote: Partial<RemoteConfig>,
    options: { [Key in keyof PostHogOptions]?: PostHogOptions[Key] | undefined } = {}
): Promise<{ client: IPostHog; requests: ConversationsRequest[]; events: string[] }> => {
    const requests: ConversationsRequest[] = []
    const client = await createRootPostHog({
        ...baseOptions,
        storage: new MemoryStorage(),
        fetch: createConversationsFetch(requests),
        remoteConfig: remote as RemoteConfig,
        ...options,
    } as PostHogOptions)
    clients.push(client)
    const events: string[] = []
    client.onEvent(({ event }) => events.push(event))
    return { client, requests, events }
}

const loaded = async (client: IPostHog): Promise<ConversationsExtension> => {
    await vi.waitFor(() => expect(client.conversations?.isAvailable()).toBe(true))
    return client.conversations!
}

/** Records identification and events from client creation, before other extensions set up. */
const recorder = (identified: string[], events: string[]) => ({
    name: 'recorder',
    setup: (posthog: IPostHog) => {
        posthog.onIdentify(({ distinctId }) => identified.push(distinctId))
        posthog.onEvent(({ event }) => events.push(event))
    },
})

const STORAGE_KEY = 'ph_conv_test-token'
const storedWidget = (): Record<string, unknown> => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')

/** A renderer import the test settles. */
const deferredRenderer = () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const load = vi.fn(() => gate.then(loadConversationsRenderer))
    return { load, release }
}

beforeEach(() => {
    localStorage.clear()
})

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    history.replaceState(null, '', '/')
})

describe('conversations', () => {
    it('loads when remote configuration enables conversations', async () => {
        const { client, events } = await createClient({ conversations: widgetConfig() })

        const extension = await loaded(client)
        expect(extension.getUnavailableReason()).toBeNull()
        expect(extension.getWidgetSessionId()).toEqual(expect.any(String))
        await vi.waitFor(() => expect(events).toContain('$conversations_loaded'))
    })

    it('stays unloaded when the project does not enable conversations or the option disables it', async () => {
        const disabled = await createClient({ conversations: false })
        const absent = await createClient({})
        const optedOut = await createClient({ conversations: widgetConfig() }, { conversations: false })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(disabled.client.conversations).toBeUndefined()
        expect(absent.client.conversations).toBeUndefined()
        expect(optedOut.client.conversations).toBeUndefined()
    })

    it('reports why conversations are unavailable', async () => {
        const pending = await createClient(
            {},
            { remoteConfig: undefined, conversations: {}, fetch: () => new Promise<Response>(() => {}) }
        )
        expect(pending.client.conversations?.getUnavailableReason()).toBe('remote_config_pending')

        const failed = await createClient(
            {},
            { remoteConfig: undefined, conversations: {}, fetch: async () => new Response('', { status: 500 }) }
        )
        await vi.waitFor(() => expect(failed.client.conversations?.getUnavailableReason()).toBe('remote_config_failed'))

        const disabled = await createClient({ conversations: false }, { conversations: {} })
        expect(disabled.client.conversations?.getUnavailableReason()).toBe('disabled_in_project')

        const missingToken = await createClient(
            { conversations: widgetConfig({ token: '' }) },
            { conversations: {}, debug: false }
        )
        expect(missingToken.client.conversations?.getUnavailableReason()).toBe('missing_token')
        expect(missingToken.client.conversations?.isAvailable()).toBe(false)
    })

    it('sends messages with the widget session and persists the ticket', async () => {
        const storage = new MemoryStorage()
        const { client, requests, events } = await createClient({ conversations: widgetConfig() }, { storage })
        const extension = await loaded(client)

        const response = await extension.sendMessage('Hello', { name: 'Ada', email: 'ada@example.com' })

        expect(response?.ticket_id).toBe('ticket-1')
        const [request] = conversationRequests(requests, '/widget/message')
        expect(request?.method).toBe('POST')
        expect(request?.headers['X-Conversations-Token']).toBe('conversations-token')
        expect(request?.body).toMatchObject({
            message: 'Hello',
            traits: { name: 'Ada', email: 'ada@example.com' },
            ticket_id: null,
            widget_session_id: extension.getWidgetSessionId(),
            distinct_id: client.distinctId,
            session_context: { current_url: 'http://localhost:3000/' },
        })
        expect(request?.body).not.toHaveProperty('identity_hash')
        expect(extension.getCurrentTicketId()).toBe('ticket-1')
        expect(events).toContain('$conversations_message_sent')

        // A later client on the same storage resumes the widget session and ticket.
        const sessionId = extension.getWidgetSessionId()
        await client.dispose()
        const next = await createClient({ conversations: widgetConfig() }, { storage })
        const resumed = await loaded(next.client)
        expect(resumed.getWidgetSessionId()).toBe(sessionId)
        expect(resumed.getCurrentTicketId()).toBe('ticket-1')
    })

    it('keeps widget state under the posthog-js storage key, independently of client storage', async () => {
        // A visitor upgrading from posthog-js keeps the widget session that grants access to their tickets.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ widgetSessionId: 'legacy-session', ticketId: 'ticket-7' }))
        const { client } = await createClient({ conversations: widgetConfig() }, { storage: false })
        const extension = await loaded(client)

        expect(extension.getWidgetSessionId()).toBe('legacy-session')
        expect(extension.getCurrentTicketId()).toBe('ticket-7')

        // Another tab's write is read fresh rather than overwritten from a stale copy.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...storedWidget(), userTraits: { name: 'Other tab' } }))
        await extension.sendMessage('Hi', undefined, true)
        expect(storedWidget()).toMatchObject({
            widgetSessionId: 'legacy-session',
            ticketId: 'ticket-1',
            userTraits: { name: 'Other tab' },
        })

        client.reset()
        await vi.waitFor(() => expect(extension.isAvailable()).toBe(true))
        expect(storedWidget().widgetSessionId).not.toBe('legacy-session')
    })

    it('keeps rendering the widget when prepareStylesheet throws', async () => {
        const prepareStylesheet = vi.fn(() => {
            throw new Error('customer failure')
        })
        const { client } = await createClient(
            { conversations: widgetConfig({ widgetEnabled: true }) },
            { conversations: { prepareStylesheet } }
        )
        const extension = await loaded(client)

        await vi.waitFor(() => expect(extension.isVisible()).toBe(true))
        expect(prepareStylesheet).toHaveBeenCalled()
        expect(document.querySelector('style[data-ph-conversations-theme]')).toBeNull()
    })

    it('applies a close() requested before loading', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ widgetSessionId: 'session', widgetState: 'open' }))
        const { client } = await createClient(
            {},
            { remoteConfig: undefined, conversations: {}, fetch: () => new Promise<Response>(() => {}) }
        )
        client.conversations?.close()
        await client.dispose()

        const { client: next } = await createClient(
            { conversations: widgetConfig({ widgetEnabled: true }) },
            { conversations: {} }
        )
        next.conversations?.close()
        const extension = await loaded(next)

        await vi.waitFor(() => expect(extension.isVisible()).toBe(true))
        expect(storedWidget().widgetState).toBe('closed')
    })

    it('adds a cache-busting timestamp to polling requests', async () => {
        const { client, requests } = await createClient({ conversations: widgetConfig() })
        const extension = await loaded(client)

        await extension.getMessages('ticket-9')

        const [request] = conversationRequests(requests, '/widget/messages/ticket-9')
        expect(request?.method).toBe('GET')
        expect(request?.url.searchParams.get('widget_session_id')).toBe(extension.getWidgetSessionId())
        expect(request?.url.searchParams.get('limit')).toBe('50')
        expect(request?.url.searchParams.get('_')).toMatch(/^\d+$/)
    })

    it('fails a stalled widget request with a network error after 60 seconds', async () => {
        const { client } = await createClient(
            { conversations: widgetConfig() },
            {
                fetch: (input, init) =>
                    new URL(String(input)).pathname.startsWith('/api/conversations/')
                        ? new Promise<Response>((_, reject) => {
                              // oxlint-disable-next-line posthog-js/no-add-event-listener
                              init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
                          })
                        : Promise.resolve(new Response('{}')),
            }
        )
        const extension = await loaded(client)
        vi.useFakeTimers()
        try {
            let failure: unknown
            void extension.getTickets().catch((error: unknown) => (failure = error))
            await vi.advanceTimersByTimeAsync(60_000)
            expect(failure).toMatchObject({ kind: 'network' })
        } finally {
            vi.useRealTimers()
        }
    })

    it('does not poll after disposal when a sent message completes', async () => {
        const requests: ConversationsRequest[] = []
        const respond = createConversationsFetch(requests)
        let release!: () => void
        const sent = new Promise<void>((resolve) => (release = resolve))
        const { client } = await createClient(
            { conversations: widgetConfig({ widgetEnabled: true }) },
            {
                fetch: async (input, init) => {
                    const response = respond(input, init)
                    if (new URL(String(input)).pathname.endsWith('/widget/message')) await sent
                    return response
                },
            }
        )
        const extension = await loaded(client)
        await vi.waitFor(() => expect(extension.isVisible()).toBe(true))
        const message = extension.sendMessage('Hello')
        await client.dispose()
        const count = requests.length

        release()
        await message
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(requests.slice(count)).toEqual([])
    })

    it('resolves API calls to null before conversations load', async () => {
        const { client } = await createClient(
            {},
            { remoteConfig: undefined, conversations: {}, fetch: () => new Promise<Response>(() => {}) }
        )
        const extension = client.conversations!

        await expect(extension.sendMessage('Hello')).resolves.toBeNull()
        await expect(extension.getTickets()).resolves.toBeNull()
        expect(extension.getCurrentTicketId()).toBeNull()
        expect(extension.getWidgetSessionId()).toBeNull()
        expect(extension.isVisible()).toBe(false)
    })

    it('renders the widget and applies an open() requested before loading', async () => {
        let resolveConfig!: (config: Partial<RemoteConfig>) => void
        const requests: ConversationsRequest[] = []
        const conversationsFetch = createConversationsFetch(requests)
        const client = await createRootPostHog({
            ...baseOptions,
            storage: new MemoryStorage(),
            conversations: { theme: { primary: '#123456' } },
            fetch: async (input, init) =>
                new URL(String(input)).pathname.endsWith('/config')
                    ? new Promise<Partial<RemoteConfig>>((resolve) => (resolveConfig = resolve)).then(
                          (config) => new Response(JSON.stringify(config))
                      )
                    : conversationsFetch(input, init),
        })
        clients.push(client)
        client.conversations?.open()

        await vi.waitFor(() => expect(resolveConfig).toBeDefined())
        resolveConfig({ conversations: widgetConfig({ widgetEnabled: true }) })
        const extension = await loaded(client)

        await vi.waitFor(() => expect(extension.isVisible()).toBe(true))
        expect(document.getElementById('ph-conversations-widget-container')).not.toBeNull()
        expect(document.querySelector<HTMLElement>('style[data-ph-conversations-theme]')?.innerText).toContain(
            '#123456'
        )

        await client.dispose()
        expect(document.getElementById('ph-conversations-widget-container')).toBeNull()
    })
})

describe('conversations with several clients', () => {
    it('keeps the widget of the client that created it', async () => {
        const config = widgetConfig({ widgetEnabled: true })
        const owner = await loaded((await createClient({ conversations: config })).client)
        await vi.waitFor(() => expect(owner.isVisible()).toBe(true))
        const widget = document.getElementById('ph-conversations-widget-container')

        const { client } = await createClient({ conversations: config })
        await client.resolveExtension('conversations')
        // Let the renderer finish loading for the second client.
        await vi.waitFor(() => expect(client.conversations?.getUnavailableReason()).not.toBe('initializing'))
        client.conversations?.hide()
        await client.dispose()

        expect(document.getElementById('ph-conversations-widget-container')).toBe(widget)
        expect(owner.isVisible()).toBe(true)
    })

    it('resets the shared widget when a client that did not create it resets, as in posthog-js', async () => {
        const config = widgetConfig({ widgetEnabled: true })
        const owner = await loaded((await createClient({ conversations: config })).client)
        const previousSession = owner.getWidgetSessionId()

        const { client } = await createClient({ conversations: config })
        await client.resolveExtension('conversations')
        await vi.waitFor(() => expect(client.conversations?.getUnavailableReason()).not.toBe('initializing'))
        client.reset()

        await vi.waitFor(() => expect(client.conversations?.getWidgetSessionId()).toBeTruthy())
        expect(client.conversations?.getWidgetSessionId()).not.toBe(previousSession)
        expect(storedWidget().widgetSessionId).toBe(client.conversations?.getWidgetSessionId())
        expect(owner.isVisible()).toBe(false)
    })
})

describe('conversations identity', () => {
    it('uses a verified identity for requests and returns to the widget session when cleared', async () => {
        const { client, requests, events } = await createClient({ conversations: widgetConfig() })
        const extension = await loaded(client)

        extension.setIdentity('user-1', 'hmac-hash')
        await extension.sendMessage('Verified')
        extension.clearIdentity()
        await extension.sendMessage('Anonymous')

        const [verified, anonymous] = conversationRequests(requests, '/widget/message')
        expect(verified?.body).toMatchObject({
            identity_distinct_id: 'user-1',
            identity_hash: 'hmac-hash',
            distinct_id: 'user-1',
        })
        expect(verified?.body).not.toHaveProperty('widget_session_id')
        expect(anonymous?.body).toMatchObject({ widget_session_id: extension.getWidgetSessionId() })
        expect(anonymous?.body).not.toHaveProperty('identity_hash')
        // posthog-js links the verified distinct ID to the current person.
        expect(events).toContain('$create_alias')
    })

    it('verifies an already identified visitor without linking another person', async () => {
        const { client, requests, events } = await createClient({ conversations: widgetConfig() })
        const extension = await loaded(client)
        client.identify('user-1')
        events.length = 0

        extension.setIdentity('user-1', 'hmac-hash')
        await extension.sendMessage('Verified')

        expect(events).not.toContain('$create_alias')
        expect(events).not.toContain('$identify')
        expect(client.distinctId).toBe('user-1')
        expect(conversationRequests(requests, '/widget/message')[0]?.body).toMatchObject({
            identity_distinct_id: 'user-1',
        })
    })

    it('bootstraps a configured identity without an identify event for a new visitor', async () => {
        const identified: string[] = []
        const events: string[] = []
        const extension = conversations({ identity: { distinctId: 'user-3', hash: 'hash-3' } })
        const client = await createCorePostHog({
            ...baseOptions,
            storage: new MemoryStorage(),
            fetch: createConversationsFetch([]),
            remoteConfig: remote({ conversations: widgetConfig() }),
            extensions: [recorder(identified, events), extension],
        })
        clients.push(client)
        await loaded(client)

        expect(client.distinctId).toBe('user-3')
        expect(identified).toEqual(['user-3'])
        expect(events).not.toContain('$identify')
    })

    it('keeps a setup bootstrap distinct ID over the configured identity, as posthog-js does', async () => {
        const extension = conversations({ identity: { distinctId: 'user-6', hash: 'hash-6' } })
        const client = await createCorePostHog({
            ...baseOptions,
            storage: new MemoryStorage(),
            fetch: createConversationsFetch([]),
            remoteConfig: remote({ conversations: widgetConfig() }),
            bootstrap: { distinctId: 'bootstrapped-anonymous' },
            extensions: [extension],
        })
        clients.push(client)
        await loaded(client)

        expect(client.distinctId).toBe('bootstrapped-anonymous')
    })

    it('identifies a visitor with earlier anonymous activity and preserves a different identified person', async () => {
        const storage = new MemoryStorage()
        const first = await createClient({}, { storage })
        const anonymousId = first.client.distinctId
        first.client.capture('earlier')
        await first.client.dispose()

        const events: string[] = []
        const returning = await createClient(
            { conversations: widgetConfig() },
            {
                storage,
                extensions: [recorder([], events)],
                conversations: { identity: { distinctId: 'user-4', hash: 'hash-4' } },
            }
        )
        expect(anonymousId).not.toBe('user-4')
        expect(returning.client.distinctId).toBe('user-4')
        expect(events).toContain('$identify')
        await returning.client.dispose()

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const other = await createClient(
            { conversations: widgetConfig() },
            { storage, debug: true, conversations: { identity: { distinctId: 'user-5', hash: 'hash-5' } } }
        )
        expect(other.client.distinctId).toBe('user-4')
        expect(warn).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('existing identity is preserved'))
    })

    it('identifies an anonymous visitor with the configured identity and forwards its claims', async () => {
        const { client, requests } = await createClient(
            { conversations: widgetConfig() },
            {
                conversations: {
                    identity: {
                        distinctId: 'user-2',
                        hash: 'hash-2',
                        claims: {
                            email: { value: 'a@example.com', hash: 'email-hash' },
                            hash_x: { value: 'x', hash: 'y' },
                        },
                    },
                },
            }
        )
        const extension = await loaded(client)
        expect(client.distinctId).toBe('user-2')

        await extension.getTickets()

        const [request] = conversationRequests(requests, '/widget/tickets')
        expect(request?.url.searchParams.get('identity_distinct_id')).toBe('user-2')
        expect(request?.url.searchParams.get('identity_hash')).toBe('hash-2')
        expect(request?.url.searchParams.get('identity_email')).toBe('a@example.com')
        expect(request?.url.searchParams.get('identity_hash_email')).toBe('email-hash')
        expect(request?.url.searchParams.has('identity_x')).toBe(false)
        expect(request?.url.searchParams.has('widget_session_id')).toBe(false)
    })

    it('uses the claims the identity option had when the extension was created', async () => {
        const email = { value: 'old@example.com', hash: 'old-hash' }
        const extension = conversations({ identity: { distinctId: 'user-2', hash: 'hash-2', claims: { email } } })
        email.value = 'new@example.com'
        email.hash = 'new-hash'
        const { client, requests } = await createClient({ conversations: widgetConfig() }, { extensions: [extension] })
        await loaded(client)

        await extension.getTickets()

        const [request] = conversationRequests(requests, '/widget/tickets')
        expect(request?.url.searchParams.get('identity_email')).toBe('old@example.com')
        expect(request?.url.searchParams.get('identity_hash_email')).toBe('old-hash')
    })

    it('clears the verified identity and starts a fresh widget session on reset', async () => {
        const { client, requests } = await createClient({ conversations: widgetConfig() })
        const extension = await loaded(client)
        const sessionId = extension.getWidgetSessionId()
        extension.setIdentity('user-1', 'hmac-hash')

        client.reset()

        await vi.waitFor(() => expect(extension.isAvailable()).toBe(true))
        expect(extension.getWidgetSessionId()).not.toBe(sessionId)
        await extension.sendMessage('After reset')
        const request = conversationRequests(requests, '/widget/message').at(-1)
        expect(request?.body).toMatchObject({ widget_session_id: extension.getWidgetSessionId() })
        expect(request?.body).not.toHaveProperty('identity_hash')
    })
})

describe('conversations loading', () => {
    const createDeferred = async (options: Partial<PostHogOptions> = {}) => {
        const renderer = deferredRenderer()
        const extension = createConversations({}, renderer.load)
        const client = await createCorePostHog({
            ...baseOptions,
            storage: false,
            fetch: createConversationsFetch([]),
            remoteConfig: remote({ conversations: widgetConfig() }),
            extensions: [extension],
            ...options,
        })
        clients.push(client)
        return { client, extension, renderer }
    }

    it('reports initializing while the renderer loads and starts over after a reset during loading', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ widgetSessionId: 'previous-session' }))
        const { client, extension, renderer } = await createDeferred()
        expect(extension.getUnavailableReason()).toBe('initializing')

        client.reset()
        renderer.release()

        await loaded(client)
        expect(renderer.load).toHaveBeenCalledTimes(2)
        expect(extension.getWidgetSessionId()).not.toBe('previous-session')
    })

    it('does not create a widget when disposed while the renderer loads', async () => {
        const { client, extension, renderer } = await createDeferred()

        await client.dispose()
        renderer.release()
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(extension.isAvailable()).toBe(false)
        expect(extension.getWidgetSessionId()).toBeNull()
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })
})

describe('conversations consent', () => {
    it('keeps the widget and its requests working while capture is opted out, as posthog-js does', async () => {
        const { client, requests } = await createClient({ conversations: widgetConfig() }, { optOutByDefault: true })
        const extension = await loaded(client)
        const sessionId = extension.getWidgetSessionId()

        client.optOut()
        expect(extension.isAvailable()).toBe(true)
        expect(extension.getWidgetSessionId()).toBe(sessionId)
        expect(await extension.getTickets()).toEqual({ count: 0, results: [] })
        expect(conversationRequests(requests, '/widget/tickets')).toHaveLength(1)
    })
})

describe('manual conversations composition', () => {
    it('installs from the conversations entry point on the core client', async () => {
        const requests: ConversationsRequest[] = []
        const extension = conversations()
        const client = await createCorePostHog({
            ...baseOptions,
            storage: false,
            fetch: createConversationsFetch(requests),
            remoteConfig: remote({ conversations: widgetConfig() }),
            extensions: [extension],
        })
        clients.push(client)

        expect(client.conversations).toBe(extension)
        await loaded(client)
        await extension.sendMessage('Hi')
        expect(conversationRequests(requests, '/widget/message')).toHaveLength(1)
    })
})
