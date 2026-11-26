import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Exercise the actual host controller and Binding; Electron platform operations are controlled, not native proof.
async function controller(t, stage = '') {
    const directory = await mkdtemp(join(tmpdir(), 'electron-controller-'))
    const sdk = join(directory, 'node_modules', '@posthog', 'electron')
    await mkdir(sdk, { recursive: true })
    await writeFile(join(directory, 'package.json'), '{}')
    await writeFile(
        join(sdk, 'package.json'),
        JSON.stringify({ exports: { './main': './main.cjs', './preload': './preload.cjs' } })
    )
    if (stage !== 'preload') await writeFile(join(sdk, 'preload.cjs'), '')
    await writeFile(
        join(sdk, 'main.cjs'),
        `exports.init = () => {
        if (${JSON.stringify(stage)} === 'native-init') throw new TypeError('native init failure');
        return { ready: async () => { if (${JSON.stringify(stage)} === 'native-ready') throw new TypeError('native ready failure') }, registerWindow: () => () => {}, shutdown: async () => {} }
    }`
    )
    const platform = join(directory, 'platform.mjs')
    await writeFile(
        platform,
        `
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
export const app = { setPath() {}, on() {}, whenReady: async () => {}, exit: (code) => process.exit(code) };
export const session = { fromPartition: () => ({ webRequest: { onBeforeRequest() {} } }) };
export class BrowserWindow extends EventEmitter {
    constructor() {
        super();
        const stage = ${JSON.stringify(stage)};
        this.webContents = {
            setWindowOpenHandler() {}, on() {},
            getLastWebPreferences: () => ({ sandbox: stage !== 'security', contextIsolation: true, nodeIntegration: false }),
            executeJavaScript: async (script) => runInNewContext(script, { acceptance: { invoke: async (route, args) => {
                if (route === '/setup') {
                    if (stage === 'renderer-controller') throw new Error('missing renderer script');
                    if (stage === 'renderer-native') return { kind: 'sdk', outcome: { kind: 'thrown', error: { kind: 'exception', id: 'native-renderer' } } };
                    return { kind: 'sdk', outcome: { kind: 'void' } };
                }
                return { kind: 'sdk', outcome: { kind: 'value', value: args } };
            } } })
        };
    }
    async loadFile() { if (${JSON.stringify(stage)} === 'page') throw new Error('page load failed') }
}
`
    )
    const loader = join(directory, 'loader.mjs')
    await writeFile(
        loader,
        `export async function resolve(specifier, context, next) {
        return specifier === 'electron' ? { url: ${JSON.stringify(pathToFileURL(platform).href)}, shortCircuit: true } : next(specifier, context)
    }`
    )
    const child = spawn(
        process.execPath,
        ['--loader', loader, fileURLToPath(new URL('./electron-main.mjs', import.meta.url))],
        {
            env: {
                ...process.env,
                POSTHOG_ELECTRON_CONSUMER: directory,
                POSTHOG_ELECTRON_PROFILE: 'electron-renderer',
                POSTHOG_ELECTRON_USER_DATA: directory,
            },
            stdio: ['pipe', 'ignore', 'pipe', 'pipe'],
        }
    )
    const lines = createInterface({ input: child.stdio[3] })[Symbol.asyncIterator]()
    child.stderr.resume()
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit')
            child.kill('SIGKILL')
            await exited
        }
        await rm(directory, { recursive: true, force: true })
    })
    assert.equal(JSON.parse((await lines.next()).value).ready, true)
    return async (route, args) => {
        child.stdin.write(JSON.stringify({ route, args }) + '\n')
        return JSON.parse((await lines.next()).value).completion
    }
}
const setup = { project_token: 'not-live', config: { host: 'http://127.0.0.1:12345' } }

test('renderer controller transfers own JSON __proto__ keys without object-literal semantics', async (t) => {
    const invoke = await controller(t)
    assert.equal((await invoke('/setup', setup)).outcome.kind, 'void')
    const args = JSON.parse(
        '{"event":"keys","properties":{"__proto__":{"canary":true},"constructor":"own","prototype":0}}'
    )
    const result = await invoke('/capture', args)
    assert.deepEqual(result.outcome.value, args)
    assert.equal(Object.hasOwn(result.outcome.value.properties, '__proto__'), true)
})
for (const stage of ['preload', 'page', 'security', 'renderer-controller']) {
    test(`renderer ${stage} setup failure is a fixture failure, not an SDK exception`, async (t) => {
        const invoke = await controller(t, stage)
        const result = await invoke('/setup', setup)
        assert.equal(result.kind, 'harness')
        assert.equal(result.failure.kind, 'blocked_fixture')
        assert.equal(result.failure.code, 'controller-setup')
    })
}
for (const stage of ['native-init', 'native-ready', 'renderer-native']) {
    test(`${stage} setup throws remain genuine SDK outcomes`, async (t) => {
        const invoke = await controller(t, stage)
        const result = await invoke('/setup', setup)
        assert.equal(result.kind, 'sdk')
        assert.equal(result.outcome.kind, 'thrown')
        if (stage === 'renderer-native') assert.equal(result.outcome.error.id, 'native-renderer')
    })
}
