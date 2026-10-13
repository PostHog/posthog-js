import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compatibilityServer, observations, survey } from './server.mjs'

async function fixture(t, scenario = 'core') {
    const folder = await mkdtemp(join(tmpdir(), 'compat-server-'))
    await writeFile(join(folder, 'surveys.js'), 'window.nativeSurvey = true;')
    await writeFile(join(folder, 'array.js'), 'window.nativeCore = true;')
    const settings = {
        mode: 'snippet',
        scenario,
        coreVersion: '1.2.3',
        coreDist: folder,
        extensionDist: folder,
        allowedAssets: ['array.js', 'surveys.js'],
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
