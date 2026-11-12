import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
import { flagKey, mockToken, startMockServer } from './mock-server.mjs'

const directory = fileURLToPath(new URL('.', import.meta.url))
const userData = await mkdtemp(join(tmpdir(), 'posthog-electron-smoke-'))
const receiver = await startMockServer()
let packaged

try {
    let application = directory
    if (process.argv.includes('--asar')) {
        const { createPackage } = await import('@electron/asar')
        const require = createRequire(import.meta.url)
        packaged = await mkdtemp(join(tmpdir(), 'posthog-electron-package-'))
        const source = join(packaged, 'app')
        await mkdir(join(source, 'node_modules', '@posthog'), { recursive: true })
        for (const name of [
            'main.mjs',
            'package.json',
            'index.html',
            'styles.css',
            'dist',
            'mock-server.mjs',
            'smoke-driver.mjs',
            'fixtures',
        ]) {
            await cp(join(directory, name), join(source, name), { recursive: true, dereference: true })
        }
        const sdkEntry = require.resolve('@posthog/electron/main')
        const coreEntry = createRequire(sdkEntry).resolve('@posthog/core')
        const typesEntry = createRequire(coreEntry).resolve('@posthog/types')
        for (const [name, entry] of [
            ['electron', sdkEntry],
            ['core', coreEntry],
            ['types', typesEntry],
        ]) {
            const root = dirname(dirname(entry))
            await cp(root, join(source, 'node_modules', '@posthog', name), {
                recursive: true,
                dereference: true,
                filter: (path) => !relative(root, path).split(sep).includes('node_modules'),
            })
        }
        application = join(packaged, 'app.asar')
        await createPackage(source, application)
    }
    const env = {
        ...process.env,
        ELECTRON_EXAMPLE_USER_DATA: userData,
        ELECTRON_EXAMPLE_MOCK_HOST: receiver.host,
    }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.POSTHOG_PROJECT_TOKEN
    delete env.POSTHOG_HOST
    await new Promise((resolve, reject) => {
        const packagedBinary = process.argv.find((argument) => argument.startsWith('--packaged='))?.slice(11)
        const fixture = process.argv.find((argument) => argument.startsWith('--fixture='))
        const child = spawn(
            packagedBinary ?? process.env.ELECTRON_BINARY ?? electron,
            [...(packagedBinary ? [] : [application]), '--smoke-test', ...(fixture ? [fixture] : [])],
            {
                cwd: directory,
                env,
                stdio: 'inherit',
            }
        )
        let timedOut = false
        let forceKill
        const timeout = setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
            forceKill = setTimeout(() => child.kill('SIGKILL'), 2000)
        }, 45000)
        child.once('error', (error) => {
            clearTimeout(timeout)
            clearTimeout(forceKill)
            reject(error)
        })
        child.once('close', (code, signal) => {
            clearTimeout(timeout)
            clearTimeout(forceKill)
            if (timedOut) reject(new Error('Electron smoke test timed out after 45 seconds'))
            else if (code !== 0) reject(new Error(`Electron exited with code ${code}, signal ${signal}`))
            else resolve()
        })
    })

    assert.deepEqual(receiver.errors, [], 'mock receiver must decode every request')
    assert.ok(receiver.requests.length > 0, 'Electron must send real HTTP traffic')
    assert.ok(
        receiver.requests.some(({ path }) => /^\/(flags|decide)\/?$/.test(path)),
        'flags must be fetched'
    )
    for (const request of receiver.requests) {
        assert.match(request.path, /^\/(batch|capture|e|flags|decide)\/?$/, 'no replay or unexpected endpoint traffic')
        assert.equal(request.method, 'POST')
        if (/^\/(batch|capture|e)\/?$/.test(request.path)) {
            assert.equal(request.body.api_key, mockToken, 'test must use the mock project token')
        }
    }
    const events = receiver.events
    const one = (name) => {
        const found = events.filter((event) => event.event === name)
        assert.equal(found.length, 1, `expected exactly one ${name}`)
        return found[0]
    }
    const startup = one('electron_main_startup')
    assert.equal(startup.properties.$electron_process, 'main')
    assert.equal(startup.properties.example, 'electron')
    const anonymous = one('smoke_anonymous')
    assert.ok(anonymous.distinct_id)
    assert.notEqual(anonymous.distinct_id, 'electron-smoke-user')
    const identifiedFirst = one('smoke_identified_first')
    const identifiedSecond = one('smoke_identified_second')
    for (const event of [identifiedFirst, identifiedSecond, one('smoke_grouped_second'), one('smoke_opted_in')]) {
        assert.equal(event.distinct_id, 'electron-smoke-user')
        assert.equal(event.properties.$electron_process, 'renderer')
        assert.ok(event.properties.$session_id)
    }
    assert.equal(identifiedFirst.properties.$session_id, identifiedSecond.properties.$session_id)
    const identify = one('$identify')
    assert.equal(identify.distinct_id, 'electron-smoke-user')
    assert.equal(identify.properties.$anon_distinct_id, anonymous.distinct_id)
    assert.equal(identify.properties.$set.sample_name, 'Smoke User')
    const group = one('$groupidentify')
    assert.equal(group.properties.$group_type, 'organization')
    assert.equal(group.properties.$group_key, 'smoke-org')
    assert.deepEqual(group.properties.$group_set, { plan: 'test' })
    assert.equal(one('smoke_grouped_second').properties.$groups.organization, 'smoke-org')
    assert.equal(one('smoke_grouped_second').properties.smoke_registered, 'shared')
    assert.equal(one('smoke_unregistered_first').properties.smoke_registered, undefined)
    assert.equal(
        events.some((event) => event.event.startsWith('smoke_forbidden_')),
        false,
        'opt-out blocks all processes'
    )
    const exposures = events.filter((event) => event.event === '$feature_flag_called')
    assert.ok(
        exposures.some(
            (event) =>
                event.properties.$feature_flag === flagKey &&
                event.properties.$feature_flag_response === 'local-variant' &&
                event.properties.$electron_process === 'renderer'
        ),
        'renderer flag evaluation must emit an exposure'
    )
    const exception = one('$exception')
    assert.equal(exception.properties.smoke_exception, true)
    assert.equal(exception.properties.$electron_process, 'renderer')
    const detail = exception.properties.$exception_list[0]
    assert.equal(detail.type, 'Error')
    assert.equal(detail.value, 'Electron smoke handled exception')
    assert.equal(detail.mechanism.handled, true)
    assert.ok(detail.stacktrace.frames.length > 0)
    const resetFirst = one('smoke_reset_first')
    const resetSecond = one('smoke_reset_second')
    assert.ok(resetFirst.distinct_id)
    assert.notEqual(resetFirst.distinct_id, anonymous.distinct_id)
    assert.notEqual(resetFirst.distinct_id, 'electron-smoke-user')
    assert.equal(resetFirst.distinct_id, resetSecond.distinct_id)
    assert.equal(resetFirst.properties.$session_id, resetSecond.properties.$session_id)
    assert.notEqual(resetFirst.properties.$session_id, identifiedFirst.properties.$session_id)
    for (const event of [resetFirst, resetSecond]) {
        assert.equal(event.properties.$groups?.organization, undefined, 'reset must clear group context')
        assert.equal(event.properties.smoke_reset_property, undefined, 'reset must clear registered properties')
        assert.equal(event.properties.$electron_process, 'renderer')
    }
    assert.equal(
        events.some((event) => event.event === '$snapshot'),
        false,
        'no session replay snapshots'
    )
    console.log(`Electron smoke test passed: ${events.length} wire events from two real sandboxed renderer windows.`)
} finally {
    await receiver.close()
    await rm(userData, { recursive: true, force: true })
    if (packaged) await rm(packaged, { recursive: true, force: true })
}
