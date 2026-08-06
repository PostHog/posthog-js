import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Shipped code must never reach a `@modelcontextprotocol/*` package at runtime —
 * only as a type.
 *
 * There are now two MCP TypeScript SDK majors in the wild under different
 * package names (`@modelcontextprotocol/sdk` v1, `@modelcontextprotocol/{core,
 * server,client}` v2), and a consumer installs whichever one they use. Reaching
 * either at runtime would make that major a hard dependency of `@posthog/mcp`
 * for everyone, and break the other half of the world at load time. So every SDK
 * shape we depend on is duck-typed at runtime instead.
 *
 * The check is deliberately written as "no reference survives" rather than "no
 * static import declaration matches": `import()`, `require()`, a bare
 * side-effect import and a value re-export are all runtime references that a
 * declaration-shaped scan would wave through. Anything that mentions the package
 * is a violation unless it is a type-only `import`/`export … from`, which the
 * compiler erases.
 */

const SRC = join(__dirname, '..')
const PACKAGE_REFERENCE = /['"]@modelcontextprotocol\/[^'"]*['"]/g
const DECLARATION = /\b(?:import|export)\s+([\s\S]*?)\s*from\s*(['"])@modelcontextprotocol\/[^'"]*\2/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(path)
    }
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

/**
 * Blanks out comments, preserving length so recorded offsets stay aligned. A
 * doc comment showing `import { McpServer } from "@modelcontextprotocol/sdk"`
 * is documentation, not a dependency.
 */
function blankComments(source: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, ' ')
  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:'"`\\])(\/\/[^\n]*)/gm, (_, before, comment) => {
    return before + blank(comment)
  })
}

/** True for `import type … from` and for `import { type A, type B } from`. */
function isTypeOnlyClause(clause: string): boolean {
  const trimmed = clause.trim()
  if (trimmed.startsWith('type ')) {
    return true
  }
  const named = /^\{([\s\S]*)\}$/.exec(trimmed)
  if (!named) {
    return false // default or namespace binding — always a value
  }
  return named[1]
    .split(',')
    .map((specifier) => specifier.trim())
    .every((specifier) => specifier === '' || specifier.startsWith('type '))
}

interface Scan {
  /** Character ranges covered by a type-only declaration — the erased ones. */
  erased: { start: number; end: number }[]
  /** Every reference to the package, wherever it appears. */
  references: number[]
}

function scan(source: string): Scan {
  const code = blankComments(source)
  const erased: Scan['erased'] = []
  for (const match of code.matchAll(DECLARATION)) {
    if (isTypeOnlyClause(match[1])) {
      erased.push({ start: match.index, end: match.index + match[0].length })
    }
  }
  const references = [...code.matchAll(PACKAGE_REFERENCE)].map((match) => match.index)
  return { erased, references }
}

describe('MCP SDK import boundary', () => {
  const files = sourceFiles(SRC)

  it('never references a @modelcontextprotocol package at runtime', () => {
    const offenders: string[] = []

    for (const file of files) {
      const { erased, references } = scan(readFileSync(file, 'utf8'))
      for (const at of references) {
        if (!erased.some((range) => at >= range.start && at < range.end)) {
          offenders.push(`${file.slice(SRC.length + 1)}:${at}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('recognises the type-only imports it is meant to allow', () => {
    // Without this, a scanner that silently matches nothing would pass the test
    // above forever while checking nothing at all.
    const erasedCount = files.reduce((total, file) => total + scan(readFileSync(file, 'utf8')).erased.length, 0)
    expect(erasedCount).toBeGreaterThan(0)
  })

  it.each([
    ['static value import', `import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'`],
    ['default import', `import sdk from '@modelcontextprotocol/sdk'`],
    ['namespace import', `import * as sdk from '@modelcontextprotocol/sdk'`],
    ['side-effect import', `import '@modelcontextprotocol/sdk/types.js'`],
    ['dynamic import', `const sdk = await import('@modelcontextprotocol/server')`],
    ['require', `const sdk = require('@modelcontextprotocol/sdk/types.js')`],
    ['import-equals', `import sdk = require('@modelcontextprotocol/sdk')`],
    ['value re-export', `export { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'`],
  ])('catches a %s', (_label, source) => {
    const { erased, references } = scan(source)
    expect(references).toHaveLength(1)
    expect(erased).toHaveLength(0)
  })

  it.each([
    ['type-only import', `import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'`],
    [
      'inline type specifiers',
      `import { type CallToolResult, type ListToolsResult } from '@modelcontextprotocol/sdk/types.js'`,
    ],
    ['type-only re-export', `export type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'`],
  ])('allows a %s', (_label, source) => {
    const { erased, references } = scan(source)
    expect(references).toHaveLength(1)
    expect(erased.some((range) => references[0] >= range.start && references[0] < range.end)).toBe(true)
  })

  it('ignores a package name that only appears in a comment', () => {
    const source = [
      '/**',
      ' * @example',
      ` * import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"`,
      ' */',
      `// see @modelcontextprotocol/sdk for the shape we duck-type`,
      'export const nothing = 1',
    ].join('\n')

    expect(scan(source).references).toEqual([])
  })
})
