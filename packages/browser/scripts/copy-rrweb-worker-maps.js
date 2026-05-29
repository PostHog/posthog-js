#!/usr/bin/env node

// Postbuild: copy rrweb's image-bitmap-data-url-worker-*.js.map into dist/ so the
// sourceMappingURL in our bundled rrweb.js resolves for downstream consumers.

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
    // Fail loudly rather than silently shipping without the sourcemap.
    console.error('error: no image-bitmap-data-url-worker-*.js.map files found in @posthog/rrweb dist')
    process.exit(1)
}

for (const file of mapFiles) {
    fs.copyFileSync(path.join(RRWEB_DIST, file), path.join(TARGET_DIST, file))
}

console.log(`OK: copied ${mapFiles.length} rrweb worker sourcemap file(s) into dist/`)
