/**
 * @jest-environment node
 *
 * Validates the packaging that routes `@posthog/next` and
 * `@posthog/next/pages` to the correct per-runtime barrel:
 *
 *   1. `package.json#exports` declares the right file for each runtime
 *      condition (`browser`, `edge-light`/`edge`/`worker`, `react-server`,
 *      `default`).
 *   2. The transitive import closure of each built barrel never reaches
 *      `'server-only'` or `posthog-node` from a runtime that can't handle
 *      them — Next.js rejects `'server-only'` in client bundles, and
 *      `posthog-node` uses Node-only APIs that don't exist in the Edge
 *      runtime or the browser.
 */

import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'

interface SubpathExports {
    types?: string
    'edge-light'?: string
    edge?: string
    worker?: string
    browser?: string
    'react-server'?: string
    default?: string
}
interface PackageJson {
    files: string[]
    exports: Record<string, SubpathExports>
}

const PACKAGE_ROOT = path.resolve(__dirname, '..')
const DIST_DIR = path.join(PACKAGE_ROOT, 'dist')
const distExists = existsSync(DIST_DIR)
const describeIfBuilt = distExists ? describe : describe.skip

let pkg: PackageJson
beforeAll(async () => {
    pkg = JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')) as PackageJson
})

describe('package.json#exports routing', () => {
    it('./pages routes each runtime to the correct barrel', () => {
        const pages = pkg.exports['./pages']
        expect(pages.types).toBe('./dist/pages.d.ts')
        expect(pages.browser).toBe('./dist/pages.client.js')
        expect(pages['edge-light']).toBe('./dist/pages.edge.js')
        expect(pages.edge).toBe('./dist/pages.edge.js')
        expect(pages.worker).toBe('./dist/pages.edge.js')
        expect(pages['react-server']).toBe('./dist/pages.js')
        expect(pages.default).toBe('./dist/pages.js')
    })

    it('. (root entry) keeps the existing per-runtime split intact', () => {
        const root = pkg.exports['.']
        expect(root.browser).toBe('./dist/index.client.js')
        expect(root['edge-light']).toBe('./dist/index.edge.js')
        expect(root.edge).toBe('./dist/index.edge.js')
        expect(root.worker).toBe('./dist/index.edge.js')
        expect(root['react-server']).toBe('./dist/index.js')
        expect(root.default).toBe('./dist/index.client.js')
    })

    // Per the Node spec, the resolver walks `exports` in declaration order
    // and picks the first matching condition. If `default` is reordered
    // above `browser`/`edge`/`react-server`, those more specific conditions
    // become unreachable and the per-runtime split silently breaks.
    it.each([['./pages'], ['.']])('%s lists `default` last so specific conditions win', (subpath) => {
        const keys = Object.keys(pkg.exports[subpath])
        expect(keys.indexOf('default')).toBe(keys.length - 1)
    })

    it('publishes dist/ (which carries the per-runtime barrels)', () => {
        expect(pkg.files).toContain('dist')
    })
})

describeIfBuilt('Built dist artifacts (skipped when dist/ missing)', () => {
    const expectedArtifacts = [
        'pages.client.js',
        'pages.client.d.ts',
        'pages.edge.js',
        'pages.edge.d.ts',
        'pages.js',
        'pages.d.ts',
    ]
    it.each(expectedArtifacts)('emits dist/%s', async (artifact) => {
        const stat = await fs.stat(path.join(DIST_DIR, artifact))
        expect(stat.isFile()).toBe(true)
    })
})

const SPECIFIER_PATTERN = /(?:from|import\(|^import|export[^']*from)\s*\(?\s*['"]([^'"]+)['"]/gm

/**
 * Statically walks ESM imports/exports starting at `entry` (built JS file),
 * returning all bare specifiers reached anywhere in the closure. Mirrors what
 * Webpack/Turbopack would trace when assembling a bundle.
 */
function bareImportsReachableFrom(entry: string): Set<string> {
    const visited = new Set<string>()
    const bareImports = new Set<string>()

    function walk(absPath: string): void {
        if (visited.has(absPath)) return
        visited.add(absPath)
        const text = readFileSync(absPath, 'utf8')
        for (const match of text.matchAll(SPECIFIER_PATTERN)) {
            const specifier = match[1]
            if (specifier.startsWith('./') || specifier.startsWith('../')) {
                const resolved = path.resolve(path.dirname(absPath), specifier)
                if (existsSync(resolved)) walk(resolved)
            } else {
                bareImports.add(specifier)
            }
        }
    }
    walk(entry)
    return bareImports
}

describeIfBuilt('Transitive import closure of each built barrel', () => {
    it.each([
        ['pages.client.js', 'browser → ./pages'],
        ['index.client.js', 'browser/default → .'],
    ])('client barrel %s (%s) never reaches server-only or posthog-node', (file) => {
        const imports = bareImportsReachableFrom(path.join(DIST_DIR, file))
        expect(imports.has('server-only')).toBe(false)
        expect(imports.has('posthog-node')).toBe(false)
    })

    it('index.react-server.js never reaches server-only (posthog-node is allowed)', () => {
        const imports = bareImportsReachableFrom(path.join(DIST_DIR, 'index.react-server.js'))
        expect(imports.has('server-only')).toBe(false)
    })

    // Sanity check: the Node-server and edge barrels should still pull these
    // in. If they stop doing so, the server-side API has likely lost the
    // intended functionality (e.g. a re-export was accidentally dropped).
    it.each([
        ['pages.js', { 'server-only': true, 'posthog-node': true }],
        ['index.js', { 'server-only': true, 'posthog-node': true }],
        ['pages.edge.js', { 'server-only': true, 'posthog-node': false }],
    ])('server/edge barrel %s keeps the expected bare imports', (file, expected) => {
        const imports = bareImportsReachableFrom(path.join(DIST_DIR, file))
        for (const [specifier, shouldBeReachable] of Object.entries(expected)) {
            expect(imports.has(specifier)).toBe(shouldBeReachable)
        }
    })
})
