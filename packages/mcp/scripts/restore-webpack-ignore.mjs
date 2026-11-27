// rspack drops `webpackIgnore` magic comments when it builds the package, but an app's
// webpack needs it on request-scope's import('node:async_hooks') fallback: without it
// webpack stubs the import, and Workers with only `nodejs_als` lose AsyncLocalStorage.
import { readFileSync, writeFileSync } from 'node:fs'

const built = 'import(/* @vite-ignore */ moduleId)'
const restored = 'import(/* webpackIgnore: true */ /* @vite-ignore */ moduleId)'

for (const file of ['dist/extensions/request-scope.mjs', 'dist/extensions/request-scope.js']) {
  const source = readFileSync(file, 'utf8')
  if (!source.includes(built)) {
    throw new Error(`${file} no longer contains ${built}; update scripts/restore-webpack-ignore.mjs`)
  }
  writeFileSync(file, source.replace(built, restored))
}
