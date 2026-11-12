import { app, BrowserWindow, session } from 'electron'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import { writeSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { Binding, failure } from './binding.mjs'
import { mockOrigin } from './network-policy.mjs'

const consumer = process.env.POSTHOG_ELECTRON_CONSUMER
const require = createRequire(join(consumer, 'package.json'))
const { init } = require('@posthog/electron/main')
const profile = process.env.POSTHOG_ELECTRON_PROFILE
app.setPath('userData', process.env.POSTHOG_ELECTRON_USER_DATA)
app.on('window-all-closed', () => {})
let owner, window
const reply = (value) => writeSync(3, JSON.stringify(value) + '\n')
const diagnostic = (value) =>
    process.stderr.write((typeof value === 'string' ? value : String(value.stack ?? value)) + '\n')
const binding = new Binding(async (options) => {
    const origin = mockOrigin(options.host)
    // A network permission guard, not a replacement transport: allowed requests
    // still use the installed SDK's Electron session.fetch and the real mock server.
    session.fromPartition('posthog-electron').webRequest.onBeforeRequest((details, callback) => {
        const cancel = new URL(details.url).origin !== origin
        if (cancel) diagnostic(`Blocked non-mock SDK request: ${details.url}`)
        callback({ cancel })
    })
    owner = init(options)
    await owner.ready()
    if (profile === 'electron-main') return owner
    const page = join(consumer, 'acceptance-renderer', 'index.html')
    window = new BrowserWindow({
        show: false,
        webPreferences: {
            preload: require.resolve('@posthog/electron/preload'),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
        },
    })
    const deregister = owner.registerWindow(window, { allowedUrls: [pathToFileURL(page).href] })
    window.once('closed', deregister)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    await window.loadFile(page)
    const preferences = window.webContents.getLastWebPreferences()
    const unprivileged = await window.webContents.executeJavaScript(
        'typeof process === "undefined" && typeof require === "undefined"'
    )
    if (!preferences.sandbox || !preferences.contextIsolation || preferences.nodeIntegration || !unprivileged)
        throw new Error('Renderer security profile verification failed')
    diagnostic(
        JSON.stringify({
            renderer_security: {
                sandbox: preferences.sandbox,
                contextIsolation: preferences.contextIsolation,
                nodeIntegration: preferences.nodeIntegration,
                unprivileged,
            },
        })
    )
    // Host-only test controller. No additional preload API or privileged renderer bridge.
    const initialized = await window.webContents.executeJavaScript('globalThis.acceptance.invoke("/setup", {})')
    if (initialized.kind !== 'sdk' || initialized.outcome.kind !== 'void')
        throw new Error('Renderer initialization failed')
    return owner
}, profile)
let tail = Promise.resolve()
createInterface({ input: process.stdin }).on('line', (line) => {
    tail = tail.then(async () => {
        try {
            const { route, args, close } = JSON.parse(line)
            if (close) {
                await owner?.shutdown(5000)
                reply({ closed: true })
                app.exit(0)
            } else {
                if (route === '/setup' && !mockOrigin(args?.config?.host)) {
                    reply({
                        completion: failure(
                            'blocked_fixture',
                            'mock-host-required',
                            'An explicit private HTTP mock host and port are required'
                        ),
                    })
                    return
                }
                const completion =
                    profile === 'electron-renderer' && route !== '/setup' && window
                        ? await window.webContents.executeJavaScript(
                              `globalThis.acceptance.invoke(${JSON.stringify(route)}, ${JSON.stringify(args)})`
                          )
                        : await binding.invoke(route, args)
                reply({ completion })
            }
        } catch (error) {
            diagnostic(error)
            reply({ error: 'Electron fixture controller failed' })
        }
    })
})
void app
    .whenReady()
    .then(() =>
        reply({
            ready: true,
            runtime: {
                electron: process.versions.electron,
                chrome: process.versions.chrome,
                node: process.versions.node,
                type: process.type,
            },
        })
    )
    .catch((error) => {
        diagnostic(error)
        app.exit(1)
    })
