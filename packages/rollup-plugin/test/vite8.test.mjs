import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { build } from 'vite'
import { createChunkIdSnippet } from '@posthog/plugin-utils'
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

test('keeps the release snippet exactly as posthog-cli matches it through Vite 8 Oxc minification', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-rollup-plugin-vite-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))

    // Answers `release resolve` with the release the build is for; nothing is uploaded, since
    // write: false skips writeBundle.
    const cliPath = path.join(root, 'posthog-cli.mjs')
    await fs.writeFile(
        cliPath,
        `#!/usr/bin/env node\nprocess.stdout.write(process.env.POSTHOG_TEST_RELEASE_ID + '\\n')\n`
    )
    await fs.chmod(cliPath, 0o755)
    await fs.writeFile(path.join(root, 'index.html'), '<script type="module" src="/src.ts"></script>')
    await fs.writeFile(path.join(root, 'src.ts'), 'export function boom() { throw new Error("boom") }\nboom()')

    const previousReleaseId = process.env.POSTHOG_TEST_RELEASE_ID
    t.after(() => {
        if (previousReleaseId === undefined) {
            delete process.env.POSTHOG_TEST_RELEASE_ID
        } else {
            process.env.POSTHOG_TEST_RELEASE_ID = previousReleaseId
        }
    })

    async function buildChunk(releaseId) {
        process.env.POSTHOG_TEST_RELEASE_ID = releaseId ?? ''
        const plugins = releaseId
            ? [
                  posthogRollupPlugin({
                      personalApiKey: 'phx_test',
                      projectId: '1',
                      cliBinaryPath: cliPath,
                      sourcemaps: { deleteAfterUpload: false, releaseMode: 'event' },
                  }),
              ]
            : []
        const { output } = await build({
            configFile: false,
            root,
            logLevel: 'silent',
            plugins,
            build: { outDir: 'dist', minify: 'oxc', sourcemap: true, write: false },
        })
        const chunk = output.find((item) => item.type === 'chunk')
        const map = JSON.parse(output.find((item) => item.fileName === `${chunk.fileName}.map`).source)
        return { fileName: chunk.fileName, code: chunk.code, map, chunkId: CHUNK_ID_COMMENT.exec(chunk.code)?.[1] }
    }

    const first = await buildChunk('release-a')
    const second = await buildChunk('release-b')
    const withoutPlugin = await buildChunk(undefined)

    for (const [build, releaseId] of [
        [first, 'release-a'],
        [second, 'release-b'],
    ]) {
        assert.ok(build.chunkId, 'the chunk should carry its CLI-facing chunk id comment')
        assert.ok(
            build.code.startsWith(`${createChunkIdSnippet(build.chunkId, releaseId)}\n`),
            'the snippet should survive minification byte for byte, on a line of its own'
        )
        assert.ok(!build.code.includes('posthog-chunk-id-snippet'), 'no placeholder should be left')
    }

    // Unchanged code keeps its chunk id across releases, while the file name, a content hash,
    // still changes with the release it carries.
    assert.equal(second.chunkId, first.chunkId)
    assert.notEqual(second.fileName, first.fileName)

    // The snippet only adds an unmapped first line: the code below it and its mappings are what
    // Vite produces without the plugin.
    const body = (code) =>
        code
            .split('\n')
            .filter((line) => !line.startsWith('//# '))
            .join('\n')
    assert.equal(body(first.code), `${createChunkIdSnippet(first.chunkId, 'release-a')}\n${body(withoutPlugin.code)}`)
    assert.equal(first.map.mappings, `;${withoutPlugin.map.mappings}`)
})
