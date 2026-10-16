import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
    chmodSync,
    cpSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

// An isolated install (Bun, pnpm) keeps @posthog/cli next to the plugin and does not link its
// binary into the consumer's node_modules/.bin.
test('uploads with its own CLI when the consumer does not depend on the CLI', (t) => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'posthog-rollup-cli-')))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const installedPackage = path.join(root, 'node_modules/@posthog/rollup-plugin')
    mkdirSync(installedPackage, { recursive: true })
    cpSync(path.join(packageDir, 'package.json'), path.join(installedPackage, 'package.json'))
    cpSync(path.join(packageDir, 'dist'), path.join(installedPackage, 'dist'), { recursive: true })

    const packageModules = path.join(installedPackage, 'node_modules')
    mkdirSync(path.join(packageModules, '@posthog'), { recursive: true })
    for (const name of ['@posthog/plugin-utils', 'magic-string']) {
        symlinkSync(path.join(packageDir, 'node_modules', name), path.join(packageModules, name), 'junction')
    }
    symlinkSync(path.join(packageDir, 'node_modules/rollup'), path.join(root, 'node_modules/rollup'), 'junction')

    const ownCliDir = path.join(packageModules, '@posthog/cli')
    mkdirSync(ownCliDir)
    writeFileSync(path.join(ownCliDir, 'package.json'), JSON.stringify({ name: '@posthog/cli', version: '0.18.10' }))
    const ownCliPath = path.join(ownCliDir, 'run-posthog-cli.js')
    writeFileSync(
        ownCliPath,
        `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.POSTHOG_CLI_CAPTURE_PATH, JSON.stringify(process.argv.slice(2)) + '\\n')
`
    )
    chmodSync(ownCliPath, 0o755)

    const capturePath = path.join(root, 'cli-calls.jsonl')
    writeFileSync(path.join(root, 'src.js'), 'console.log("app")\n')
    const runner = path.join(root, 'consumer.mjs')
    writeFileSync(
        runner,
        `import { rollup } from 'rollup'
import posthog from '@posthog/rollup-plugin'
const bundle = await rollup({
    input: 'src.js',
    plugins: [posthog({ personalApiKey: 'phx_test', projectId: '1', sourcemaps: { releaseMode: 'symbol-set', deleteAfterUpload: false } })],
})
await bundle.write({ dir: 'dist', sourcemap: true })
`
    )

    execFileSync(process.execPath, [runner], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, PATH: path.dirname(process.execPath), POSTHOG_CLI_CAPTURE_PATH: capturePath },
    })

    const calls = readFileSync(capturePath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].slice(0, 3), ['sourcemap', 'upload', '--stdin'])
})
