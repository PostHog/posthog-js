import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compatibilityServer, observations, survey } from './server.mjs'
import { replayNetworkCases, replayNetworkHeaders, replayNetworkPath } from './replay-network.mjs'
import { replayLinkedFlag } from './replay-cases.mjs'
import { conversationsConfig } from './extension-cases.mjs'

async function fixture(t, scenario = 'core', mode = 'snippet') {
    const folder = await mkdtemp(join(tmpdir(), 'compat-server-'))
    await writeFile(join(folder, 'surveys.js'), 'window.nativeSurvey = true;')
    await writeFile(join(folder, 'array.js'), 'window.nativeCore = true;')
    await writeFile(join(folder, 'loader.js'), 'window.nativeLoader = true;')
    const settings = {
        mode,
        scenario,
        coreVersion: '1.2.3',
        coreDist: folder,
        extensionDist: folder,
        allowedAssets: ['array.js', 'surveys.js', 'loader.js'],
        harness: join(folder, 'array.js'),
        snippet: join(folder, 'array.js'),
        player: join(folder, 'array.js'),
    }
    const server = compatibilityServer(settings)
    const origin = await server.start()
    t.after(async () => {
        await server.stop()
        await rm(folder, { recursive: true })
    })
    return { server, origin }
}

test('compatibility server holds actual native assets and supplies scenario config/flags/surveys', async (t) => {
    const { server, origin } = await fixture(t, 'delayed-loading')
    const pending = fetch(origin + '/static/1.2.3/surveys.js')
    while (!server.inspect().blockedRequests.length) await new Promise((resolve) => setImmediate(resolve))
    assert.equal(server.inspect().blockedRequests[0].barrier, 'extensions')
    assert.equal(observations(server).requests.length, 0)
    server.releaseBarrier('extensions')
    assert.equal(await (await pending).text(), 'window.nativeSurvey = true;')
    for (const name of ['config', 'flags', 'surveys']) server.releaseBarrier(name)
    const config = await (await fetch(origin + '/array/phc_COMPAT/config')).json()
    assert.deepEqual(config.surveys, [survey])
    assert.equal(config.sessionRecording, false)
    assert.equal(config.analytics.endpoint, '/e/')
    assert.deepEqual(config.supportedCompression, [])
    const flags = await (await fetch(origin + '/flags/', { method: 'POST', body: '{}' })).json()
    assert.deepEqual(flags.featureFlags, { 'compat-enabled': true, 'compat-variant': 'blue' })
    assert.equal(flags.requestId, '00000000-0000-4000-8000-000000000001')
    assert.deepEqual(flags.surveys, config.surveys)
    assert.deepEqual(await (await fetch(origin + '/api/surveys')).json(), { surveys: [survey] })
})

test('loader deployment serves its bootstrap immediately while holding the matching core', async (t) => {
    const { server, origin } = await fixture(t, 'core', 'loader')
    const html = await (await fetch(origin)).text()
    assert.match(html, /src="\/harness\.js"/)
    assert.doesNotMatch(html, /src="\/(?:consumer|snippet)\.js"/)
    const bootstrap = await fetch(origin + '/static/loader.js?project_token=phc_COMPAT', {
        signal: AbortSignal.timeout(2000),
    })
    assert.equal(bootstrap.status, 200)
    assert.equal(await bootstrap.text(), 'window.nativeLoader = true;')
    const pending = fetch(origin + '/static/1.2.3/array.js')
    while (!server.inspect().blockedRequests.length) await new Promise((resolve) => setImmediate(resolve))
    assert.equal(server.inspect().blockedRequests[0].barrier, 'core')
    server.releaseBarrier('core')
    assert.equal(await (await pending).text(), 'window.nativeCore = true;')
    assert.deepEqual(server.inspect().errors, [])
})

