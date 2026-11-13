const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { join } = require('node:path')
const { once } = require('node:events')
const { app, utilityProcess } = require('electron')
const { init } = require('@posthog/electron/main')

const events = []
let hanging
let networkStarted
const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    if (request.url.includes('/flags')) {
        response.setHeader('Content-Type', 'application/json')
        response.end(
            JSON.stringify({
                featureFlags: { test: 'variant' },
                featureFlagPayloads: {
                    test: '{"color":"blue","constructor":{"prototype":true},"__proto__":{"canary":1}}',
                },
            })
        )
    } else {
        events.push(...JSON.parse(body).batch)
        if (networkStarted) {
            hanging = response
            networkStarted()
            networkStarted = undefined
        } else response.end('{}')
    }
})
const children = []
let owner
function fork() {
    const child = utilityProcess.fork(join(__dirname, 'child.cjs'))
    children.push(child)
    const dispose = owner.registerUtilityProcess(child)
    let id = 0
    const wait = (predicate) =>
        new Promise((resolve) => {
            const message = (data) => {
                if (predicate(data)) {
                    child.removeListener('message', message)
                    resolve(data)
                }
            }
            child.on('message', message)
        })
    const ready = wait((data) => data.fixture === 'ready')
    const command = (action, value) => {
        const current = ++id
        const result = wait((data) => data.fixture === 'response' && data.id === current)
        child.postMessage({ fixture: 'command', id: current, action, value })
        return result
    }
    return { child, dispose, ready, command, wait }
}
async function run() {
    await app.whenReady()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    owner = init({
        projectToken: 'utility-fixture-token',
        host: `http://127.0.0.1:${server.address().port}`,
        storageDirectory: join(__dirname, 'state'),
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
        flushInterval: 0,
        flushAt: 1000,
        fetchRetryCount: 0,
        disableCompression: true,
    })
    await owner.ready()
    const utility = fork()
    const ready = await utility.ready
    assert.equal(ready.state.distinctId, owner.getDistinctId())
    assert.equal(ready.state.sessionId, owner.getSessionId())
    await owner.identify('main-user')
    assert.equal((await utility.command('identity', 'main-user')).state.distinctId, 'main-user')
    await utility.command('identify')
    assert.equal(owner.getDistinctId(), 'utility-user')
    await utility.command('capture', 'utility-work')
    await utility.command('exception')
    const flags = await utility.command('flags')
    assert.equal(flags.error, undefined)
    const burst = await utility.command('burst')
    assert.equal(burst.error, undefined)
    assert.equal(
        events.some((event) => event.event === 'after-rate-window'),
        true
    )
    const selected = events.filter((event) =>
        ['utility-work', '$exception', '$feature_flag_called'].includes(event.event)
    )
    assert.equal(selected.length, 3)
    const context = selected[0].properties.$utility_process_id
    assert.notEqual(context, 'spoof')
    for (const event of selected) {
        assert.equal(event.distinct_id, 'utility-user')
        assert.equal(event.properties.$electron_process, 'utility')
        assert.equal(event.properties.$utility_process_id, context)
        assert.equal(event.properties.$session_id, owner.getSessionId())
    }
    const exception = selected.find((event) => event.event === '$exception')
    assert.equal(exception.properties.$exception_list[0].value, 'handled utility fixture')
    assert.equal(exception.properties.$exception_list[0].mechanism.handled, true)
    await utility.command('optOut')
    assert.equal(owner.optedOut, true)
    await utility.command('capture', 'blocked-utility')
    await utility.command('reset')
    assert.equal(owner.optedOut, true)
    assert.notEqual(owner.getDistinctId(), 'utility-user')
    await owner.optIn()
    await utility.command('identity', owner.getDistinctId())
    await utility.command('capture', 'after-reset')
    await owner.flush()
    assert.equal(
        events.some((event) => event.event === 'blocked-utility'),
        false
    )
    assert.equal(events.find((event) => event.event === 'after-reset').distinct_id, owner.getDistinctId())

    // A real in-flight flush rejects in the child when main revokes its registration.
    await owner.capture('pending-flush')
    const started = new Promise((resolve) => {
        networkStarted = resolve
    })
    const pending = utility.command('pending')
    await started
    utility.dispose()
    assert.match((await pending).error, /closed/)
    hanging.end('{}')
    await owner.flush()

    // Unexpected process exit cleans only that exact registered object.
    const second = fork()
    await second.ready
    const exited = once(second.child, 'exit')
    second.child.postMessage({ fixture: 'command', action: 'exit' })
    assert.equal((await exited)[0], 23)
    assert.equal(second.child.listenerCount('message'), 0)
    const third = fork()
    await third.ready
    await third.command('capture', 'replacement-process')
    await owner.flush()
    assert.notEqual(
        events.find((event) => event.event === 'replacement-process').properties.$utility_process_id,
        context
    )
    console.log(
        JSON.stringify({
            result: 'PASS',
            electron: process.versions.electron,
            installed: require.resolve('@posthog/electron/utility'),
            checks: [
                'idempotent-ready',
                'rate-window-recovery',
                'reserved-json-payload-keys',
                'identity',
                'consent',
                'session',
                'protected-context',
                'handled-exception',
                'flag-dedupe',
                'reset',
                'pending-close-rejection',
                'unexpected-exit',
                'replacement-source',
            ],
            events: events.map((event) => event.event),
        })
    )
}
run()
    .then(async () => {
        for (const child of children) child.kill()
        await owner.shutdown(1000)
        server.closeAllConnections()
        server.close()
        app.exit(0)
    })
    .catch((error) => {
        console.error(error)
        for (const child of children) child.kill()
        server.closeAllConnections()
        server.close()
        app.exit(1)
    })
