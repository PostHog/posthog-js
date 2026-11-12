import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

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
    for (const name of ['main.mjs', 'renderer.mjs', 'preload.cjs']) {
        assert.doesNotMatch(
            await readFile(new URL('dist/' + name, root), 'utf8'),
            /rrweb|recording\/|startSessionRecording|recorder\.js/
        )
    }
    const facade = await import(new URL('dist/renderer.mjs', root).href)
    assert.equal(typeof facade.init, 'function')
    assert.equal(typeof facade.PostHog.prototype.startSessionRecording, 'undefined')
})
