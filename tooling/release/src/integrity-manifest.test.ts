import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { writeIntegrityManifest } from './integrity-manifest.ts'

const hash = (bytes: string | Buffer) => 'sha384-' + createHash('sha384').update(bytes).digest('base64')

test('manifest hashes final executable assets and excludes maps, declarations and itself', async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-integrity-'))
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    await fs.mkdir(path.join(directory, 'toolbar'))
    const files = {
        'array.js': 'minified-sdk();\n//# sourceMappingURL=array.js.map',
        'loader.js': 'minified-loader();',
        'module.mjs': 'export default 1;',
        'main.cjs': 'module.exports = 1;',
        'toolbar/chunk.js': 'minified-toolbar();',
        'toolbar.css': 'body{color:red}',
        'array.js.map': '{}',
        'module.d.ts': 'export declare const sdk: unknown;',
        'integrity.json': '{}',
    }
    for (const [file, content] of Object.entries(files)) {
        await fs.writeFile(path.join(directory, file), content)
    }
    await writeIntegrityManifest(directory, '1.442.1')
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'integrity.json'), 'utf8'))
    assert.equal(manifest.version, '1.442.1')
    assert.deepEqual(manifest.files, {
        'array.js': hash(files['array.js']),
        'loader.js': hash(files['loader.js']),
        'main.cjs': hash(files['main.cjs']),
        'module.mjs': hash(files['module.mjs']),
        'toolbar.css': hash(files['toolbar.css']),
        'toolbar/chunk.js': hash(files['toolbar/chunk.js']),
    })
    const first = await fs.readFile(path.join(directory, 'integrity.json'), 'utf8')
    await writeIntegrityManifest(directory, '1.442.1')
    assert.equal(await fs.readFile(path.join(directory, 'integrity.json'), 'utf8'), first)

    await fs.writeFile(path.join(directory, 'array.js'), 'changed-final-sdk();')
    await writeIntegrityManifest(directory, '1.442.1')
    const updated = JSON.parse(await fs.readFile(path.join(directory, 'integrity.json'), 'utf8'))
    assert.equal(updated.files['array.js'], hash('changed-final-sdk();'))
})

test('release manifests include only selected delivered assets and the final regional toolbar', async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-integrity-release-'))
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    await fs.writeFile(path.join(directory, 'array.js'), 'sdk')
    await fs.writeFile(path.join(directory, 'module.mjs'), 'npm-only')
    await fs.writeFile(path.join(directory, 'toolbar.js'), 'regional-toolbar')
    await writeIntegrityManifest(directory, '1.442.1', ['toolbar.js', 'array.js'])
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'integrity.json'), 'utf8'))
    assert.deepEqual(manifest.files, { 'array.js': hash('sdk'), 'toolbar.js': hash('regional-toolbar') })
})

test('refuses invalid versions and empty executable asset sets', async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-integrity-empty-'))
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    await assert.rejects(writeIntegrityManifest(directory, '../latest'), /Invalid integrity manifest version/)
    await assert.rejects(writeIntegrityManifest(directory, '1.442.1'), /No assets found/)
})
