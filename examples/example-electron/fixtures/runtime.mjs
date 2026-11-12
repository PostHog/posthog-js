import assert from 'node:assert/strict'
import { app, protocol, session } from 'electron'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const fixture = process.argv.find((argument) => argument.startsWith('--fixture='))?.split('=')[1]
const profiles = ['composed', 'scheme', 'partitions', 'platform']
if (fixture && (!process.argv.includes('--smoke-test') || !profiles.includes(fixture))) {
    throw new Error(`Unknown or non-smoke fixture: ${fixture}`)
}
const enabled = (name) => fixture === name || fixture === 'platform'
const scheme = 'posthog-fixture'
const schemeUrl = `${scheme}://app/index.html`
const indexHtml = fileURLToPath(new URL('../index.html', import.meta.url))
const assets = new Map([
    ['/index.html', [indexHtml, 'text/html']],
    ['/styles.css', [fileURLToPath(new URL('../styles.css', import.meta.url)), 'text/css']],
    ['/dist/renderer.js', [fileURLToPath(new URL('../dist/renderer.js', import.meta.url)), 'text/javascript']],
])

// Scheme privileges must be declared before ready; handlers belong to each session.
if (enabled('scheme')) {
    protocol.registerSchemesAsPrivileged([
        { scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    ])
}

export function fixtureWindowOptions(index) {
    return {
        ...(enabled('composed')
            ? { preload: fileURLToPath(new URL('../dist/composed-preload.cjs', import.meta.url)) }
            : {}),
        ...(enabled('partitions')
            ? { partition: index === 0 ? 'persist:posthog-fixture' : 'posthog-fixture-memory' }
            : {}),
    }
}

export function fixtureAllowedUrl() {
    return enabled('scheme') ? schemeUrl : pathToFileURL(indexHtml).href
}

export async function loadFixtureWindow(window) {
    if (enabled('scheme')) {
        const windowProtocol = window.webContents.session.protocol
        if (!(await windowProtocol.isProtocolHandled(scheme))) {
            windowProtocol.handle(scheme, async (request) => {
                const url = new URL(request.url)
                const asset = url.host === 'app' && assets.get(url.pathname)
                if (!asset) return new Response('Not found', { status: 404 })
                return new Response(await readFile(asset[0]), { headers: { 'Content-Type': asset[1] } })
            })
        }
        await window.loadURL(schemeUrl)
    } else {
        await window.loadFile(indexHtml)
    }
}

export async function assertRuntimeFixture(windows) {
    if (process.env.ELECTRON_EXAMPLE_PACKAGER) {
        assert.equal(app.isPackaged, true, 'must execute the packaged application, not electron .')
        assert.match(app.getAppPath(), /[\\/]app\.asar$/, 'packager must ship an ASAR app')
    }
    for (const window of windows) {
        if (enabled('composed')) {
            assert.deepEqual(
                await window.webContents.executeJavaScript('window.applicationFixture'),
                { name: 'composed-sandbox-preload', version: 1 },
                'the application preload must coexist with the SDK bridge'
            )
        }
        if (enabled('scheme')) {
            assert.equal(window.webContents.getURL(), schemeUrl)
            assert.equal(await window.webContents.executeJavaScript('window.isSecureContext'), true)
            assert.equal(
                await window.webContents.executeJavaScript(
                    'document.querySelector(\'meta[http-equiv="Content-Security-Policy"]\').content.includes("connect-src \'none\'")'
                ),
                true
            )
        }
    }
    if (enabled('partitions')) {
        const [persistent, memory] = windows.map((window) => window.webContents.session)
        assert.notEqual(persistent, session.defaultSession)
        assert.notEqual(memory, session.defaultSession)
        assert.notEqual(persistent, memory)
        assert.equal(persistent.isPersistent(), true)
        assert.equal(memory.isPersistent(), false)
        const url = 'https://partition.fixture.invalid'
        await persistent.cookies.set({ url, name: 'partition-probe', value: 'persistent' })
        assert.equal((await persistent.cookies.get({ url }))[0].value, 'persistent')
        assert.deepEqual(await memory.cookies.get({ url }), [])
        assert.deepEqual(await session.defaultSession.cookies.get({ url }), [])
    }
    if (fixture) console.log(`Runtime fixture passed: ${fixture}`)
}
