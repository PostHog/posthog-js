import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test, { type TestContext } from 'node:test'
import { startS3 } from './test-utils/s3-server.ts'

const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const version = '1.438.3'
async function fixture(t: TestContext) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 's3-release-cli-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const dist = path.join(root, 'packages/browser/dist')
    await fs.mkdir(dist, { recursive: true })
    await fs.writeFile(path.join(dist, 'array.js'), 'sdk')
    await fs.writeFile(path.join(dist, 'recorder.js'), 'recorder')
    const s3 = await startS3(t)
    const run = (flags: string[] = [], target = version) =>
        new Promise<{ code: number | null; output: string }>((resolve, reject) => {
            const child = spawn(process.execPath, [cli, 'upload-s3', 'assets', target, ...flags], {
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

test('resumes a partial release without force and never rewrites identical immutable assets', async (t) => {
    const s3 = await fixture(t)
    s3.hooks.before = (req, res) => {
        if (req.method !== 'PUT' || !req.key.endsWith('/recorder.js')) return false
        res.writeHead(403)
        res.end()
        return true
    }
    assert.equal((await s3.run()).code, 1)
    assert.ok(s3.objects.has(`/assets/static/${version}/array.js`))
    assert.ok(
        s3.requests.filter((r) => r.method === 'PUT').every((r) => r.key.startsWith(`/assets/static/${version}/`))
    )
    s3.hooks.before = undefined
    const result = await s3.run()
    assert.equal(result.code, 0, result.output)
    assert.equal(s3.objects.size, 6)
    assert.equal(
        s3.requests.filter((r) => r.method === 'PUT' && r.key === `/assets/static/${version}/array.js`).length,
        1
    )
})

test('alias-only phase verifies all immutable bytes before any alias PUT', async (t) => {
    const s3 = await fixture(t)
    assert.equal((await s3.run(['--aliases-only'])).code, 1)
    assert.equal(s3.requests.filter((r) => r.method === 'PUT').length, 0)
    assert.equal((await s3.run(['--immutable-only'])).code, 0)
    assert.equal(s3.objects.size, 2)
    await fs.writeFile(path.join(s3.dist, 'recorder.js'), 'modified')
    const mismatch = await s3.run(['--aliases-only'])
    assert.equal(mismatch.code, 1)
    assert.match(mismatch.output, /differs/)
    assert.equal(s3.requests.filter((r) => r.method === 'PUT').length, 2)
    await fs.writeFile(path.join(s3.dist, 'recorder.js'), 'recorder')
    const promoted = await s3.run(['--aliases-only'])
    assert.equal(promoted.code, 0, promoted.output)
    assert.equal(s3.objects.size, 6)
    assert.equal(s3.requests.filter((r) => r.method === 'PUT' && r.key.includes(`/${version}/`)).length, 2)
})

test('a mismatching existing immutable asset prevents every write, unless force is explicit', async (t) => {
    const s3 = await fixture(t)
    assert.equal((await s3.run(['--immutable-only'])).code, 0)
    s3.requests.length = 0
    await fs.writeFile(path.join(s3.dist, 'recorder.js'), 'new recorder')
    const mismatch = await s3.run()
    assert.equal(mismatch.code, 1)
    assert.equal(s3.requests.filter((r) => r.method === 'PUT').length, 0)
    const overwrite = await s3.run(['--immutable-only', '--force-overwrite'])
    assert.equal(overwrite.code, 0, overwrite.output)
    assert.equal(s3.objects.get(`/assets/static/${version}/recorder.js`)?.body.toString(), 'new recorder')
    assert.equal(s3.objects.size, 2)
})

test('prereleases never promote aliases even when running the alias phase', async (t) => {
    const s3 = await fixture(t)
    const target = `${version}-beta.1`
    assert.equal((await s3.run(['--immutable-only'], target)).code, 0)
    assert.equal((await s3.run(['--aliases-only'], target)).code, 0)
    assert.equal(s3.objects.size, 2)
    assert.ok([...s3.objects.keys()].every((key) => key.includes(target)))
})

test('the real uploader bounds concurrent PUTs across a larger release', async (t) => {
    const s3 = await fixture(t)
    for (let i = 0; i < 32; i++) {
        await fs.writeFile(path.join(s3.dist, `asset-${i}.js`), `asset ${i}`)
    }
    let active = 0
    let peak = 0
    s3.hooks.before = async (req) => {
        if (req.method === 'PUT') {
            active++
            peak = Math.max(peak, active)
            await new Promise((resolve) => setTimeout(resolve, 25))
            active--
        }
        return false
    }
    const result = await s3.run(['--immutable-only'])
    assert.equal(result.code, 0, result.output)
    assert.equal(s3.objects.size, 34)
    assert.ok(peak > 1 && peak <= 8, `Observed ${peak} concurrent PUTs`)
})

test('rejects contradictory or duplicate phase flags without touching S3', async (t) => {
    const s3 = await fixture(t)
    for (const flags of [
        ['--aliases-only', '--immutable-only'],
        ['--aliases-only', '--force-overwrite'],
        ['--aliases-only', '--aliases-only'],
        ['--unknown'],
    ]) {
        const result = await s3.run(flags)
        assert.equal(result.code, 1)
        assert.match(result.output, /Invalid upload-s3 option/)
    }
    assert.equal(s3.requests.length, 0)
})
