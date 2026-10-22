import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test, { type TestContext } from 'node:test'
import { buildBrowserAssetUploadPlans, collectBrowserAssets } from './upload-browser-s3.ts'
import { startS3 } from './test-utils/s3-server.ts'

const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const version = '0.1.0'
const files: Record<string, string> = {
    'posthog.js': 'classic entry',
    'posthog.js.map': '{}',
    'chunks/flags-abc.js': 'flags',
    'chunks/flags-abc.js.map': '{}',
    'chunks/nested/surveys-def.js': 'surveys',
    'chunks/nested/surveys-def.js.map': '{}',
    'assets/ui.css': 'body {}',
    'assets/icon.svg': '<svg />',
    'assets/module.wasm': 'wasm',
}

async function fixture(t: TestContext) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-cdn-release-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const dist = path.join(root, 'packages/browser-next/dist-cdn')
    for (const [name, body] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(dist, name)), { recursive: true })
        await fs.writeFile(path.join(dist, name), body)
    }
    const s3 = await startS3(t)
    const run = (flags: string[] = ['--immutable-only'], target = version) =>
        new Promise<{ code: number | null; output: string }>((resolve, reject) => {
            const child = spawn(process.execPath, [cli, 'upload-browser-s3', 'assets', target, ...flags], {
                cwd: root,
                env: {
                    ...process.env,
                    AWS_ACCESS_KEY_ID: 'test',
                    AWS_SECRET_ACCESS_KEY: 'test',
                    AWS_SESSION_TOKEN: '',
                    AWS_REGION: 'us-east-1',
                    AWS_ENDPOINT_URL_S3: s3.endpoint,
                    AWS_EC2_METADATA_DISABLED: 'true',
                },
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: 20000,
            })
            let output = ''
            child.stdout.on('data', (data) => {
                output += data
            })
            child.stderr.on('data', (data) => {
                output += data
            })
            child.on('error', reject)
            child.on('close', (code) => resolve({ code, output }))
        })
    return { ...s3, dist, run }
}

test('browser asset planner includes the complete recursive tree with isolated prefixes, MIME and cache metadata', async (t) => {
    const { dist } = await fixture(t)
    const assets = await collectBrowserAssets(dist)
    assert.deepEqual(assets.map((asset) => asset.relativeKey).sort(), Object.keys(files).sort())
    const plans = buildBrowserAssetUploadPlans(version, assets)
    for (const [phase, prefix, cache] of [
        ['immutable', `static/browser/${version}/`, 'public, max-age=31536000, immutable'],
        ['majorAlias', 'static/browser/0/', 'public, max-age=300'],
    ] as const) {
        assert.equal(plans[phase].length, Object.keys(files).length)
        for (const upload of plans[phase]) {
            assert.equal(upload.cacheControl, cache)
            assert.ok(upload.key.startsWith(prefix))
            assert.ok(upload.filePath.startsWith(dist))
            const name = upload.key.slice(prefix.length)
            assert.equal(await fs.readFile(upload.filePath, 'utf8'), files[name])
            assert.equal(
                upload.contentType,
                name.endsWith('.js')
                    ? 'application/javascript'
                    : name.endsWith('.map')
                      ? 'application/json'
                      : name.endsWith('.css')
                        ? 'text/css'
                        : name.endsWith('.svg')
                          ? 'image/svg+xml'
                          : 'application/wasm'
            )
        }
    }
    assert.deepEqual(buildBrowserAssetUploadPlans('0.1.0-beta.1', assets).majorAlias, [])
    for (const invalid of ['0.1', '../1.0.0', '1.0.0/other']) {
        assert.throws(() => buildBrowserAssetUploadPlans(invalid, assets), /Invalid version/)
    }
    for (const relativeKey of ['../array.js', '/array.js', 'foo/../../array.js', 'foo\\array.js']) {
        assert.throws(
            () => buildBrowserAssetUploadPlans(version, [{ relativeKey, filePath: '' }]),
            /Invalid browser CDN asset path/
        )
    }
})

test('browser collector requires the entry and refuses symlinks instead of silently omitting assets', async (t) => {
    const s3 = await fixture(t)
    await fs.unlink(path.join(s3.dist, 'posthog.js'))
    const missing = await s3.run()
    assert.equal(missing.code, 1)
    assert.match(missing.output, /must contain posthog.js/)
    assert.equal(s3.requests.length, 0)
    await fs.writeFile(path.join(s3.dist, 'posthog.js'), files['posthog.js'])
    await fs.symlink('posthog.js', path.join(s3.dist, 'link.js'))
    await assert.rejects(collectBrowserAssets(s3.dist), /Unsupported browser CDN asset/)
})

