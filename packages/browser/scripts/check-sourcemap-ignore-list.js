#!/usr/bin/env node

/**
 * Post-build check: verify every source map we ship ignore-lists all of its sources.
 *
 * We wrap global console methods (entrypoints/logs.ts, and rrweb's console plugin when
 * session replay records console logs). Because the wrapper is the frame that actually
 * calls the native console method, devtools blame the caller's `console.*` message on
 * posthog-js unless our sources are marked as third party via the `x_google_ignoreList`
 * source map extension. The same field keeps our frames out of stack traces users see.
 *
 * `sourcemapIgnoreList` in rollup.config.mjs is what populates it — this script fails the
 * build if a bundle ever ships without it.
 */

const fs = require('fs')
const path = require('path')

const DIST = path.resolve(__dirname, '../dist')

// Built by @posthog/rrweb, copied in verbatim by copy-rrweb-worker-maps.js, so its
// ignore list isn't ours to set.
const NOT_OURS = /^image-bitmap-data-url-worker-/

const mapFiles = fs.readdirSync(DIST).filter((file) => file.endsWith('.js.map') && !NOT_OURS.test(file))

if (mapFiles.length === 0) {
    console.error('FAIL: no source maps found in dist/ — is `sourcemap: true` still set in rollup.config.mjs?')
    process.exit(1)
}

const failures = []

for (const file of mapFiles) {
    const map = JSON.parse(fs.readFileSync(path.join(DIST, file), 'utf8'))
    const sourceCount = map.sources?.length || 0
    if (sourceCount === 0) {
        continue
    }
    const ignoreList = map.ignoreList || map.x_google_ignoreList || []
    if (ignoreList.length !== sourceCount) {
        const missing = map.sources.filter((_, index) => !ignoreList.includes(index))
        failures.push({ file, missing })
    }
}

if (failures.length > 0) {
    console.error(`FAIL: ${failures.length} bundle source map(s) don't ignore-list every source`)
    console.error(
        "Devtools will blame our frames — e.g. the console wrapper in entrypoints/logs.ts — for the caller's console messages\n"
    )
    failures.forEach(({ file, missing }) =>
        console.error(
            `  ${file}: ${missing.length} source(s) not ignore-listed, e.g. ${missing.slice(0, 3).join(', ')}`
        )
    )
    console.error('\nFix: ensure `sourcemapIgnoreList` is set on every output in rollup.config.mjs')
    process.exit(1)
} else {
    console.log(`OK: all ${mapFiles.length} bundle source maps ignore-list every source`)
}
