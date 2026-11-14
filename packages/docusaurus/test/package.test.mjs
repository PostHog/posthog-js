import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

test('package entry loads the built plugin and registers its built client module', () => {
    assert.equal(require.resolve('..'), path.join(packageRoot, 'dist/index.js'))
    const plugin = require('..')({}, { apiKey: 'phc_test', enableInDevelopment: true })
    const [client] = plugin.getClientModules()
    assert.equal(require.resolve(client), path.join(packageRoot, 'dist/posthog.js'))
})
