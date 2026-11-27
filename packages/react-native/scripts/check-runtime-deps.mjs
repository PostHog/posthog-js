import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const { dependencies } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const plugin = new URL('../dist/tooling/expoconfig.js', import.meta.url)

test('the SDK declares the Babel runtime as a dependency', () => {
  assert.ok(dependencies['@babel/runtime'], 'Add @babel/runtime to dependencies')
})

test('the built Expo config plugin can resolve its Babel runtime imports', (t) => {
  if (!existsSync(plugin)) return t.skip('Build the SDK to check dist/tooling/expoconfig.js')

  const require = createRequire(plugin)
  const code = readFileSync(plugin, 'utf8')
  for (const [, name] of code.matchAll(/\brequire\(\s*['"](@babel\/runtime(?:\/[^'"]+)?)['"]\s*\)/g)) {
    assert.ok(dependencies['@babel/runtime'], `The plugin requires ${name} without declaring @babel/runtime`)
    require.resolve(name)
  }
})
