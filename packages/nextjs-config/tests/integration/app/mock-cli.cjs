#!/usr/bin/env node
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { determineChunkIdFromSource } = require('@posthog/plugin-utils')
const args = process.argv.slice(2)
const log = (entry) => fs.appendFileSync(process.env.FIXTURE_CLI_LOG, JSON.stringify(entry) + '\n')

async function main() {
  if (args[0] === 'release' && args[1] === 'resolve') {
    assert(process.env.FIXTURE_RELEASE, 'No release resolution is expected outside production builds')
    log({ command: 'release', args, releaseId: process.env.FIXTURE_RELEASE })
    console.log(process.env.FIXTURE_RELEASE)
    return
  }
  assert.deepEqual(args, ['sourcemap', 'upload', '--stdin', '--release-mode', 'event'])
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const files = input
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((file) => {
      const code = fs.readFileSync(file, 'utf8')
      const map = JSON.parse(fs.readFileSync(file + '.map', 'utf8'))
      assert(map.chunk_id, 'Missing uploaded chunk ID: ' + file)
      assert.equal(map.chunk_id, determineChunkIdFromSource(code), 'JS/map ID mismatch: ' + file)
      return {
        file: path.relative(process.cwd(), file),
        chunkId: map.chunk_id,
        sha256: createHash('sha256').update(code).digest('hex'),
      }
    })
  assert(files.length > 0, 'Empty upload')
  log({ command: 'upload', args, files })
}

main().catch((error) => {
  log({ command: 'error', args, message: error.stack })
  console.error(error)
  process.exitCode = 1
})
