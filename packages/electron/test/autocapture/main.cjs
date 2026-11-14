const assert = require('node:assert/strict')
const http = require('node:http')
const { readFile, readdir } = require('node:fs/promises')
const { join } = require('node:path')
const { app, BrowserWindow, ipcMain, session } = require('electron')
const { init } = require('../../dist/main.cjs')

const directory = process.argv[2]
const bundle = process.argv[3]
app.setPath('userData', join(directory, 'user-data'))
app.on('window-all-closed', () => {})

const ipc = [],
    received = [],
    paths = [],
    network = [],
    errors = [],
    queuedDisk = []
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
    handle(channel, (event, request) => {
        if (channel === 'posthog:command:v1') ipc.push(JSON.stringify(request))
        return listener(event, request)
    })

const canary = 'ELECTRON_DOM_PRIVATE_CANARY'
const html = `<!doctype html><html><body>
<button id="safe">Save</button><input id="plain" value="${canary}">
<form id="form"><input value="${canary}"></form>
<div class="ph-no-capture"><button id="blocked">${canary}</button></div>
<div class="ph-sensitive"><button id="sensitive">${canary}</button></div>
<input id="password" type="password" value="${canary}">
<input id="email" name="email" value="private@example.com">
<button id="drop">Drop event</button><script src="/renderer.js"></script>
</body></html>`
let config = {
    autocapture_opt_out: false,
    elementsChainAsString: true,
    sessionRecording: { endpoint: 'UNSUPPORTED_CONFIG_CANARY' },
    surveys: [{ id: 'UNSUPPORTED_CONFIG_CANARY' }],
    productTours: true,
}
let hold = true,
    fail = false
const pending = []
const server = http.createServer(async (request, response) => {
    paths.push(request.url)
    if (request.url === '/array/test-token/config') {
        const reply = () => {
            response.writeHead(fail ? 500 : 200, { 'Content-Type': 'application/json' })
            response.end(JSON.stringify(config))
        }
        if (hold) pending.push(reply)
        else reply()
    } else if (request.url === '/renderer.js') {
        response.setHeader('Content-Type', 'application/javascript')
        response.end(await readFile(bundle))
    } else if (request.url.startsWith('/batch/')) {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        received.push(Buffer.concat(chunks).toString('utf8'))
        response.setHeader('Content-Type', 'application/json')
        response.end('{}')
    } else if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html')
        response.end(html)
    } else {
        response.writeHead(404).end()
    }
})

