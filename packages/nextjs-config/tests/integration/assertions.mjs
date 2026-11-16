import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const digest = (source) => createHash('sha256').update(source).digest('hex')

export function compareAssets(first, second) {
  const shared = []
  for (const [file, source] of second) {
    if (first.has(file)) {
      assert.equal(source, first.get(file), 'Changed bytes at immutable URL: ' + file)
      shared.push(file)
    }
  }
  assert(shared.length > 0, 'The cache replay must exercise shared immutable assets')
  const runtimes = (assets) => [...assets.keys()].filter((file) => /(^|\/)webpack-[^.]+\.js$/.test(file)).sort()
  assert(runtimes(first).length > 0 && runtimes(second).length > 0, 'Missing webpack runtime')
  assert.notDeepEqual(runtimes(first), runtimes(second), 'A new release must change the runtime URL')
  const inventory = (assets) => Object.fromEntries([...assets].map(([file, source]) => [file, digest(source)]))
  return { shared, first: inventory(first), second: inventory(second) }
}

export function validateWorkers(records, marker) {
  const children = records.filter((row) => row[marker] === '1' && row.event === 'webpack')
  assert(children.length >= 3, 'Expected client, node and edge hooks in actual Next workers')
  assert.deepEqual([...new Set(children.map((row) => row.target))].sort(), ['client', 'edge', 'nodejs'])
  for (const row of children) {
    assert.equal(row.plugins, 1, 'Worker skipped or duplicated PostHog instrumentation')
    assert.equal(row.uploadHook, false, 'Webpack worker installed the Turbopack hook')
    assert.equal(row.nativeDebugIds, undefined)
    assert.equal(row.turbopack, undefined, 'Do not mask worker detection with environment overrides')
    assert.equal(row.webpack, undefined, 'Do not mask worker detection with environment overrides')
    assert(!row.argv.includes('--webpack'), 'The worker test must not inherit CLI flags')
  }
  return children.length
}

export function validateUploads(records, releaseId) {
  assert(!records.some((row) => row.command === 'error'), 'Mock CLI failed: ' + JSON.stringify(records))
  const releases = records.filter((row) => row.command === 'release')
  if (releaseId === undefined) assert.equal(releases.length, 0, 'Development must not resolve a release')
  else {
    assert(releases.length > 0, 'Expected automatic release resolution')
    for (const row of releases) assert.equal(row.releaseId, releaseId)
  }
  const files = records.filter((row) => row.command === 'upload').flatMap((row) => row.files)
  assert(
    files.some((row) => row.file.includes('/static/')),
    'Missing client upload'
  )
  assert(
    files.some((row) => row.file.includes('/server/')),
    'Missing server upload'
  )
  return files
}
