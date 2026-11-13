import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdtemp, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const example = fileURLToPath(new URL('../', import.meta.url))
const { createPackage, extractAll, listPackage, uncache } = createRequire(join(example, 'package.json'))(
    '@electron/asar'
)
const binary = process.argv[2]
assert.ok(binary, 'supply a genuine packager-produced executable')

test('packaged consumer cannot borrow missing @posthog/core from workspace ancestors', async () => {
    const root = process.platform === 'darwin' ? dirname(dirname(dirname(binary))) : dirname(binary)
    // Keep the broken control below the workspace: relocation must be owned by the launch harness.
    const scratch = await mkdtemp(join(dirname(root), 'missing-core-'))
    try {
        const copy = join(scratch, basename(root))
        await cp(root, copy, { recursive: true, dereference: false, verbatimSymlinks: true })
        const resources = process.platform === 'darwin' ? join(copy, 'Contents', 'Resources') : join(copy, 'resources')
        const archive = join(resources, 'app.asar')
        const extracted = join(scratch, 'extracted')
        extractAll(archive, extracted)
        const core = join(extracted, 'node_modules', '@posthog', 'core')
        assert.ok((await stat(core)).isDirectory(), 'genuine package must initially contain core')
        await rm(core, { recursive: true })
        await rm(archive)
        await createPackage(extracted, archive)
        uncache(archive)
        assert.equal(
            listPackage(archive).some((path) => /[\\/]node_modules[\\/]@posthog[\\/]core(?:[\\/]|$)/.test(path)),
            false
        )
        await rm(extracted, { recursive: true })

        const result = await new Promise((resolve, reject) => {
            const child = spawn(
                process.execPath,
                [
                    join(example, 'smoke-test.mjs'),
                    `--packaged=${join(copy, relative(root, binary))}`,
                    '--fixture=platform',
                ],
                {
                    cwd: example,
                    env: { ...process.env, NODE_PATH: join(example, 'packaging', 'node_modules') },
                    stdio: ['ignore', 'pipe', 'pipe'],
                }
            )
            let output = ''
            child.stdout.on('data', (chunk) => {
                output += chunk
            })
            child.stderr.on('data', (chunk) => {
                output += chunk
            })
            child.once('error', reject)
            child.once('close', (code, signal) => resolve({ code, signal, output }))
        })
        console.log(result.output)
        assert.equal(result.code, 1, 'dependency-removed genuine app must fail the smoke test')
        assert.equal(result.signal, null)
        assert.match(
            result.output,
            /Error \[ERR_MODULE_NOT_FOUND\]: Cannot find package '@posthog\/core' imported from .*app\.asar[\\/]node_modules[\\/]/,
            'failure must identify the removed ESM dependency, not a setup error'
        )
        assert.match(result.output, /Electron exited with code 1, signal null/, 'native app must exit, not time out')
    } finally {
        await rm(scratch, { recursive: true, force: true })
    }
})
