import assert from 'node:assert/strict'

export const exceptionCases = [
    { trigger: 'uncaught', type: 'TypeError', value: 'compat-uncaught' },
    { trigger: 'rejection', type: 'RangeError', value: 'compat-rejection' },
    { trigger: 'consoleError', type: 'Error', value: 'compat-console' },
    { trigger: 'manual', type: 'SyntaxError', value: 'compat-manual' },
]

// The fixture throws these on purpose; any other page error or rejection still fails the cell.
// Firefox also reports unhandled rejections as page errors.
export const expectedPageErrors = (scenario) =>
    scenario === 'exceptions' ? ['compat-uncaught', 'compat-rejection'] : []
export const expectedRejections = (scenario) => (scenario === 'exceptions' ? ['compat-rejection'] : [])

const exceptionEvents = (network) => network.events.filter((event) => event.event === '$exception')

export async function exerciseExceptions({ page, received, expect }) {
    await page.waitForFunction(() => typeof window.__PosthogExtensions__?.errorWrappingFunctions === 'object')
    for (const [index, { trigger }] of exceptionCases.entries()) {
        // One delivery at a time keeps the event order independent of request batching.
        await page.locator(`#compat-error-${trigger}`).click()
        await expect
            .poll(async () => exceptionEvents(await received()).length, {
                message: `Missing ${trigger} exception delivery`,
            })
            .toBe(index + 1)
    }
}

export function assertExceptionDelivery(network) {
    const events = exceptionEvents(network)
    assert.equal(events.length, exceptionCases.length, 'Missing or duplicate exception deliveries')
    for (const [index, { trigger, type, value }] of exceptionCases.entries()) {
        const [exception] = events[index].properties.$exception_list ?? []
        assert.equal(exception?.type, type, `Incorrect ${trigger} exception type`)
        assert.equal(exception?.value, value, `Incorrect ${trigger} exception value`)
        assert(
            exception.stacktrace?.frames?.some((frame) => /\/errors\.js$/.test(frame.filename ?? '')),
            `Missing fixture stack frame for ${trigger}`
        )
    }
    assert.equal(events.at(-1).properties.compat_source, 'manual', 'Lost manual exception properties')
}

export const toolbarState = {
    action: 'ph_authorize',
    token: 'phc_COMPAT',
    temporaryToken: 'compat-temporary-token',
    userIntent: 'heatmaps',
    toolbarVersion: 'toolbar',
}

// Applications authorize the toolbar with a base64 JSON state in the URL hash.
export const toolbarPath = () => `/#__posthog=${encodeURIComponent(btoa(JSON.stringify(toolbarState)))}`

// The PostHog app serves toolbar.js; this stand-in records the core's handoff.
export const toolbarScript = `window.ph_load_toolbar = function (params, posthog) {
    window.__compat.toolbar = {
        params: window.__compat.encode(params),
        sameInstance: posthog === window.__compat.ph,
        calls: (window.__compat.toolbar?.calls ?? 0) + 1,
    }
}`

export async function exerciseToolbar({ page }) {
    await page.waitForFunction(() => window.__compat.toolbar)
    return page.evaluate(() => ({
        handoff: window.__compat.toolbar,
        hash: location.hash,
        state: window.ph_toolbar_state,
    }))
}

export function assertToolbarHandoff(toolbar, network) {
    assert.equal(toolbar.handoff.calls, 1, 'Toolbar loaded more than once')
    assert.equal(toolbar.handoff.sameInstance, true, 'Toolbar received a different SDK instance')
    assert.equal(toolbar.handoff.params.token, toolbarState.token, 'Toolbar lost the project token')
    assert.equal(toolbar.handoff.params.temporaryToken, toolbarState.temporaryToken, 'Toolbar lost its credential')
    assert.equal(toolbar.hash, '', 'Toolbar state remained in the URL')
    const requests = network.requests.filter((request) => request.path === '/static/toolbar.js')
    assert.equal(requests.length, 1, 'Missing or duplicate toolbar script request')
}

export const conversationsConfig = {
    enabled: true,
    widgetEnabled: true,
    token: 'compat-conversations-token',
    greetingText: 'Compat greeting',
    placeholderText: 'Compat message',
    requireEmail: false,
    collectName: false,
}
const conversationsApi = '/api/conversations/v1/widget'
const ticketId = 'compat-ticket'
const question = {
    id: 'compat-question',
    content: 'Compat question',
    author_type: 'customer',
    created_at: '2024-01-01T00:00:01.000Z',
    is_private: false,
}
const reply = {
    id: 'compat-reply',
    content: 'Compat reply',
    author_type: 'human',
    author_name: 'Compat agent',
    created_at: '2024-01-01T00:00:02.000Z',
    is_private: false,
}

