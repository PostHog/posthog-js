import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

// An opt-in POSIX development check for the one adopted package. Never timed.
assert.notEqual(process.platform, 'win32', 'This process-group cleanup check requires POSIX')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const cwd = join(root, 'packages/types')
const scratch = mkdtempSync(join(tmpdir(), 'native-typescript-watch-'))
const name = `__native_watch_trial_${process.pid}`
const source = join(cwd, 'src', `${name}.ts`)
const config = join(cwd, `.native-watch-trial-${process.pid}.mjs`)
const declaration = join(scratch, `${name}.d.ts`)
let child
let log = ''
let exited = false
function terminateGroup(pid, signal) {
    try {
        process.kill(-pid, signal)
    } catch (error) {
        if (error.code !== 'ESRCH') {
            process.stderr.write(`Watcher cleanup failed: ${error.message}\n`)
            process.exitCode = 1
        }
    }
}
async function until(check) {
    for (let i = 0; i < 120; i++) {
        if (check()) return
        if (exited) throw new Error(`Watcher exited early:\n${log}`)
        await delay(250)
    }
    throw new Error(`Watcher did not produce the expected update:\n${log}`)
}
const declares = (type) => existsSync(declaration) && readFileSync(declaration, 'utf8').includes(`value: ${type}`)
assert(!existsSync(source) && !existsSync(config), 'Temporary watch fixture already exists')
try {
    writeFileSync(source, "export const value: string = 'before'\n", { flag: 'wx' })
    writeFileSync(
        config,
        `import original from './rslib.config.ts'\nexport default {...original, output: {distPath: {root: ${JSON.stringify(scratch)}}}}\n`,
        { flag: 'wx' }
    )
    child = spawn('pnpm', ['exec', 'rslib', 'build', '--watch', '--config', config], {
        cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.on('error', (error) => {
        log += error.stack
        exited = true
    })
    child.on('exit', () => {
        exited = true
    })
    child.stdout.on('data', (data) => {
        log += data
    })
    child.stderr.on('data', (data) => {
        log += data
    })
    await until(() => declares('string'))
    // Let both ESM and CJS initial builds settle before editing.
    await delay(1000)
    writeFileSync(source, 'export const value: number = 123\n')
    await until(() => declares('number'))
    await delay(1000)
    const beforeError = log.length
    writeFileSync(source, 'export const value: string = 123\n')
    await until(() => log.slice(beforeError).includes('TS2322'))
    writeFileSync(source, "export const value: string = 'recovered'\n")
    await until(() => declares('string'))
    process.stdout.write('Native types watch: initial emit, declaration update, semantic error, and recovery passed.\n')
} finally {
    if (child?.pid) {
        terminateGroup(child.pid, 'SIGTERM')
        await delay(500)
        terminateGroup(child.pid, 'SIGKILL')
    }
    rmSync(source, { force: true })
    rmSync(config, { force: true })
    rmSync(scratch, { recursive: true, force: true })
}
