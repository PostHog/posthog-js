import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createBrowserTestServer } from './serve-browser-tests.mjs'

test('browser fixture routes and native Capture V1 retain exact request evidence', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'browser-fixture-'))
    const fixturePath = join(folder, 'fixture.js')
    await writeFile(fixturePath, 'window.fixture = true;')
    const server = createBrowserTestServer({ fixturePath })
    const origin = await server.start()
    try {
        assert.match(await (await fetch(origin)).text(), /script src="\/fixture.js"/)
        assert.equal(await (await fetch(origin + '/fixture.js')).text(), 'window.fixture = true;')
        assert.match(await (await fetch(origin + '/after')).text(), /after/)
        for (const gzip of [false, true]) {
            const body = JSON.stringify({
                batch: [{ uuid: gzip ? 'compressed' : 'plain', event: 'native', properties: { retained: true } }],
            })
            const bytes = gzip ? gzipSync(body) : Buffer.from(body)
            const response = await fetch(origin + '/i/v1/analytics/events', {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer phc_FIXTURE',
                    'Content-Type': 'application/json',
                    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
                },
                body: bytes,
            })
            assert.deepEqual(await response.json(), { results: { [gzip ? 'compressed' : 'plain']: { result: 'ok' } } })
            const requests = await (await fetch(origin + '/requests')).json()
            assert.equal(requests.length, gzip ? 2 : 1)
            const record = requests.at(-1)
            assert.equal(record.headers.authorization, 'Bearer phc_FIXTURE')
            assert.equal(record.body, bytes.toString('utf8'))
            assert.deepEqual(Buffer.from(record.rawBodyBase64, 'base64'), bytes)
            assert.deepEqual(record.decodedBody, JSON.parse(body))
        }
        assert.equal((await fetch(origin + '/unknown')).status, 404)
        assert.equal(server.inspect().events.length, 2)
        assert(
            server
                .inspect()
                .requests.filter((record) => record.method === 'POST')
                .every((record) => record.path === '/i/v1/analytics/events')
        )
    } finally {
        await server.stop()
        await rm(folder, { recursive: true })
    }
})