// Fixed backend responses for the widget's ticket lifecycle. Like the API, message polls
// return only messages created strictly after the `after` timestamp.
export function conversationsResponse({ method, path, url }) {
    if (method === 'GET' && path === `${conversationsApi}/tickets`) return { json: { count: 0, results: [] } }
    if (method === 'POST' && path === `${conversationsApi}/message`)
        return {
            json: {
                ticket_id: ticketId,
                message_id: question.id,
                ticket_status: 'new',
                created_at: question.created_at,
                unread_count: 0,
            },
        }
    if (method === 'GET' && path === `${conversationsApi}/messages/${ticketId}`) {
        const after = url.searchParams.get('after')
        const messages = [question, reply].filter((message) => !after || message.created_at > after)
        return {
            json: {
                ticket_id: ticketId,
                ticket_status: 'open',
                messages,
                has_more: false,
                unread_count: messages.some((message) => message.author_type !== 'customer') ? 1 : 0,
            },
        }
    }
    if (method === 'POST' && path === `${conversationsApi}/messages/${ticketId}/read`)
        return { json: { success: true, unread_count: 0 } }
    return undefined
}

const widget = '#ph-conversations-widget-container'
export const conversationsLauncher = `${widget} button[aria-label^="Open chat"]`

export async function exerciseConversations({ page, received, expect }) {
    const pending = new Set()
    const started = (request) => pending.add(request)
    const finished = (request) => pending.delete(request)
    page.on('request', started)
    page.on('requestfinished', finished)
    page.on('requestfailed', finished)
    // Polling runs on the paused clock. A finished request can still have response handling queued
    // in the page, so yield real tasks until no request is in flight before moving the clock again.
    const settle = async () => {
        do {
            await expect.poll(() => pending.size).toBe(0)
            await page.evaluate(async () => {
                for (let i = 0; i < 5; i++)
                    await new Promise((resolve) => {
                        const channel = new MessageChannel()
                        channel.port1.onmessage = resolve
                        channel.port2.postMessage(null)
                    })
            })
        } while (pending.size > 0)
    }
    const advance = async (duration) => {
        for (; duration > 0; duration -= 1000) {
            await page.clock.runFor(Math.min(duration, 1000))
            await settle()
        }
    }
    const conversationRequests = async () =>
        (await received()).requests.filter((request) => request.path.startsWith(conversationsApi))
    try {
        const launcher = page.locator(conversationsLauncher)
        await expect(launcher).toBeVisible()
        await launcher.click()
        await advance(1000)
        const ui = { opened: await page.locator(widget).innerText() }
        await page.locator(`${widget} textarea`).fill(question.content)
        await page.locator(`${widget} button[aria-label="Send message"]`).click()
        // The send response starts an immediate poll and schedules a follow-up poll. Wait for that
        // first poll and its mark-read before advancing, so both timers start on the same tick.
        await expect
            .poll(async () => {
                const requests = await conversationRequests()
                return (
                    requests.some((request) => request.method === 'GET' && request.path.includes('/messages/')) &&
                    requests.some((request) => request.path.endsWith('/read'))
                )
            })
            .toBe(true)
        await settle()
        await advance(6000)
        await expect(page.locator(widget).getByText(reply.content)).toBeVisible()
        ui.conversation = await page.locator(widget).innerText()
        return ui
    } finally {
        page.off('request', started)
        page.off('requestfinished', finished)
        page.off('requestfailed', finished)
    }
}

export function assertConversationDelivery(ui, network) {
    const sent = network.requests.filter(
        (request) => request.method === 'POST' && request.path === `${conversationsApi}/message`
    )
    assert.equal(sent.length, 1, 'Missing or duplicate conversation message')
    assert.equal(sent[0].body?.message, question.content, 'Incorrect conversation message')
    assert.equal(sent[0].body?.ticket_id, null, 'First message did not request a new ticket')
    assert(ui.conversation.includes(reply.content), 'Conversation reply was not rendered')
    assert.equal(ui.conversation.split(question.content).length - 1, 1, 'Conversation message rendered more than once')
}
