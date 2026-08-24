import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { build } from 'vite'
import posthogRollupPlugin from '../dist/index.js'

const CHUNK_ID_COMMENT = /(?:^|\n)\/\/# chunkId=(\S{1,128})/

test('uploads client chunks after Vite 8 Oxc output minification', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-rollup-plugin-vite-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))

    const capturePath = path.join(root, 'posthog-cli-call.json')
    const cliPath = path.join(root, 'posthog-cli.mjs')
    await fs.writeFile(
        cliPath,
        `#!/usr/bin/env node
import fs from 'node:fs'
let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { stdin += chunk })
process.stdin.on('end', () => {
    fs.writeFileSync(process.env.POSTHOG_CLI_CAPTURE_PATH, JSON.stringify({ args: process.argv.slice(2), stdin }))
})
`
    )
    await fs.chmod(cliPath, 0o755)
    await fs.writeFile(path.join(root, 'index.html'), '<script type="module" src="/src.ts"></script>')
    await fs.writeFile(path.join(root, 'src.ts'), 'console.log("app")')

    const previousCapturePath = process.env.POSTHOG_CLI_CAPTURE_PATH
    process.env.POSTHOG_CLI_CAPTURE_PATH = capturePath
    t.after(() => {
        if (previousCapturePath === undefined) {
            delete process.env.POSTHOG_CLI_CAPTURE_PATH
        } else {
            process.env.POSTHOG_CLI_CAPTURE_PATH = previousCapturePath
        }
    })

    await build({
        configFile: false,
        root,
        logLevel: 'silent',
        plugins: [
            posthogRollupPlugin({
                personalApiKey: 'phx_test',
                projectId: '1',
                cliBinaryPath: cliPath,
                sourcemaps: { deleteAfterUpload: false },
            }),
        ],
        build: { outDir: 'dist', minify: 'oxc' },
    })

    const cliCall = JSON.parse(await fs.readFile(capturePath, 'utf8'))
    assert.deepEqual(cliCall.args.slice(0, 3), ['sourcemap', 'upload', '--stdin'])

    const uploadedChunks = cliCall.stdin.trim().split('\n')
    assert.equal(uploadedChunks.length, 1)

    const chunk = await fs.readFile(uploadedChunks[0], 'utf8')
    const chunkId = CHUNK_ID_COMMENT.exec(chunk)?.[1]
    assert.ok(chunkId, 'final chunk should retain its CLI-facing chunk id comment')
    assert.match(chunk, /_posthogChunkIds/)
    assert.ok(
        chunk.replace(`//# chunkId=${chunkId}`, '').includes(chunkId),
        'the runtime snippet and upload comment should carry the same chunk id'
    )
})
