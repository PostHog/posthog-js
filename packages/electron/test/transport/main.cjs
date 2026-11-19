const { app } = require('electron')
const { readFileSync, readdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { init } = require('../../dist/main.cjs')
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'))
app.setPath('userData', join(config.directory, 'profile'))

async function main() {
    await app.whenReady()
    const owner = init({
        projectToken: 'synthetic-redirect-test',
        host: config.host,
        storageDirectory: join(config.directory, 'storage'),
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
        disableCompression: true,
        flushInterval: 0,
        fetchRetryCount: 0,
        requestTimeout: 2000,
        featureFlagsRequestTimeoutMs: 2000,
        onError: () => {},
    })
    try {
        await owner.ready()
        await owner.capture('synthetic-redirect-event')
        let rejected = false
        try {
            await owner.flush()
        } catch {
            rejected = true
        }
        await owner.reloadFeatureFlagsAsync()
        const namespace = readdirSync(join(config.directory, 'storage')).find((name) => /^[a-f0-9]{24}$/.test(name))
        if (!namespace) throw new Error('SDK storage namespace was not created')
        const state = JSON.parse(readFileSync(join(config.directory, 'storage', namespace, 'state.json'), 'utf8'))
        writeFileSync(
            config.result,
            JSON.stringify({
                electron: process.versions.electron,
                rejected,
                flags: owner.getState().featureFlags,
                queue: state.values.queue?.map(({ message }) => ({ event: message.event, uuid: message.uuid })),
            })
        )
    } finally {
        await owner.shutdown(100)
    }
}
main()
    .then(() => app.exit(0))
    .catch((error) => {
        console.error(error)
        app.exit(1)
    })
