import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, copyFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Fixture } from './server.mjs'

const consumer = process.env.POSTHOG_ELECTRON_CONSUMER
const options = {
    project_token: 'not-live',
    config: { host: 'http://127.0.0.1:12345', preload_feature_flags: false, disable_remote_feature_flags: true },
}
const enabled = { skip: !consumer }

test(
    'native renderer controller preserves an own JSON __proto__ invocation key for binding validation',
    enabled,
    async () => {
        const fixture = new Fixture(resolve(consumer), 'electron-renderer')
        try {
            await fixture.exchange(null, 15000)
            const setup = await fixture.exchange({ route: '/setup', args: options }, 15000)
            assert.equal(setup.completion.outcome.kind, 'void')
            const result = await fixture.exchange(
                { route: '/capture', args: JSON.parse('{"event":"never-dispatched","__proto__":"own-canary"}') },
                15000
            )
            assert.equal(result.completion.kind, 'harness')
            assert.equal(result.completion.failure.kind, 'unsupported_binding')
            assert.match(result.completion.failure.message, /\/capture\/__proto__/)
        } finally {
            await fixture.stop()
        }
    }
)

test(
    'native page allocation failure is a fixture error, while genuine native init throws remain SDK outcomes',
    enabled,
    async () => {
        // Negative allocation has the fresh immutable dependency closure and unchanged build identity, but no controller page.
        const directory = await mkdtemp(join(tmpdir(), 'electron-native-missing-page-'))
        await copyFile(join(consumer, 'build.json'), join(directory, 'build.json'))
        await writeFile(join(directory, 'package.json'), '{}')
        await symlink(join(resolve(consumer), 'node_modules'), join(directory, 'node_modules'), 'dir')
        let fixture
        try {
            fixture = new Fixture(directory, 'electron-renderer')
            await fixture.exchange(null, 15000)
            const result = await fixture.exchange({ route: '/setup', args: options }, 15000)
            assert.equal(result.completion.kind, 'harness')
            assert.equal(result.completion.failure.code, 'controller-setup')
            await fixture.stop()
            fixture = new Fixture(resolve(consumer), 'electron-main')
            await fixture.exchange(null, 15000)
            const native = await fixture.exchange({ route: '/setup', args: { ...options, project_token: '' } }, 15000)
            assert.equal(native.completion.kind, 'sdk')
            assert.equal(native.completion.outcome.kind, 'thrown')
        } finally {
            await fixture?.stop()
            await rm(directory, { recursive: true, force: true })
        }
    }
)