let owner, window
async function poll(predicate, label) {
    for (let attempt = 0; attempt < 200; attempt++) {
        if (await predicate()) return
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('Timed out: ' + label)
}
const js = (code) => window.webContents.executeJavaScript(code)
const captures = () => ipc.map((text) => JSON.parse(text)).filter(({ command }) => command.type === 'capture')
const events = () => received.flatMap((text) => JSON.parse(text).batch || [])

async function open(host, options) {
    window = new BrowserWindow({
        show: false,
        webPreferences: {
            preload: require.resolve('../../dist/preload.cjs'),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
        },
    })
    owner.registerWindow(window, { allowedUrls: [host + '/'] })
    await window.loadURL(host + '/')
    assert.equal(await js('typeof require'), 'undefined')
    assert.deepEqual(await js('Object.keys(window.__POSTHOG_ELECTRON__).sort()'), ['request', 'subscribe'])
    await js(`setup(${JSON.stringify(options)})`)
}

app.whenReady()
    .then(async () => {
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
        const host = `http://127.0.0.1:${server.address().port}`
        for (const transport of [session.defaultSession, session.fromPartition('posthog-electron')]) {
            transport.webRequest.onBeforeRequest((details, callback) => {
                network.push(details.url)
                callback({ cancel: !details.url.startsWith(host + '/') })
            })
        }
        const start = async (storage, extra = {}) => {
            owner = init({
                projectToken: 'test-token',
                host,
                storageDirectory: join(directory, storage),
                captureAppLifecycleEvents: false,
                preloadFeatureFlags: false,
                disableRemoteFeatureFlags: true,
                disableCompression: true,
                flushInterval: 0,
                fetchRetryCount: 0,
                onError: (error) => errors.push(String(error)),
                before_send: (event) =>
                    event.properties.$el_text === 'Drop event'
                        ? null
                        : { ...event, properties: { ...event.properties, hook_applied: true } },
                ...extra,
            })
            await owner.ready()
        }
        await start('enabled')
        await open(host, {})
        await js('interact(); posthog.flush()')
        assert.equal(captures().length, 0, 'default-off renderer must not autocapture')
        assert.equal(pending.length, 0, 'default-off renderer must not request config')
        window.destroy()

        await open(host, { autocapture: true })
        await poll(() => pending.length === 1, 'initial config request')
        await js('interact(); privateInteractions()')
        assert.equal(captures().length, 0, 'cold start must wait for config')
        hold = false
        pending.splice(0).forEach((reply) => reply())
        await poll(() => js('posthog.getState().autocapture.status === "loaded"'), 'loaded config')
        await js(
            'interact(); privateInteractions(); composedPrivateInteractions(); document.querySelector("#drop").click()'
        )
        await poll(() => captures().length >= 3, 'queued interactions')
        await owner._core.persist()
        for (const file of (await readdir(directory, { recursive: true })).filter((file) =>
            file.endsWith('state.json')
        )) {
            queuedDisk.push(await readFile(join(directory, file), 'utf8'))
        }
        await js('posthog.flush()')
        const accepted = events().filter((event) => event.event === '$autocapture')
        for (const type of ['click', 'change', 'submit'])
            assert(
                accepted.some((event) => event.properties.$event_type === type),
                type
            )
        assert(accepted.some((event) => event.properties.$el_text === 'Save'))
        assert(
            accepted.every(
                (event) =>
                    typeof event.properties.$elements_chain === 'string' && event.properties.hook_applied === true
            )
        )
        assert(
            !accepted.some((event) => event.properties.$el_text === 'Drop event'),
            'autocapture must use before_send'
        )
        assert(
            !captures().some(({ command }) => command.properties.$elements_chain.includes('blocked')),
            'no-capture marker'
        )

        const firstWindow = window
        const configBeforeSecond = paths.filter((path) => path === '/array/test-token/config').length
        await open(host, { autocapture: true })
        await js('posthog.flush()')
        assert.equal(
            paths.filter((path) => path === '/array/test-token/config').length,
            configBeforeSecond,
            'new window reuses loaded config'
        )
        const beforeTwoWindows = captures().length
        await js('document.querySelector("#safe").click(); posthog.flush()')
        await firstWindow.webContents.executeJavaScript('document.querySelector("#safe").click(); posthog.flush()')
        assert.equal(captures().length, beforeTwoWindows + 2, 'both windows continue capturing')
        window.destroy()
        window = firstWindow

        const beforeOut = captures().length
        await js(`(async () => {
        const out = posthog.optOut(); let reads = 0;
        const button = document.querySelector('#safe');
        const getter = Object.getOwnPropertyDescriptor(Element.prototype, 'attributes').get;
        Object.defineProperty(button, 'attributes', { configurable: true, get() { reads++; return getter.call(this) } });
        button.click(); delete button.attributes;
        if (reads) throw new Error('DOM serialized after optOut call');
        await out;
    })()`)
        assert.equal(captures().length, beforeOut)
        await js('posthog.optIn()')
        await poll(() => js('posthog.getState().autocapture.status === "loaded"'), 'opt-in config')
        await js(
            '(async () => { if (await repeatInit() !== posthog || await repeatInit() !== posthog) throw new Error("duplicate init"); document.querySelector("#safe").click(); await posthog.flush() })()'
        )
        assert.equal(captures().length, beforeOut + 1, 'no duplicate observers after opt-in/repeated init')

        const beforeReset = captures().length
        await js('posthog.reset()')
        await poll(() => js('posthog.getState().autocapture.status === "loaded"'), 'reset config')
        const generation = await js('posthog.getState().generation')
        await js('document.querySelector("#safe").click(); posthog.flush()')
        assert.equal(captures().length, beforeReset + 1)
        assert.equal(captures().at(-1).generation, generation)

        config = { autocapture_opt_out: true, elementsChainAsString: true }
        hold = true
        const refresh = owner._core.loadAutocaptureConfig(true)
        await poll(() => pending.length === 1, 'explicit warm refresh')
        const beforeRefresh = captures().length
        await js('document.querySelector("#safe").click(); posthog.flush()')
        assert.equal(captures().length, beforeRefresh + 1, 'warm refresh does not pause existing capture')
        hold = false
        pending.splice(0).forEach((reply) => reply())
        await refresh
        await js('posthog.reset()')
        await poll(() => js('posthog.getState().autocapture.autocapture_opt_out === true'), 'project kill switch')
        const beforeKill = captures().length
        await js('interact(); posthog.flush()')
        assert.equal(captures().length, beforeKill)
        window.destroy()
        await owner.shutdown(1000)

        // Cold restart from a persisted kill switch must stay off with delayed/failed config.
        hold = true
        fail = true
        await start('enabled')
        await open(host, { autocapture: true })
        await poll(() => pending.length === 1, 'restart config request')
        await js('interact()')
        assert.equal(captures().length, beforeKill)
        hold = false
        pending.splice(0).forEach((reply) => reply())
        await poll(() => js('posthog.getState().autocapture.status === "failed"'), 'failed config')
        await js('interact(); posthog.flush()')
        assert.equal(captures().length, beforeKill)
        const retryGeneration = await js('posthog.getState().generation')
        fail = false
        config = { autocapture_opt_out: false, elementsChainAsString: true }
        await poll(() => js('posthog.getState().autocapture.status === "loaded"'), 'same-generation config retry')
        assert.equal(await js('posthog.getState().generation'), retryGeneration)
        await js('document.querySelector("#safe").click(); posthog.flush()')
        assert.equal(captures().length, beforeKill + 1, 'connectivity recovery enables capture without reset')
        window.destroy()
        await owner.shutdown(1000)

        // Main explicitly disabling remote config is the only local-only bypass.
        const requestsBeforeBypass = paths.filter((path) => path === '/array/test-token/config').length
        const beforeBypass = captures().length
        await start('local-only', { disableRemoteConfig: true })
        await open(host, { autocapture: { maskAllText: true, maskAllElementAttributes: true } })
        await js('interact(); posthog.flush()')
        assert.equal(paths.filter((path) => path === '/array/test-token/config').length, requestsBeforeBypass)
        const masked = captures().slice(beforeBypass)
        assert.equal(masked.length, 3)
        assert(!JSON.stringify(masked).includes('Save'))
        assert(!JSON.stringify(masked).includes('attr__id'))
        const beforeDispose = captures().length
        await js('posthog.dispose(); interact()')
        await new Promise((resolve) => setTimeout(resolve, 30))
        assert.equal(captures().length, beforeDispose, 'dispose removes observers')
        window.destroy()
        await owner.shutdown(1000)

        assert(queuedDisk.join('\n').includes('Save'), 'disk privacy proof includes queued captures before delivery')
        const serialized = ipc.join('\n') + received.join('\n')
        assert(!serialized.includes(canary), 'sensitive canary must never enter IPC or received bytes')
        assert.deepEqual(
            {
                ipc: ipc.join('\n').includes('ELECTRON_COMPOSED_PRIVATE_CANARY'),
                network: received.join('\n').includes('ELECTRON_COMPOSED_PRIVATE_CANARY'),
                disk: queuedDisk.join('\n').includes('ELECTRON_COMPOSED_PRIVATE_CANARY'),
            },
            { ipc: false, network: false, disk: false },
            'composed-tree privacy across process and persistence boundaries'
        )
        assert(!serialized.includes('private@example.com'), 'sensitive email must never enter IPC or received bytes')
        assert(!serialized.includes('$input_value'), 'input values are excluded by default')
        assert(!serialized.includes('$snapshot'), 'no recorder events')
        assert(!paths.some((path) => /recorder|rrweb|surveys|flags/.test(path)), 'no unsupported-product requests')
        assert(
            network.every((url) => url.startsWith(host + '/')),
            'all requests must use local mock endpoints'
        )
        const files = await readdir(directory, { recursive: true })
        for (const file of files.filter((file) => file.endsWith('state.json'))) {
            const disk = await readFile(join(directory, file), 'utf8')
            assert(
                !disk.includes(canary) &&
                    !disk.includes('UNSUPPORTED_CONFIG_CANARY') &&
                    !disk.includes('ELECTRON_COMPOSED_PRIVATE_CANARY'),
                'private/unsupported data on disk'
            )
            assert(!disk.includes('sessionRecording') && !disk.includes('$snapshot'), 'no recorder state')
        }
        console.log(
            JSON.stringify({
                result: 'passed',
                runtime: process.versions.electron,
                sandbox: true,
                autocaptureEvents: events().filter((event) => event.event === '$autocapture').length,
                configRequests: paths.filter((path) => path === '/array/test-token/config').length,
                ipcRequests: ipc.length,
                sensitiveCanaryInIpcOrReceivedBytes: false,
                composedCanaryInIpcNetworkOrDisk: false,
                queuedDiskSnapshots: queuedDisk.length,
                recorderRequests: 0,
                expectedConfigFailures: errors.length,
            })
        )
        server.close()
        app.exit(0)
    })
    .catch(async (error) => {
        console.error(error, { paths, network, errors })
        window?.destroy()
        await owner?.shutdown(100)
        server.close()
        app.exit(1)
    })
