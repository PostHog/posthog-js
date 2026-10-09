import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { putS3ObjectFromFile, s3ObjectMatchesFile } from './s3.ts'
import { startS3, type StoredObject } from './test-utils/s3-server.ts'

const body = Buffer.from('console.log("release bytes")')
const key = 'static/1.438.3/array.js'
const options = {
    contentType: 'application/javascript',
    cacheControl: 'public, max-age=31536000, immutable',
    ifNoneMatch: '*',
}
const stored = (): StoredObject => ({
    body,
    contentType: options.contentType,
    cacheControl: options.cacheControl,
    checksum: createHash('sha256').update(body).digest('base64'),
})
async function fixture(t: TestContext) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'release-s3-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    const file = path.join(dir, 'array.js')
    await fs.writeFile(file, body)
    return { ...(await startS3(t)), file }
}

test('replays the entire buffer after a socket reset, retaining the conditional write and checksum', async (t) => {
    const s3 = await fixture(t)
    let attempts = 0
    s3.hooks.before = (req, res) => {
        if (req.method === 'PUT' && ++attempts === 1) {
            res.destroy()
            return true
        }
        return false
    }
    await putS3ObjectFromFile('assets', key, s3.file, options, s3.client)
    assert.equal(attempts, 2)
    for (const req of s3.requests.filter((req) => req.method === 'PUT')) {
        assert.deepEqual(req.body, body)
        assert.equal(req.headers['if-none-match'], '*')
        assert.equal(req.headers['x-amz-checksum-sha256'], stored().checksum)
    }
    assert.equal(await s3ObjectMatchesFile('assets', key, s3.file, options, s3.client), true)
})

test('accepts a committed PUT with a lost acknowledgement only after verifying the 412 object', async (t) => {
    const s3 = await fixture(t)
    let attempts = 0
    s3.hooks.before = (req, res) => {
        if (req.method === 'PUT' && ++attempts === 1) {
            s3.objects.set(req.key, stored())
            res.destroy()
            return true
        }
        return false
    }
    await putS3ObjectFromFile('assets', key, s3.file, options, s3.client)
    assert.equal(attempts, 2)
    assert.equal(s3.requests.at(-1)?.method, 'HEAD')
    assert.deepEqual(s3.objects.get('/assets/' + key)?.body, body)
})

test('does not accept a different concurrent writer after a 412', async (t) => {
    const s3 = await fixture(t)
    let attempts = 0
    s3.hooks.before = (req, res) => {
        if (req.method === 'PUT' && ++attempts === 1) {
            const competingBody = Buffer.alloc(body.length, 'x')
            s3.objects.set(req.key, {
                ...stored(),
                body: competingBody,
                checksum: createHash('sha256').update(competingBody).digest('base64'),
            })
            res.destroy()
            return true
        }
        return false
    }
    await assert.rejects(putS3ObjectFromFile('assets', key, s3.file, options, s3.client), /checksum differs/)
    assert.equal(attempts, 2)
    assert.ok(s3.requests.filter((r) => r.method === 'PUT').every((r) => r.headers['if-none-match'] === '*'))
})

test('skips identical objects on rerun without rewriting them', async (t) => {
    const s3 = await fixture(t)
    s3.objects.set('/assets/' + key, stored())
    await putS3ObjectFromFile('assets', key, s3.file, options, s3.client)
    assert.deepEqual(
        s3.requests.map((r) => r.method),
        ['HEAD']
    )
})

test('hashes legacy objects without SHA-256 instead of trusting ETag', async (t) => {
    const s3 = await fixture(t)
    s3.objects.set('/assets/' + key, { ...stored(), checksum: undefined })
    await putS3ObjectFromFile('assets', key, s3.file, options, s3.client)
    assert.deepEqual(
        s3.requests.map((r) => r.method),
        ['HEAD', 'GET']
    )
    assert.ok(s3.requests[1].headers['if-match'])
})

test('downloads multipart objects instead of comparing a composite checksum with a file hash', async (t) => {
    const s3 = await fixture(t)
    s3.objects.set('/assets/' + key, {
        ...stored(),
        checksum: createHash('sha256').update('checksum of parts').digest('base64') + '-2',
        checksumType: 'COMPOSITE',
    })
    await putS3ObjectFromFile('assets', key, s3.file, options, s3.client)
    assert.deepEqual(
        s3.requests.map((r) => r.method),
        ['HEAD', 'GET']
    )
})

for (const [field, value] of [
    ['checksum', createHash('sha256').update('wrong').digest('base64')],
    ['body', Buffer.from('different length')],
    ['contentType', 'text/plain'],
    ['cacheControl', 'max-age=1'],
    ['contentEncoding', 'gzip'],
] as const) {
    test(`rejects existing immutable objects with different ${field}`, async (t) => {
        const s3 = await fixture(t)
        s3.objects.set('/assets/' + key, { ...stored(), [field]: value })
        await assert.rejects(putS3ObjectFromFile('assets', key, s3.file, options, s3.client), /differs/)
        assert.equal(s3.requests.filter((r) => r.method === 'PUT').length, 0)
    })
}

test('legacy GET bytes are checked even when length and metadata match', async (t) => {
    const s3 = await fixture(t)
    s3.objects.set('/assets/' + key, { ...stored(), body: Buffer.alloc(body.length, 'x'), checksum: undefined })
    await assert.rejects(putS3ObjectFromFile('assets', key, s3.file, options, s3.client), /checksum differs/)
    assert.equal(s3.requests.filter((r) => r.method === 'PUT').length, 0)
})

test('permission errors are not retried or interpreted as missing assets', async (t) => {
    const s3 = await fixture(t)
    s3.hooks.before = (_req, res) => {
        res.writeHead(403)
        res.end()
        return true
    }
    await assert.rejects(putS3ObjectFromFile('assets', key, s3.file, options, s3.client))
    assert.deepEqual(
        s3.requests.map((r) => r.method),
        ['HEAD']
    )
})

test('transient PUT failures exhaust a bounded retry budget', async (t) => {
    const s3 = await fixture(t)
    s3.hooks.before = (req, res) => {
        if (req.method !== 'PUT') return false
        res.writeHead(503, { 'content-type': 'application/xml' })
        res.end('<Error><Code>SlowDown</Code></Error>')
        return true
    }
    await assert.rejects(putS3ObjectFromFile('assets', key, s3.file, options, s3.client))
    assert.equal(s3.requests.filter((r) => r.method === 'PUT').length, 4)
})

test('an explicit overwrite can replace conflicting immutable assets', async (t) => {
    const s3 = await fixture(t)
    s3.objects.set('/assets/' + key, { ...stored(), body: Buffer.from('old') })
    await putS3ObjectFromFile('assets', key, s3.file, { ...options, ifNoneMatch: undefined }, s3.client)
    assert.deepEqual(s3.objects.get('/assets/' + key)?.body, body)
    assert.deepEqual(
        s3.requests.map((r) => r.method),
        ['PUT']
    )
})
