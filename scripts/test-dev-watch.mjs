// oxlint-disable compat/compat -- Node-only build test, not SDK runtime
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const marker = 'devWatchSmokeProbe'
const sources = [
    'packages/browser/src/entrypoints/module.es.ts',
    'packages/browser/src/entrypoints/module.slim.no-external.es.ts',
    'packages/rrweb/record/src/index.ts',
]
const outputs = [
    'packages/browser/dist/module.js',
    'packages/browser/dist/module.mjs',
    'packages/browser/dist/module.d.ts',
    'packages/browser/dist/module.slim.no-external.js',
    'packages/browser/dist/module.slim.no-external.d.ts',
    'packages/rrweb/record/dist/rrweb-record.js',
    'packages/rrweb/record/dist/rrweb-record.cjs',
    'packages/rrweb/record/dist/index.d.ts',
    'packages/rrweb/record/dist/index.d.cts',
]

function startWatcher(name, cwd, logs) {
    const logPath = join(logs, `${name}.log`)
    const fd = openSync(logPath, 'w')
    const child = spawn('pnpm', ['dev'], {
        cwd: join(root, cwd),
        env: { ...process.env, ...(name === 'browser' ? { ENTRY: 'module' } : {}) },
        detached: true,
        stdio: ['ignore', fd, fd],
    })
    closeSync(fd)
    const watcher = { child, logPath, failure: undefined }
    watcher.exited = new Promise((resolve) => {
        child.once('error', (error) => {
            watcher.failure = `${name}: ${error.message}`
            resolve()
        })
        child.once('exit', (code, signal) => {
            watcher.failure = `${name} exited with code ${code}, signal ${signal}`
            resolve()
        })
    })
    return watcher
}

function signalGroup(watcher, signal) {
    if (!watcher.child.pid) return
    try {
        // pnpm launches shells and nested bundlers, so terminate the whole process group.
        process.kill(-watcher.child.pid, signal)
    } catch (error) {
        if (error.code !== 'ESRCH') throw error
    }
}

async function stopWatcher(watcher) {
    signalGroup(watcher, 'SIGTERM')
    await Promise.race([watcher.exited, delay(5000, undefined, { ref: false })])
    signalGroup(watcher, 'SIGKILL')
    await watcher.exited
}

async function waitForOutputs(watchers, description, matches) {
    const deadline = Date.now() + 120_000
    let pending = outputs
    while (Date.now() < deadline) {
        for (const watcher of watchers) {
            assert.equal(watcher.failure, undefined, watcher.failure)
        }
        pending = outputs.filter((file) => {
            try {
                return !matches(join(root, file))
            } catch (error) {
                if (error.code === 'ENOENT') return true
                throw error
            }
        })
        if (pending.length === 0) return
        await delay(250)
    }
    assert.fail(`${description}: outputs did not update within 120 seconds:\n${pending.join('\n')}`)
}

test('development watchers rebuild runtime bundles and declarations after source edits', async (t) => {
    const logs = mkdtempSync(join(tmpdir(), 'posthog-dev-watch-'))
    const originals = sources.map((file) => [join(root, file), readFileSync(join(root, file))])
    const watchers = []
    t.diagnostic(`Watcher logs: ${logs}`)
    try {
        const started = Date.now()
        watchers.push(startWatcher('browser', 'packages/browser', logs))
        watchers.push(startWatcher('record', 'packages/rrweb/record', logs))
        await waitForOutputs(watchers, 'Initial build', (file) => statSync(file).mtimeMs >= started)

        for (const [file, original] of originals) {
            writeFileSync(
                file,
                Buffer.concat([original, Buffer.from(`\nexport const ${marker}: string = 'watch-test';\n`)])
            )
        }
        await waitForOutputs(watchers, 'Adding an export', (file) => readFileSync(file, 'utf8').includes(marker))
        assert.equal(
            readFileSync(join(root, 'packages/rrweb/record/dist/index.d.ts'), 'utf8'),
            readFileSync(join(root, 'packages/rrweb/record/dist/index.d.cts'), 'utf8')
        )

        for (const [file, original] of originals) writeFileSync(file, original)
        await waitForOutputs(watchers, 'Removing an export', (file) => {
            const content = readFileSync(file, 'utf8')
            return content.length > 0 && !content.includes(marker)
        })
    } catch (error) {
        for (const watcher of watchers) {
            t.diagnostic(`${watcher.logPath}:\n${readFileSync(watcher.logPath, 'utf8').slice(-8000)}`)
        }
        throw error
    } finally {
        try {
            for (const [file, original] of originals) {
                if (!readFileSync(file).equals(original)) writeFileSync(file, original)
            }
        } finally {
            await Promise.all(watchers.map(stopWatcher))
        }
    }
})
