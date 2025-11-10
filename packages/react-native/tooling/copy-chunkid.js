// copied from https://github.com/getsentry/sentry-react-native/blob/e76d0d388228437e82f235546de00f4e748fcbda/packages/core/scripts/copy-debugid.js

import { argv, exit } from 'process'
import { existsSync, readFileSync, writeFileSync } from 'fs'

console.log('Copy `debugId` from packager source map to Hermes source map...')

const packagerSourceMapPath = argv[2]
const hermesSourceMapPath = argv[3]

if (!packagerSourceMapPath) {
  console.log('Please provide packager source map path (A path to copy `debugId` from).')
  exit(0)
}
if (!hermesSourceMapPath) {
  console.log('Please provide Hermes source map path. ((A path to copy `debugId` to))')
  exit(0)
}
if (!existsSync(packagerSourceMapPath)) {
  console.log('Packager source map path (A path to copy `debugId` from).')
  exit(0)
}
if (!existsSync(hermesSourceMapPath)) {
  console.log('Hermes source map not found. ((A path to copy `debugId` to))')
  exit(0)
}

const from = readFileSync(argv[2], 'utf8')
const to = readFileSync(argv[3], 'utf8')

const fromParsed = JSON.parse(from)
const toParsed = JSON.parse(to)

if (!fromParsed.debugId) {
  console.log('Packager source map does not have `debugId`.')
  exit(0)
}

if (toParsed.chunkId) {
  console.log('Hermes combined source map already has `chunkId`.')
  exit(0)
}

if (fromParsed.debugId) {
  toParsed.chunkId = fromParsed.debugId
}

writeFileSync(argv[3], JSON.stringify(toParsed))

console.log('Done.')
