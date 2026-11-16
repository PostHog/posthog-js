import assert from 'node:assert/strict'
import test from 'node:test'
import { compareAssets, validateWorkers, validateUploads } from './assertions.mjs'

test('cache checks reject changed bytes at a shared URL and unchanged runtime URLs', () => {
  const first = new Map([
    ['chunks/webpack-one.js', 'release-one'],
    ['lazy.js', 'lazy'],
  ])
  const second = new Map([
    ['chunks/webpack-two.js', 'release-two'],
    ['lazy.js', 'lazy'],
  ])
  assert.deepEqual(compareAssets(first, second).shared, ['lazy.js'])
  assert.throws(() => compareAssets(first, new Map([...second, ['lazy.js', 'changed']])), /Changed bytes/)
  assert.throws(() => compareAssets(first, first), /runtime URL/)
})

test('worker checks require actual unmasked client, node and edge instrumentation', () => {
  const rows = ['client', 'nodejs', 'edge'].map((target) => ({
    NEXT_PRIVATE_WORKER: '1',
    event: 'webpack',
    target,
    plugins: 1,
    uploadHook: false,
    argv: ['node', 'worker.js'],
  }))
  assert.equal(validateWorkers(rows, 'NEXT_PRIVATE_WORKER'), 3)
  assert.throws(() => validateWorkers([], 'NEXT_PRIVATE_WORKER'), /actual Next workers/)
  assert.throws(
    () =>
      validateWorkers(
        rows.map((row) => ({ ...row, plugins: 0 })),
        'NEXT_PRIVATE_WORKER'
      ),
    /skipped/
  )
  assert.throws(
    () =>
      validateWorkers(
        rows.map((row) => ({ ...row, webpack: '1' })),
        'NEXT_PRIVATE_WORKER'
      ),
    /mask/
  )
})

test('fail-soft plugin behavior cannot hide failed or missing uploads', () => {
  const records = [
    { command: 'release', releaseId: 'release-one' },
    { command: 'upload', files: [{ file: '.next/static/app.js' }, { file: '.next/server/app.js' }] },
  ]
  assert.equal(validateUploads(records, 'release-one').length, 2)
  assert.throws(() => validateUploads([...records, { command: 'error' }], 'release-one'), /CLI failed/)
  assert.throws(() => validateUploads(records.slice(0, 1), 'release-one'), /Missing client/)
  assert.throws(() => validateUploads(records, 'release-two'))
  assert.throws(() => validateUploads(records, undefined), /Development/)
})
