import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { SourceMap } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const dist = path.join(packageRoot, 'dist')

test('final JavaScript links to maps with positions inside the emitted code', () => {
  const files = readdirSync(dist, { recursive: true }).filter((file) => file.endsWith('.js'))
  assert.ok(files.length > 0)

  for (const file of files) {
    const code = readFileSync(path.join(dist, file), 'utf8')
    assert.ok(code.includes(`//# sourceMappingURL=${path.basename(file)}.map`), `${file}: missing map reference`)
    const payload = JSON.parse(readFileSync(path.join(dist, `${file}.map`), 'utf8'))
    const map = new SourceMap(payload)
    const lines = code.split('\n')

    for (const [line, mappings] of payload.mappings.split(';').entries()) {
      if (!mappings) continue
      const entry = map.findEntry(line, Number.MAX_SAFE_INTEGER)
      assert.equal(entry.generatedLine, line, `${file}: missing generated line ${line + 1}`)
      assert.ok(entry.generatedColumn <= lines[line]?.length, `${file}: mapping outside line ${line + 1}`)
    }
  }
})

test('ErrorBoundary maps captureException back to the original TSX with embedded source', () => {
  const code = readFileSync(path.join(dist, 'PostHogErrorBoundary.js'), 'utf8')
  const payload = JSON.parse(readFileSync(path.join(dist, 'PostHogErrorBoundary.js.map'), 'utf8'))
  const source = readFileSync(path.join(packageRoot, 'src/PostHogErrorBoundary.tsx'), 'utf8')
  const marker = 'captureException'
  const generatedLine = code.split('\n').findIndex((line) => line.includes(marker))
  assert.ok(generatedLine >= 0)
  const generatedColumn = code.split('\n')[generatedLine].indexOf(marker)
  const originalLine = source.split('\n').findIndex((line) => line.includes(marker))
  const originalColumn = source.split('\n')[originalLine].indexOf(marker)
  const entry = new SourceMap(payload).findEntry(generatedLine, generatedColumn)

  assert.equal(entry.originalSource, '../src/PostHogErrorBoundary.tsx')
  assert.equal(entry.originalLine, originalLine)
  assert.equal(entry.originalColumn, originalColumn)
  assert.equal(payload.sourcesContent[payload.sources.indexOf(entry.originalSource)], source)
})
