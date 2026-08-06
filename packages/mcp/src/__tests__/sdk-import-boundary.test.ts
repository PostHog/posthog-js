import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Shipped code must never `import` a `@modelcontextprotocol/*` package at
 * runtime — only as a type.
 *
 * There are now two MCP TypeScript SDK majors in the wild under different
 * package names (`@modelcontextprotocol/sdk` v1, `@modelcontextprotocol/{core,
 * server,client}` v2), and a consumer installs whichever one they use. A value
 * import of either would make that major a hard dependency of `@posthog/mcp`
 * for everyone, so every SDK shape we depend on is duck-typed at runtime
 * instead. Type-only imports are fine: they are erased at build time.
 */

const SRC = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(path)
    }
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

/** True for `import type … from` and for `import { type A, type B } from`. */
function isTypeOnlyImport(clause: string): boolean {
  const trimmed = clause.trim()
  if (trimmed.startsWith('type ')) {
    return true
  }
  const named = /^\{([\s\S]*)\}$/.exec(trimmed)
  if (!named) {
    return false // default or namespace import — always a value
  }
  return named[1]
    .split(',')
    .map((specifier) => specifier.trim())
    .every((specifier) => specifier === '' || specifier.startsWith('type '))
}

describe('MCP SDK import boundary', () => {
  it('never imports a @modelcontextprotocol package as a value', () => {
    const offenders: string[] = []

    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8')
      const imports = source.matchAll(/import\s+([\s\S]*?)\s*from\s*['"](@modelcontextprotocol\/[^'"]+)['"]/g)
      for (const [, clause, specifier] of imports) {
        if (!isTypeOnlyImport(clause)) {
          offenders.push(`${file.slice(SRC.length + 1)} → ${specifier}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
