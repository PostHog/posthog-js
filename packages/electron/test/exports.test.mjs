import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

test('Electron stays outside stable releases and private until the alpha release path exists', async () => {
    const workspace = new URL('../../', root)
    const require = createRequire(new URL('package.json', workspace))
    const getReleasePlan = createRequire(require.resolve('@changesets/cli/package.json'))(
        '@changesets/get-release-plan'
    ).default
    const plan = await getReleasePlan(fileURLToPath(workspace))
    for (const release of plan.releases.filter(({ name }) => name === manifest.name)) {
        assert.equal(release.type, 'none')
        assert.equal(release.newVersion, manifest.version)
    }
    const config = JSON.parse(await readFile(new URL('.changeset/config.json', workspace), 'utf8'))
    assert.ok(config.ignore.includes(manifest.name))
    for (const file of await readdir(new URL('.changeset/', workspace))) {
        if (!file.endsWith('.md') || file === 'README.md') continue
        const changeset = await readFile(new URL('.changeset/' + file, workspace), 'utf8')
        assert.ok(!changeset.split('---')[1]?.includes(manifest.name), file)
    }
    const stable = await readFile(new URL('.github/workflows/release.yml', workspace), 'utf8')
    assert.doesNotMatch(stable, /name: ['"]?@posthog\/electron/)
    if (manifest.private) {
        assert.equal(manifest.private, true)
    } else {
        const workflow = await readFile(new URL('.github/workflows/release-electron-alpha.yml', workspace), 'utf8')
        assert.equal(manifest.publishConfig.tag, 'alpha')
        assert.equal(manifest.publishConfig.registry, 'https://registry.npmjs.org')
        assert.match(workflow, /workflow_dispatch:/)
        assert.doesNotMatch(workflow, /^ {4}(push|pull_request|pull_request_target):/m)
        assert.match(workflow, /if: inputs.publish == true/)
        assert.match(workflow, /environment: Electron Alpha NPM/)
    }
})

test('every published process export has runtime code and declarations', async () => {
    for (const entry of Object.values(manifest.exports)) {
        for (const path of Object.values(entry)) await access(new URL(path, root))
    }
    const require = createRequire(new URL('package.json', root))
    assert.equal(require.resolve('@posthog/electron/preload'), fileURLToPath(new URL('dist/preload.cjs', root)))
})

test('standalone preload requires only electron and strips privileged IPC event objects', async () => {
    const source = await readFile(new URL('dist/preload.cjs', root), 'utf8')
    let bridge
    let listener
    let removed = false
    vm.runInNewContext(source, {
        exports: {},
        require: (name) => {
            assert.equal(name, 'electron', 'sandboxed preload must be self-contained')
            return {
                contextBridge: {
                    exposeInMainWorld: (key, value) => {
                        assert.equal(key, '__POSTHOG_ELECTRON__')
                        bridge = value
                    },
                },
                ipcRenderer: {
                    invoke: async (channel, request) => ({ channel, request }),
                    on: (_channel, callback) => {
                        listener = callback
                    },
                    removeListener: (_channel, callback) => {
                        removed = callback === listener
                    },
                },
            }
        },
    })
    assert.deepEqual(Object.keys(bridge).sort(), ['request', 'subscribe'])
    const result = await bridge.request({ command: { type: 'hello' } })
    assert.equal(result.channel, 'posthog:command:v1')
    let received
    const unsubscribe = bridge.subscribe((...args) => {
        received = args
    })
    const state = { distinctId: 'user' }
    listener({ sender: { privileged: true } }, state)
    assert.deepEqual(received, [state])
    unsubscribe()
    assert.equal(removed, true)
})

test('renderer has no Node/Electron imports and no recorder code is delivered', async () => {
    const renderer = await readFile(new URL('dist/renderer.mjs', root), 'utf8')
    assert.doesNotMatch(renderer, /from ['"](?:electron|node:|fs['"]|path['"])/)
    for (const name of ['main.mjs', 'renderer.mjs', 'utility.mjs', 'preload.cjs']) {
        assert.doesNotMatch(
            await readFile(new URL('dist/' + name, root), 'utf8'),
            /rrweb|recording\/|startSessionRecording|recorder\.js/
        )
    }
    const utility = await readFile(new URL('dist/utility.mjs', root), 'utf8')
    assert.doesNotMatch(utility, /posthog-node|posthog-js|__POSTHOG_ELECTRON__|ipcRenderer/)
    const utilityFacade = await import(new URL('dist/utility.mjs', root).href)
    assert.deepEqual(Object.keys(utilityFacade).sort(), ['PostHog', 'init'])
    assert.equal(typeof utilityFacade.PostHog.prototype.startSessionRecording, 'undefined')
    assert.throws(() => new utilityFacade.PostHog(), /utilityProcess.parentPort/)
    const facade = await import(new URL('dist/renderer.mjs', root).href)
    assert.equal(typeof facade.init, 'function')
    assert.equal(typeof facade.PostHog.prototype.startSessionRecording, 'undefined')
})

test('utility facade imports and captures handled errors in ordinary Node without browser globals', () => {
    const source = `
        import assert from 'node:assert/strict'
        import { EventEmitter } from 'node:events'
        assert.equal(typeof window, 'undefined')
        assert.equal(typeof document, 'undefined')
        const requests = []
        const port = new EventEmitter()
        const state = { revision: 1, generation: 0, flagRevision: 0, distinctId: 'node-user', anonymousId: 'anon', sessionId: 'session', optedOut: false, featureFlags: {}, featureFlagPayloads: {} }
        port.postMessage = (message) => queueMicrotask(() => {
            const base = { channel: 'posthog:utility:v1', version: 1, token: 'fixture-token' }
            if (message.kind === 'connect') port.emit('message', { data: { ...base, kind: 'connected' } })
            else {
                requests.push(message.request)
                port.emit('message', { data: { ...base, kind: 'response', sequence: message.request.sequence, response: { ok: true, state } } })
            }
        })
        process.parentPort = port
        const { init } = await import(${JSON.stringify(new URL('dist/utility.mjs', root).href)})
        const client = await init()
        try {
            await client.captureException(new TypeError('ordinary Node utility proof'), { source: 'node-test' })
            await client.flush()
            assert.deepEqual(requests.map(({ command }) => command.type), ['hello', 'exception', 'flush'])
            assert.deepEqual(requests.map(({ sequence }) => sequence), [1, 2, 3])
            const properties = requests[1].command.properties
            assert.equal(properties.source, 'node-test')
            assert.equal(properties.$exception_list[0].type, 'TypeError')
            assert.equal(properties.$exception_list[0].value, 'ordinary Node utility proof')
            assert.equal(properties.$exception_list[0].mechanism.handled, true)
            assert.equal(typeof window, 'undefined')
        } finally { client.dispose() }
        assert.equal(port.listenerCount('message'), 0)
    `
    execFileSync(process.execPath, ['--input-type=module', '-e', source], { timeout: 10_000, stdio: 'pipe' })
})
