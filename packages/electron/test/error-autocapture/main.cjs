const assert = require('node:assert/strict')
const { writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { setTimeout: delay } = require('node:timers/promises')
const { app, BrowserWindow, session } = require('electron')
const { init } = require('@posthog/electron/main')

app.setPath('userData', process.env.FIXTURE_USER_DATA)
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-component-update')
const enabled = process.env.FIXTURE_ENABLED === 'true'
const hostEvents = []
const warnings = []
process.on('warning', (warning) => warnings.push(warning.name))
// Application-owned recovery is intentional: the SDK must not add one or change it.
const host = (error, origin) => hostEvents.push({ message: error.message, origin })
process.on('uncaughtException', host)
const originals = {
    monitors: process.rawListeners('uncaughtExceptionMonitor'),
    uncaught: process.rawListeners('uncaughtException'),
    rejection: process.rawListeners('unhandledRejection'),
    exit: process.exit,
    quit: app.quit,
}
const posthog = init({
    projectToken: 'phc_electron_error_fixture',
    host: process.env.FIXTURE_HOST,
    storageDirectory: join(process.env.FIXTURE_USER_DATA, 'analytics'),
    enableExceptionAutocapture: enabled,
    captureAppLifecycleEvents: false,
    preloadFeatureFlags: false,
    disableRemoteFeatureFlags: true,
    flushInterval: 0,
    flushAt: 100,
    disableCompression: true,
    fetchRetryCount: 0,
})

async function waitFor(label, check) {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
        if (await check()) return
        await delay(20)
    }
    throw new Error(`Timed out: ${label}`)
}
async function evaluate(window, fn, ...args) {
    return window.webContents.executeJavaScript(`(${fn.toString()})(window.errorFixture, ...${JSON.stringify(args)})`)
}
function triggerMain(label) {
    setTimeout(function mainThrow() {
        throw new TypeError(`main ${label} throw`)
    }, 0)
    setTimeout(function mainRejection() {
        void Promise.reject(new RangeError(`main ${label} rejection`))
    }, 0)
}

app.whenReady()
    .then(async () => {
        const unexpectedNetwork = []
        const filter = (details, callback) => {
            const url = new URL(details.url)
            const allowed = url.protocol === 'file:' || url.origin === process.env.FIXTURE_HOST
            if (!allowed) unexpectedNetwork.push(details.url)
            callback({ cancel: !allowed })
        }
        session.defaultSession.webRequest.onBeforeRequest(filter)
        session.fromPartition('posthog-electron').webRequest.onBeforeRequest(filter)
        await posthog.ready()
        assert.deepEqual(process.rawListeners('uncaughtException'), originals.uncaught)
        assert.deepEqual(process.rawListeners('unhandledRejection'), originals.rejection)
        assert.equal(process.exit, originals.exit)
        assert.equal(app.quit, originals.quit)
        assert.equal(
            process.rawListeners('uncaughtExceptionMonitor').length,
            originals.monitors.length + Number(enabled)
        )
        assert.equal(
            originals.rejection.length,
            0,
            'fixture must exercise native rejection escalation, not a host rejection handler'
        )
        await posthog.identify('electron-error-user')
        const page = join(__dirname, 'index.html')
        const window = new BrowserWindow({
            show: false,
            webPreferences: {
                preload: require.resolve('@posthog/electron/preload'),
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
            },
        })
        posthog.registerWindow(window, { allowedUrls: [pathToFileURL(page).href + `?enabled=${enabled}`] })
        await window.loadFile(page, { query: { enabled: String(enabled) } })
        await window.webContents.executeJavaScript('window.fixtureReady')
        assert.equal(await evaluate(window, () => typeof require), 'undefined')
        const preferences = window.webContents.getLastWebPreferences()
        assert.equal(preferences.sandbox, true)
        assert.equal(preferences.contextIsolation, true)
        assert.equal(preferences.nodeIntegration, false)
        await posthog.captureException(new SyntaxError('main manual'))
        triggerMain('initial')
        await evaluate(window, (fixture) => fixture.trigger('initial'))
        await waitFor('actual initial main throws/rejections', () => hostEvents.length === 1 && warnings.length === 2)
        await waitFor('actual initial renderer throws/rejections', () =>
            evaluate(window, (fixture) => fixture.hostEvents.length === 2)
        )
        await evaluate(window, (fixture) => fixture.posthog.flush())

        await evaluate(window, (fixture) => fixture.posthog.optOut())
        triggerMain('optedout')
        await evaluate(window, (fixture) => fixture.trigger('optedout'))
        await waitFor(
            'opted-out main still reaches app handlers',
            () => hostEvents.length === 2 && warnings.length === 4
        )
        await waitFor('opted-out renderer still reaches app handlers', () =>
            evaluate(window, (fixture) => fixture.hostEvents.length === 4)
        )
        await evaluate(window, (fixture) => fixture.posthog.flush())
        await evaluate(window, (fixture) => fixture.posthog.optIn())
        await evaluate(window, (fixture) => fixture.posthog.dispose())
        await evaluate(window, (fixture) => fixture.trigger('disposed'))
        await waitFor('disposed renderer still reaches app handlers', () =>
            evaluate(window, (fixture) => fixture.hostEvents.length === 6)
        )
        await evaluate(window, (fixture) => fixture.reinitialize())
        await evaluate(window, (fixture) => fixture.trigger('reinitialized'))
        await waitFor('reinitialized renderer receives real errors', () =>
            evaluate(window, (fixture) => fixture.hostEvents.length === 8)
        )
        await evaluate(window, (fixture) => fixture.posthog.flush())
        const renderer = await evaluate(window, (fixture) => ({
            hostEvents: fixture.hostEvents,
            dispatches: fixture.dispatches,
            ownsOnerror: fixture.ownsOnerror(),
        }))
        assert.equal(renderer.ownsOnerror, true)
        assert.equal(renderer.dispatches.length, 8)
        assert.ok(
            renderer.dispatches.every((event) => !event.prevented && event.trusted),
            'actual browser dispatch must remain uncancelled'
        )
        assert.deepEqual(
            hostEvents.map((event) => event.origin),
            ['uncaughtException', 'uncaughtException']
        )
        assert.deepEqual(warnings, Array(4).fill('UnhandledPromiseRejectionWarning'))
        await posthog.shutdown(2000)
        assert.deepEqual(process.rawListeners('uncaughtExceptionMonitor'), originals.monitors)
        assert.deepEqual(process.rawListeners('uncaughtException'), originals.uncaught)
        assert.deepEqual(process.rawListeners('unhandledRejection'), originals.rejection)
        assert.equal(process.exit, originals.exit)
        assert.equal(app.quit, originals.quit)
        assert.deepEqual(unexpectedNetwork, [])
        await writeFile(
            process.env.FIXTURE_REPORT,
            JSON.stringify({ enabled, hostEvents, warnings, renderer, unexpectedNetwork })
        )
        window.destroy()
        app.quit()
    })
    .catch(async (error) => {
        console.error(error)
        await posthog.shutdown(100)
        app.exit(1)
    })
