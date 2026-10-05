import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { SourceMap } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))

test('declaration mappings stay inside the final declarations throughout dist', () => {
  const files = readdirSync(dist, { recursive: true }).filter((file) => file.endsWith('.d.ts'))
  assert.ok(files.length > 0, 'No declarations found in dist')

  for (const file of files) {
    const declaration = readFileSync(path.join(dist, file), 'utf8')
    assert.ok(
      declaration.includes(`//# sourceMappingURL=${path.basename(file)}.map`),
      `${file}: missing declaration map reference`
    )
    const payload = JSON.parse(readFileSync(path.join(dist, `${file}.map`), 'utf8'))
    const map = new SourceMap(payload)
    const lines = declaration.split('\n')

    for (const [line, mappings] of payload.mappings.split(';').entries()) {
      if (!mappings) continue
      const entry = map.findEntry(line, Number.MAX_SAFE_INTEGER)
      assert.equal(entry.generatedLine, line, `${file}: missing generated line ${line + 1}`)
      assert.ok(entry.generatedColumn <= lines[line]?.length, `${file}: mapping outside declaration line ${line + 1}`)
    }
  }
})
