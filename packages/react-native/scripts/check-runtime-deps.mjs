import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const { dependencies } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const dist = fileURLToPath(new URL('../dist/', import.meta.url))

test('the SDK declares the Babel runtime as a dependency', () => {
  assert.ok(dependencies['@babel/runtime'], 'Add @babel/runtime to dependencies')
})

test('built JavaScript files can resolve their Babel runtime imports', (t) => {
  const files = existsSync(dist) ? readdirSync(dist, { recursive: true }).filter((file) => file.endsWith('.js')) : []
  if (files.length === 0) return t.skip('Build the SDK to check Babel runtime imports in dist')

  for (const file of files) {
    const filename = path.join(dist, file)
    const require = createRequire(filename)
    const code = readFileSync(filename, 'utf8')
    for (const [, name] of code.matchAll(/\brequire\(\s*['"](@babel\/runtime(?:\/[^'"]+)?)['"]\s*\)/g)) {
      assert.ok(dependencies['@babel/runtime'], `${file} requires ${name} without declaring @babel/runtime`)
      require.resolve(name)
    }
  }
})