test('compatibility server preserves native versioned fallback and extension faults', async (t) => {
    for (const scenario of ['version-fallback', 'extension-failure']) {
        const { server, origin } = await fixture(t, scenario)
        server.releaseBarrier('extensions')
        assert.equal((await fetch(origin + '/static/9.9.9/surveys.js')).status, 404)
        assert.equal(
            (await fetch(origin + '/static/1.2.3/surveys.js')).status,
            scenario === 'version-fallback' ? 404 : 503
        )
        assert.equal((await fetch(origin + '/static/surveys.js')).status, scenario === 'version-fallback' ? 200 : 503)
        assert.deepEqual(
            observations(server).requests.map((record) => record.status),
            [404, scenario === 'version-fallback' ? 404 : 503, scenario === 'version-fallback' ? 200 : 503]
        )
    }
})

test('Replay network fixture preserves application headers and bodies on the wire', async (t) => {
    const { server, origin } = await fixture(t, 'replay')
    for (const sample of replayNetworkCases) {
        const response = await fetch(`${origin}${replayNetworkPath}/${sample.name}`, {
            method: 'POST',
            headers: replayNetworkHeaders.request,
            body: sample.requestBody,
        })
        assert.equal(response.status, 200)
        assert.equal(await response.text(), sample.responseBody)
        for (const [name, value] of Object.entries(replayNetworkHeaders.response))
            assert.equal(response.headers.get(name), value)
    }
    const requests = server.inspect().requests
    assert.equal(requests.length, replayNetworkCases.length)
    for (const [index, sample] of replayNetworkCases.entries()) {
        assert.equal(requests[index].rawBody, sample.requestBody)
        assert.equal(requests[index].headers.authorization, replayNetworkHeaders.request.authorization)
    }
    assert.deepEqual(server.inspect().errors, [])
})

test('XHR recovery holds the first real flags response until client cancellation, then returns fresh flags', async (t) => {
    const { server, origin } = await fixture(t, 'xhr-timeout-recovery')
    server.releaseBarrier('flags')
    const request = { method: 'POST', body: '{}' }
    const initial = await (await fetch(origin + '/flags/', request)).json()
    assert.equal(initial.featureFlags['compat-timeout'], 'cached')
    await fetch(origin + '/__compat/xhr-timeout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'recover' }),
    })
    await assert.rejects(fetch(origin + '/flags/', { ...request, signal: AbortSignal.timeout(100) }))
    const recovered = await (await fetch(origin + '/flags/', request)).json()
    assert.equal(recovered.featureFlags['compat-timeout'], 'fresh')
    assert.equal(recovered.featureFlags['compat-enabled'], true)
    while (server.inspect().blockedRequests.length) await new Promise((resolve) => setImmediate(resolve))
    const flags = server.inspect().requests.filter(({ path }) => path === '/flags/')
    assert.deepEqual(
        flags.map(({ status }) => status),
        [200, null, 200]
    )
    assert.equal(flags[1].responseFinished, false)
    assert.deepEqual(server.inspect().errors, [])
})

test('XHR exhaustion holds every flags attempt and leaves unrelated delivery available', async (t) => {
    const { server, origin } = await fixture(t, 'xhr-timeout-exhausted')
    server.releaseBarrier('flags')
    await fetch(origin + '/__compat/xhr-timeout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'exhaust' }),
    })
    for (let attempt = 0; attempt < 2; attempt++)
        await assert.rejects(
            fetch(origin + '/flags/', { method: 'POST', body: '{}', signal: AbortSignal.timeout(100) })
        )
    while (server.inspect().blockedRequests.length) await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(
        server
            .inspect()
            .requests.filter(({ path }) => path === '/flags/')
            .map(({ status }) => status),
        [null, null]
    )
    assert.equal((await fetch(origin + '/e/', { method: 'POST', body: '[]' })).status, 200)
    assert.deepEqual(server.inspect().errors, [])
})

