#!/usr/bin/env node

/**
 * Post-build check: verify that mangled property names are consistent
 * between module.slim.js and extension-bundles.js.
 *
 * These two bundles are compiled as separate rollup entries. If their terser
 * instances don't share a nameCache, they independently mangle `_`-prefixed
 * properties to different short names, causing runtime crashes when combined:
 *   TypeError: Cannot read properties of undefined (reading 'emit')
 *
 * See https://github.com/PostHog/posthog-js/issues/3313
 *
 * This script parses the source maps to extract original→mangled property
 * mappings from each bundle, then asserts every property that appears in
 * both bundles was mangled to the same name.
 */

const fs = require('fs')
const path = require('path')

const { decode } = require('@jridgewell/sourcemap-codec')

const DIST = path.resolve(__dirname, '../dist')

function extractMangledPropertyNames(jsFile, mapFile) {
    const js = fs.readFileSync(jsFile, 'utf8')
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'))
    const lines = js.split('\n')
    const decoded = decode(map.mappings)
    const mappings = {} // originalName → Set<mangledName>

    decoded.forEach((lineSegments, lineIdx) => {
        const line = lines[lineIdx] || ''
        lineSegments.forEach((seg) => {
            if (seg.length < 5) return
            const genCol = seg[0]
            const nameIdx = seg[4]
            const originalName = map.names[nameIdx]

            // Only check single-underscore-prefixed properties (the mangling regex)
            if (!originalName || !originalName.startsWith('_') || originalName.startsWith('__')) return

            // Only count property accesses (preceded by '.'), not local variables
            if (genCol === 0 || line[genCol - 1] !== '.') return

            const rest = line.substring(genCol)
            const match = rest.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/)
            if (match && match[1] !== originalName) {
                if (!mappings[originalName]) mappings[originalName] = new Set()
                mappings[originalName].add(match[1])
            }
        })
    })

    const result = {}
    for (const [k, v] of Object.entries(mappings)) {
        result[k] = [...v]
    }
    return result
}

const slim = extractMangledPropertyNames(
    path.join(DIST, 'module.slim.js'),
    path.join(DIST, 'module.slim.js.map')
)
const ext = extractMangledPropertyNames(
    path.join(DIST, 'extension-bundles.js'),
    path.join(DIST, 'extension-bundles.js.map')
)

const shared = Object.keys(ext)
    .filter((k) => slim[k])
    .sort()

const mismatches = []
for (const name of shared) {
    const s = slim[name]
    const e = ext[name]
    // Terser should produce exactly one mangled name per property per compilation unit.
    if (s[0] !== e[0] || s.length !== 1 || e.length !== 1) {
        mismatches.push({ property: name, slim: s, ext: e })
    }
}

if (mismatches.length > 0) {
    console.error(
        `FAIL: ${mismatches.length} mangled property name(s) differ between module.slim.js and extension-bundles.js`
    )
    console.error('The slim bundle and extension bundles will crash when used together (see #3313)\n')
    mismatches.forEach((m) =>
        console.error(`  .${m.property}:  slim → .${m.slim.join(', .')}  |  ext → .${m.ext.join(', .')}`)
    )
    console.error(
        '\nFix: ensure the terser nameCache is shared across entries in rollup.config.mjs'
    )
    process.exit(1)
} else {
    console.log(
        `OK: ${shared.length} cross-bundle mangled properties are consistent between module.slim.js and extension-bundles.js`
    )
}
