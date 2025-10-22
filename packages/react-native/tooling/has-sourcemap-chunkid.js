// copied from https://github.com/getsentry/sentry-react-native/blob/e76d0d388228437e82f235546de00f4e748fcbda/packages/core/scripts/has-sourcemap-chunkId.js

import { argv, exit, exist } from 'process'
import { existsSync, readFileSync } from 'fs'

const sourceMapPath = argv[2]

if (!sourceMapPath) {
  console.log('Add source map path as first argument of the script.')
  exit(1)
}

if (!existsSync(sourceMapPath)) {
  console.log(`${sourceMapPath} does not exist.`)
  exit(1)
}

let sourceMap
try {
  sourceMap = JSON.parse(readFileSync(sourceMapPath, 'utf8'))
} catch (e) {
  console.log(`Sourcemap at ${sourceMapPath} was unable to be read.`, e)
  exist(1)
}

if (typeof sourceMap.chunkId === 'string' && sourceMap.chunkId.length > 0) {
  console.log(sourceMap.chunkId)
} else if (typeof sourceMap.chunk_id === 'string' && sourceMap.chunk_id.length > 0) {
  console.log(sourceMap.chunk_id)
} else {
  console.log(`${sourceMapPath} does not contain 'chunkId' nor 'chunk_id'.`)
  exist(1)
}
