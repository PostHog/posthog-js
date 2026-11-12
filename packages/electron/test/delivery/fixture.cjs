// Real Electron main process; all hosts and credentials are loopback test fixtures.
const { app, session } = require('electron')
const { createInterface } = require('node:readline')
const { init } = require('../../dist/main.cjs')
const config = JSON.parse(process.argv[2])
app.setPath('userData', config.userData)
app.disableHardwareAcceleration()
const send = (message) => process.stdout.write(`DELIVERY:${JSON.stringify(message)}\n`)
const errors = []
let owner

app.whenReady()
    .then(async () => {
        if (config.proxy) {
            await session.fromPartition('posthog-electron').setProxy({
                proxyRules: config.proxy,
                proxyBypassRules: '<-loopback>',
            })
        }
        if (config.proxyAuth) {
            app.on('login', (event, _contents, _details, authInfo, callback) => {
                if (!authInfo.isProxy || authInfo.host !== '127.0.0.1') return
                event.preventDefault()
                callback('fixture-user', 'fixture-password')
            })
        }
        let releaseStorage
        if (config.deferStorage) {
            const fs = require('node:fs').promises
            const mkdir = fs.mkdir.bind(fs)
            fs.mkdir = async (...args) => {
                if (String(args[0]).startsWith(config.storage)) {
                    await new Promise((resolve) => {
                        releaseStorage = resolve
                    })
                    fs.mkdir = mkdir
                }
                return mkdir(...args)
            }
        }
        owner = init({
            projectToken: 'delivery-fixture-token',
            host: config.host,
            storageDirectory: config.storage,
            preloadFeatureFlags: false,
            captureAppLifecycleEvents: false,
            flushInterval: 0,
            fetchRetryCount: 0,
            disableCompression: true,
            requestTimeout: 500,
            ...config.options,
            onError: (error) => errors.push(String(error)),
        })
        if (config.deferStorage) {
            await owner.shutdown(10)
            await owner.ready()
            releaseStorage()
        }
        await owner.ready()
        send({ ready: true, state: owner.getState(), errors })
        createInterface({ input: process.stdin }).on('line', async (line) => {
            const { id, command, args = [] } = JSON.parse(line)
            try {
                if (command === 'quit') {
                    send({ id, state: owner.getState(), errors })
                    app.quit()
                } else if (command === 'cancelQuit') {
                    app.once('will-quit', (event) => event.preventDefault())
                    app.quit()
                    send({ id, state: owner.getState(), errors })
                } else if (command === 'exit') {
                    await owner.shutdown(...args)
                    send({ id, state: owner.getState(), errors })
                    app.exit(0)
                } else {
                    const value = await owner[command](...args)
                    send({ id, value, state: owner.getState(), errors })
                }
            } catch (error) {
                send({ id, error: String(error), state: owner.getState(), errors })
            }
        })
    })
    .catch((error) => {
        send({ fatal: String(error) })
        app.exit(1)
    })
