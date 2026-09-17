import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SourceMap } from 'node:module'
import { test } from 'node:test'

const declarationURL = new URL('../dist/error-tracking/coercers/dom-exception-coercer.d.ts', import.meta.url)
const sourceURL = new URL('../src/error-tracking/coercers/dom-exception-coercer.ts', import.meta.url)

test('DOMExceptionCoercer declaration mappings stay inside the final declaration', () => {
  const declaration = readFileSync(declarationURL, 'utf8')
  assert.ok(declaration.includes('//# sourceMappingURL=dom-exception-coercer.d.ts.map'))
  const payload = JSON.parse(readFileSync(new URL(`${declarationURL}.map`), 'utf8'))
  const map = new SourceMap(payload)
  const lines = declaration.split('\n')

  for (const [line, mappings] of payload.mappings.split(';').entries()) {
    if (!mappings) continue
    const entry = map.findEntry(line, Number.MAX_SAFE_INTEGER)
    assert.equal(entry.generatedLine, line)
    assert.ok(entry.generatedColumn <= lines[line]?.length, `Mapping outside declaration line ${line + 1}`)
  }

  const sourceLines = readFileSync(sourceURL, 'utf8').split('\n')
  for (const marker of ["'../types'", 'DOMExceptionCoercer', 'coerce(']) {
    const line = lines.findIndex((value) => value.includes(marker))
    assert.ok(line >= 0)
    const column = lines[line].indexOf(marker)
    const originalLine = sourceLines.findIndex((value) => value.includes(marker))
    assert.ok(originalLine >= 0)
    const entry = map.findEntry(line, column)
    assert.equal(entry.originalSource, '../../../src/error-tracking/coercers/dom-exception-coercer.ts')
    assert.equal(entry.originalLine, originalLine)
    assert.equal(entry.originalColumn, sourceLines[originalLine].indexOf(marker))
  }
})
