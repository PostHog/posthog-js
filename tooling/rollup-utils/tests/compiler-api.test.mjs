import assert from 'node:assert/strict'
import { test } from 'node:test'
import { plugins } from '../dist/index.js'

test('the exported TypeScript plugin retains a working compiler API', () => {
    assert.deepEqual(
        plugins(['.ts']).map((plugin) => plugin.name),
        ['node-resolve', 'commonjs', 'json', 'typescript', 'babel']
    )
})
