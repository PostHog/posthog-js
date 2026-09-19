// oxlint-disable compat/compat -- Node-only build regression tests
import assert from 'node:assert/strict'
import { fork, execFileSync } from 'node:child_process'
import { globSync, mkdtempSync, readFileSync, writeFileSync, rmSync, statSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const manifests = globSync(['packages/rrweb/*/package.json', 'packages/rrweb/plugins/*/package.json'], { cwd: root })
const logs = mkdtempSync(path.join(tmpdir(), 'rrweb-watch-'))
const marker = 'rrwebWatchProbe'
function exportedDeclarations(value) {
    if (typeof value === 'string') return value.endsWith('.d.ts') ? [value.replace(/^\.\//, '')] : []
    return Object.values(value).flatMap(exportedDeclarations)
}

// Bootstrap and snapshot real production output, then compare every development declaration to it.
execFileSync('pnpm', ['turbo', 'run', 'build', '--filter=./packages/rrweb/**'], { cwd: root, stdio: 'pipe' })

for (const scenario of [...manifests, 'alternate', 'startup-error']) {
    const startupError = scenario === 'startup-error'
    const manifest = startupError ? 'packages/rrweb/types/package.json' : scenario
    const alternate = manifest === 'alternate'
    const cwd = path.join(root, alternate ? 'packages/rrweb/rrweb' : path.dirname(manifest))
    const pkg = alternate ? undefined : JSON.parse(readFileSync(path.join(root, manifest)))
    const name = alternate ? 'alternate' : startupError ? 'startup-error' : pkg.name
    test(`${name}: initial declarations, edits, recovery, and graceful shutdown`, { timeout: 120_000 }, async (t) => {
        if (alternate) {
            execFileSync('pnpm', ['exec', 'vite', 'build', '--config', 'vite.config.entries.js'], {
                cwd,
                stdio: 'pipe',
            })
        }
        const extraOriginals = []
        const source = path.join(cwd, alternate ? 'src/entries/record.ts' : 'src/index.ts')
        const probe = path.join(cwd, 'src/watch-probe.ts')
        const original = readFileSync(source, 'utf8')
        const declarationFiles = alternate
            ? ['dist/rrweb-record.d.ts', 'dist/rrweb-replay.d.ts']
            : [...new Set([(pkg.typings ?? pkg.types).replace(/^\.\//, ''), ...exportedDeclarations(pkg.exports)])]
        const baseline = declarationFiles.map((file) => [file, readFileSync(path.join(cwd, file), 'utf8')])
        const logPath = path.join(logs, name.replaceAll('/', '-') + '.log')
        t.diagnostic(logPath)
        const fd = openSync(logPath, 'w')
        if (startupError) writeFileSync(source, original + `\nexport const ${marker}: = ;\n`)
        const started = Date.now()
        const child = fork(
            path.join(root, 'scripts/fixtures/rrweb-watch/runner.mjs'),
            [alternate ? 'vite.config.entries.js' : globSync('vite.config.{ts,js}', { cwd })[0], '--watch'],
            { cwd, stdio: ['ignore', fd, fd, 'ipc'] }
        )
        closeSync(fd)
        let builds = 0
        let building = true
        child.on('message', (message) => {
            building = message !== 'built'
            if (message === 'built') builds++
        })
        let exit
        const exited = new Promise((resolve) =>
            child.once('exit', (code, signal) => {
                exit = { code, signal }
                resolve(exit)
            })
        )
        const content = (file) => readFileSync(path.join(cwd, file), 'utf8')
        async function until(description, predicate) {
            const deadline = Date.now() + 30_000
            while (Date.now() < deadline) {
                assert.equal(exit, undefined, JSON.stringify(exit))
                try {
                    if (!building && predicate()) return
                } catch (error) {
                    if (error.code !== 'ENOENT') throw error
                }
                await delay(100)
            }
            assert.fail(`${description}\n${readFileSync(logPath, 'utf8').slice(-8000)}`)
        }
        const pairsMatch = () =>
            declarationFiles.every((file) => content(file) === content(file.replace(/\.d\.ts$/, '.d.cts')))
        try {
            if (startupError) {
                await until('startup generation error', () =>
                    readFileSync(logPath, 'utf8').includes('Unexpected token')
                )
                writeFileSync(source, original)
            }
            await until(
                'initial output',
                () =>
                    builds > 0 &&
                    declarationFiles.every((file) => statSync(path.join(cwd, file)).mtimeMs >= started) &&
                    pairsMatch()
            )
            for (const [file, expected] of baseline) assert.equal(content(file), expected, file)
            writeFileSync(probe, 'export interface WatchProbe { first: string }\n')
            writeFileSync(
                source,
                original +
                    `\nexport type { WatchProbe } from '${alternate ? '../' : './'}watch-probe';\nexport const ${marker}: string = 'first';\n`
            )
            const primary = alternate ? 'dist/rrweb-record.d.ts' : (pkg.typings ?? pkg.types)
            const runtime = alternate ? ['dist/rrweb-record.js', 'dist/rrweb-record.cjs'] : [pkg.module, pkg.main]
            await until(
                'runtime and declaration export',
                () =>
                    runtime.every((file) => content(file).includes(marker)) &&
                    content(primary).includes(marker) &&
                    content(primary).includes('first: string') &&
                    pairsMatch()
            )
            writeFileSync(probe, 'export interface WatchProbe { second: number }\n')
            await until('type-only dependency edit', () => content(primary).includes('second: number') && pairsMatch())
            // Exercise secondary entries and the declaration-only shim, not just the main export.
            const extra =
                name === '@posthog/rrweb-packer'
                    ? ['src/pack.ts', 'dist/pack.d.ts']
                    : name === '@posthog/rrweb-snapshot'
                      ? ['src/record.ts', 'dist/record.d.ts']
                      : alternate
                        ? ['src/entries/replay.ts', 'dist/rrweb-replay.d.ts']
                        : name === '@posthog/rrweb-plugin-canvas-webrtc-record'
                          ? ['src/simple-peer-light.d.ts', 'dist/simple-peer-light.d.ts']
                          : undefined
            if (extra) {
                const file = path.join(cwd, extra[0])
                const original = readFileSync(file, 'utf8')
                extraOriginals.push([file, original])
                writeFileSync(
                    file,
                    original +
                        `\n${file.endsWith('.d.ts') ? '' : 'export '}interface SecondaryWatchProbe { value: string }\n`
                )
                await until(
                    'secondary declaration edit',
                    () => content(extra[1]).includes('SecondaryWatchProbe') && pairsMatch()
                )
                writeFileSync(file, original)
                await until(
                    'secondary declaration recovery',
                    () => !content(extra[1]).includes('SecondaryWatchProbe') && pairsMatch()
                )
            }
            if (name === '@posthog/rrweb-types') {
                const offset = readFileSync(logPath, 'utf8').length
                writeFileSync(source, original + `\nexport const ${marker}: number = 'invalid';\n`)
                await until('semantic diagnostic', () => readFileSync(logPath, 'utf8').slice(offset).includes('TS2322'))
                writeFileSync(source, original + `\nexport const ${marker}: = ;\n`)
                await until('declaration generation error', () =>
                    readFileSync(logPath, 'utf8').slice(offset).includes('Unexpected token')
                )
            }
            writeFileSync(source, original)
            await until(
                'recovery',
                () =>
                    !content(primary).includes(marker) &&
                    runtime.every((file) => !content(file).includes(marker)) &&
                    pairsMatch()
            )
            for (const [file, expected] of baseline) assert.equal(content(file), expected, file)
        } finally {
            writeFileSync(source, original)
            for (const [file, original] of extraOriginals) writeFileSync(file, original)
            rmSync(probe, { force: true })
            if (child.connected) child.send('close')
            const result = await Promise.race([exited, delay(5000, undefined, { ref: false })])
            if (!result) child.kill('SIGKILL')
            await exited
            assert.deepEqual(result, { code: 0, signal: null }, `watcher leaked handles or failed; ${logPath}`)
        }
    })
}
