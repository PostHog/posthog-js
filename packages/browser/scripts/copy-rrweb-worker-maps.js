#!/usr/bin/env node

/**
 * Post-build step: copy the `image-bitmap-data-url-worker-*.js.map` files
 * from the @posthog/rrweb workspace package into packages/browser/dist/.
 *
 * Why this exists:
 *   - @posthog/rrweb inlines its image-bitmap web worker as a string and
 *     embeds a `//# sourceMappingURL=image-bitmap-data-url-worker-*.js.map`
 *     comment pointing at a sibling file.
 *   - When rollup bundles @posthog/rrweb into our dist/rrweb.js (and into
 *     dist/recorder.js etc. for the existing recorder entries) that
 *     sourcemap reference comes along for the ride.
 *   - Downstream consumers (notably PostHog/posthog's frontend build) need
 *     the map file to be reachable next to the JS, otherwise their static
 *     asset pipeline fails on the missing sourcemap.
 *
 * Until this change posthog grabbed the map straight from
 * `node_modules/@posthog/rrweb/dist`. After the rrweb fork is consumed
 * through `posthog-js/rrweb` (and the `@posthog/rrweb` direct dep is
 * dropped) that path no longer exists, so we have to ship the map file
 * from here.
 */

const fs = require('fs')
const path = require('path')

const RRWEB_DIST = path.resolve(__dirname, '..', '..', 'rrweb', 'rrweb', 'dist')
const TARGET_DIST = path.resolve(__dirname, '..', 'dist')

if (!fs.existsSync(RRWEB_DIST)) {
    // Building outside the monorepo (e.g. consumers running our build script) — nothing to do.
    process.exit(0)
}

const mapFiles = fs.readdirSync(RRWEB_DIST).filter((file) => file.startsWith('image-bitmap-data-url-worker-') && file.endsWith('.js.map'))

if (mapFiles.length === 0) {
    console.warn(
        'warn: no image-bitmap-data-url-worker-*.js.map files found in @posthog/rrweb dist — has the worker filename hash changed?'
    )
    process.exit(0)
}

for (const file of mapFiles) {
    fs.copyFileSync(path.join(RRWEB_DIST, file), path.join(TARGET_DIST, file))
}

console.log(`OK: copied ${mapFiles.length} rrweb worker sourcemap file(s) into dist/`)
