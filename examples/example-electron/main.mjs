import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { init } from '@posthog/electron/main'
import { mockToken, startMockServer } from './mock-server.mjs'
import {
    assertRuntimeFixture,
    fixtureAllowedUrl,
    fixtureWindowOptions,
    loadFixtureWindow,
} from './fixtures/runtime.mjs'

const require = createRequire(import.meta.url)
const indexHtml = fileURLToPath(new URL('./index.html', import.meta.url))
const smokeTest = process.argv.includes('--smoke-test')
let posthog
let mockServer
let quitting = false

// Set this before ready so the smoke test never reads or changes the user's app data.
if (smokeTest) {
    if (!process.env.ELECTRON_EXAMPLE_USER_DATA || !process.env.ELECTRON_EXAMPLE_MOCK_HOST) {
        throw new Error('Run smoke tests with pnpm test, which supplies temporary storage and a mock host')
    }
    app.setPath('userData', process.env.ELECTRON_EXAMPLE_USER_DATA)
}

function createWindow(index = 0) {
    const window = new BrowserWindow({
        width: 1000,
        height: 900,
        show: !smokeTest,
        webPreferences: {
            preload: require.resolve('@posthog/electron/preload'),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            ...(smokeTest ? fixtureWindowOptions(index) : {}),
        },
    })
    const deregister = posthog.registerWindow(window, { allowedUrls: [fixtureAllowedUrl()] })
    window.once('closed', deregister)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    return window
}

app.on('window-all-closed', () => app.quit())
app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void (async () => {
        try {
            await posthog?.shutdown(5000)
            await mockServer?.close()
            app.quit()
        } catch (error) {
            console.error(error)
            app.exit(1)
        }
    })()
})

async function main() {
    await app.whenReady()
    let projectToken = process.env.POSTHOG_PROJECT_TOKEN
    let host = process.env.POSTHOG_HOST
    if (smokeTest) {
        // Deliberately ignore live credentials in smoke mode.
        projectToken = mockToken
        host = process.env.ELECTRON_EXAMPLE_MOCK_HOST
    } else if (!projectToken) {
        mockServer = await startMockServer({
            onEvent: (event) => console.log('[mock receiver]', event.event, event.properties),
        })
        projectToken = mockToken
        host = mockServer.host
        console.log(`Mock mode: events stay on ${host}; no PostHog credentials required.`)
    }

    // One main-process owner, initialized before creating any BrowserWindow.
    posthog = init({
        projectToken,
        ...(host ? { host } : {}),
        captureAppLifecycleEvents: true,
        preloadFeatureFlags: true,
        defaultOptIn: true,
        flushInterval: smokeTest ? 0 : 10000,
        requestTimeout: 5000,
        fetchRetryCount: 0,
    })
    await posthog.ready()
    posthog.capture('electron_main_startup', { example: 'electron' })

    if (smokeTest) {
        const { runSmokeDriver } = await import('./smoke-driver.mjs')
        const windows = [createWindow(0), createWindow(1)]
        // Session protocol registration is serialized when windows share a session.
        for (const window of windows) await loadFixtureWindow(window)
        await runSmokeDriver(windows, posthog)
        await assertRuntimeFixture(windows)
        await posthog.flush()
        await posthog.shutdown(5000)
        quitting = true
        app.exit(0)
    } else {
        const window = createWindow()
        await window.loadFile(indexHtml)
    }
}

void main().catch(async (error) => {
    console.error(error)
    await mockServer?.close()
    app.exit(1)
})
