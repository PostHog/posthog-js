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
  if (process.env.FIXTURE_TURBOPACK === '1') {
    assert.deepEqual(args.slice(0, 3), ['sourcemap', 'upload', '--directory'])
    assert.deepEqual(args.slice(4), ['--release-mode', 'event'])
    const directory = args[3]
    const files = fs.globSync('**/*.js.map', { cwd: directory }).flatMap((relative) => {
      const file = path.join(directory, relative.slice(0, -'.map'.length))
      if (!fs.existsSync(file)) return [] // Turbopack may emit maps without a sibling JS asset.
      const map = JSON.parse(fs.readFileSync(file + '.map', 'utf8'))
      const code = fs.readFileSync(file, 'utf8')
      const id = /^\/\/# debugId=(\S+)/m.exec(code)?.[1]
      if (!map.debugId || !id) return [] // Native Turbopack runtime/stub maps have no debug ID.
      assert.equal(map.debugId, id, 'Native JS/map debug ID mismatch: ' + file)
      return [
        {
          file: path.relative(process.cwd(), file),
          chunkId: id,
          sha256: createHash('sha256').update(code).digest('hex'),
        },
      ]
    })
    assert(
      files.some((row) => row.file.includes('/server/')),
      'No server debug IDs'
    )
    log({ command: 'upload', args, files })
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