test('compatibility behavioral projection retains original ordered ingestion batches separately from raw bytes', async (t) => {
    const { server, origin } = await fixture(t)
    const batch = [{ event: 'first', properties: { retained: null } }, { event: 'second' }]
    const bytes = JSON.stringify(batch)
    assert.deepEqual(
        await (
            await fetch(origin + '/e/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: bytes,
            })
        ).json(),
        { status: 1 }
    )
    assert.deepEqual(observations(server).events, batch)
    const record = observations(server).requests[0]
    assert.equal(record.path, '/e')
    assert.deepEqual(record.body, batch)
    assert.equal(server.inspect().requests[0].rawBodyBase64, Buffer.from(bytes).toString('base64'))
})

test('linked-flag replay starts with a nonmatching replay flag and keeps the readiness flag', async (t) => {
    const { server, origin } = await fixture(t, 'replay-linked-flag')
    server.releaseBarrier('flags')
    const flags = async () =>
        (await (await fetch(origin + '/flags/', { method: 'POST', body: '{}' })).json()).featureFlags
    assert.deepEqual(await flags(), {
        'compat-enabled': true,
        'compat-variant': 'blue',
        [replayLinkedFlag.flag]: replayLinkedFlag.before,
    })
    server.updateState({ flags: { [replayLinkedFlag.flag]: replayLinkedFlag.variant } })
    assert.equal((await flags())[replayLinkedFlag.flag], replayLinkedFlag.variant)
})

const visitor = '00000000-0000-4000-8000-000000000001'
const firstMessage = { message: 'Compat question', ticket_id: null, distinct_id: 'compat-visitor' }

function widgetClient(origin) {
    return async (method, route, { body, query = {}, token = conversationsConfig.token } = {}) => {
        const url = new URL(`${origin}/api/conversations/v1/widget${route}`)
        for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
        const response = await fetch(url, {
            method,
            headers: {
                ...(body ? { 'content-type': 'application/json' } : {}),
                ...(token === null ? {} : { 'x-conversations-token': token }),
            },
            body: body && JSON.stringify(body),
        })
        await response.json()
        return response.status
    }
}

test('Conversations widget routes require the widget token', async (t) => {
    const { origin } = await fixture(t, 'conversations')
    const request = widgetClient(origin)
    const requests = [
        ['POST', '/message', { body: { ...firstMessage, widget_session_id: visitor } }],
        ['GET', '/messages/compat-ticket', { query: { widget_session_id: visitor } }],
        ['POST', '/messages/compat-ticket/read', { body: { widget_session_id: visitor } }],
        ['GET', '/tickets', { query: { widget_session_id: visitor } }],
    ]
    for (const [method, path, options] of requests) {
        const statuses = []
        for (const token of [conversationsConfig.token, null, 'not-the-widget-token'])
            statuses.push(await request(method, path, { ...options, token }))
        assert.deepEqual(statuses, [200, 403, 403], `${method} ${path}`)
    }
})

test('Conversations widget routes require the anonymous visitor who started the ticket', async (t) => {
    const { origin } = await fixture(t, 'conversations')
    const request = widgetClient(origin)
    const withoutVisitor = [
        await request('POST', '/message', { body: firstMessage }),
        await request('POST', '/message', {
            body: { ...firstMessage, distinct_id: undefined, widget_session_id: visitor },
        }),
        await request('POST', '/message', { body: { ...firstMessage, widget_session_id: 'compat-visitor' } }),
        await request('GET', '/messages/compat-ticket'),
        await request('POST', '/messages/compat-ticket/read', { body: {} }),
        await request('GET', '/tickets'),
    ]
    assert.deepEqual(withoutVisitor, [400, 400, 400, 400, 400, 400])
    assert.equal(await request('POST', '/message', { body: { ...firstMessage, widget_session_id: visitor } }), 200)
    const otherVisitor = '00000000-0000-4000-8000-000000000002'
    const fromOtherVisitor = [
        await request('GET', '/messages/compat-ticket', { query: { widget_session_id: otherVisitor } }),
        await request('POST', '/messages/compat-ticket/read', { body: { widget_session_id: otherVisitor } }),
    ]
    assert.deepEqual(fromOtherVisitor, [403, 403])
})