test('real browser CLI verifies every immutable dependency before aliases and retains historical chunks', async (t) => {
    const s3 = await fixture(t)
    const absent = await s3.run(['--aliases-only'])
    assert.equal(absent.code, 1, absent.output)
    assert.equal(s3.requests.filter((r) => r.method === 'PUT').length, 0)
    const immutable = await s3.run()
    assert.equal(immutable.code, 0, immutable.output)
    assert.equal(s3.objects.size, Object.keys(files).length)
    assert.ok(s3.requests.every((r) => r.key.startsWith(`/assets/static/browser/${version}/`)))
    assert.ok(s3.requests.filter((r) => r.method === 'PUT').every((r) => r.headers['if-none-match'] === '*'))
    assert.equal(
        s3.requests.filter((r) => r.method === 'PUT').at(-1)?.key,
        `/assets/static/browser/${version}/posthog.js`
    )
    const corrupt = s3.objects.get(`/assets/static/browser/${version}/chunks/nested/surveys-def.js`)!
    const original = { ...corrupt }
    corrupt.checksum = createHash('sha256').update('wrong').digest('base64')
    s3.requests.length = 0
    assert.equal((await s3.run(['--aliases-only'])).code, 1)
    assert.equal(s3.requests.filter((r) => r.method === 'PUT').length, 0)
    s3.objects.set(`/assets/static/browser/${version}/chunks/nested/surveys-def.js`, original)
    s3.objects.set('/assets/static/browser/0/chunks/historical.js', {
        body: Buffer.from('old'),
        contentType: 'application/javascript',
    })
    const aliases = await s3.run(['--aliases-only'])
    assert.equal(aliases.code, 0, aliases.output)
    for (const [name, body] of Object.entries(files)) {
        const exact = s3.objects.get(`/assets/static/browser/${version}/${name}`)!
        const alias = s3.objects.get(`/assets/static/browser/0/${name}`)!
        assert.equal(alias.body.toString(), body)
        assert.deepEqual(alias.body, exact.body)
        assert.equal(alias.contentType, exact.contentType)
        assert.equal(alias.cacheControl, 'public, max-age=300')
        assert.equal(exact.cacheControl, 'public, max-age=31536000, immutable')
        assert.equal(alias.contentEncoding, undefined)
    }
    assert.ok(s3.objects.has('/assets/static/browser/0/chunks/historical.js'))
    const puts = s3.requests.filter((r) => r.method === 'PUT')
    assert.equal(puts.at(-1)?.key, '/assets/static/browser/0/posthog.js')
    assert.ok(puts.every((r) => r.key.startsWith('/assets/static/browser/0/')))
})

test('browser CLI resumes partial immutable uploads without rewriting matching assets and fails closed on conflicts', async (t) => {
    const s3 = await fixture(t)
    s3.hooks.before = (req, res) => {
        if (req.method !== 'PUT' || !req.key.endsWith('/flags-abc.js')) return false
        res.writeHead(403)
        res.end()
        return true
    }
    assert.equal((await s3.run()).code, 1)
    const completed = [...s3.objects.keys()]
    assert.ok(completed.length > 0)
    assert.ok(completed.every((key) => key.startsWith(`/assets/static/browser/${version}/`)))
    assert.ok(
        !completed.includes(`/assets/static/browser/${version}/posthog.js`),
        'failed dependencies must not expose the immutable entry'
    )
    s3.hooks.before = undefined
    s3.requests.length = 0
    const resumed = await s3.run()
    assert.equal(resumed.code, 0, resumed.output)
    assert.ok(s3.requests.filter((r) => r.method === 'PUT').every((r) => !completed.includes(r.key)))
    assert.equal(s3.objects.size, Object.keys(files).length)
    await fs.writeFile(path.join(s3.dist, 'chunks/flags-abc.js'), 'different bytes')
    s3.requests.length = 0
    const conflict = await s3.run()
    assert.equal(conflict.code, 1)
    assert.match(conflict.output, /differs/)
    assert.equal(s3.requests.filter((r) => r.method === 'PUT').length, 0)
})

test('browser CLI uses the shared retry and conditional-write verification after a lost acknowledgement', async (t) => {
    const s3 = await fixture(t)
    let attempts = 0
    s3.hooks.before = (req, res) => {
        if (req.method === 'PUT' && req.key.endsWith('/posthog.js') && ++attempts === 1) {
            s3.objects.set(req.key, {
                body: req.body,
                contentType: String(req.headers['content-type']),
                cacheControl: req.headers['cache-control'],
                checksum: String(req.headers['x-amz-checksum-sha256']),
            })
            res.destroy()
            return true
        }
        return false
    }
    const result = await s3.run()
    assert.equal(result.code, 0, result.output)
    assert.equal(attempts, 2)
    assert.ok(s3.requests.filter((r) => r.method === 'PUT').every((r) => r.headers['if-none-match'] === '*'))
})

test('browser CLI prereleases verify immutable assets but never write aliases in either phase', async (t) => {
    const s3 = await fixture(t)
    const target = `${version}-beta.1`
    assert.equal((await s3.run(['--immutable-only'], target)).code, 0)
    assert.equal((await s3.run(['--aliases-only'], target)).code, 0)
    assert.equal(s3.objects.size, Object.keys(files).length)
    assert.ok(s3.requests.every((r) => r.key.startsWith(`/assets/static/browser/${target}/`)))
})

test('browser CLI rejects invalid phase arguments before accessing storage', async (t) => {
    const s3 = await fixture(t)
    for (const flags of [
        [],
        ['--unknown'],
        ['--force-overwrite'],
        ['--aliases-only', '--immutable-only'],
        ['--aliases-only', '--aliases-only'],
    ]) {
        const result = await s3.run(flags)
        assert.equal(result.code, 1)
        assert.match(result.output, /Invalid upload-browser-s3 arguments/)
    }
    assert.equal(s3.requests.length, 0)
})
