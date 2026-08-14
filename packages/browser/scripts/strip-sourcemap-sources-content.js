#!/usr/bin/env node

/**
 * Pre-pack step: drop `sourcesContent` from the source maps we publish to npm.
 *
 * The maps have to stay — downstream bundlers chain through them, and dropping them would
 * leave every `//# sourceMappingURL` dangling. But the inlined copy of our sources is ~3/4 of
 * their weight and nothing downstream reads it; positions still resolve without it.
 *
 * On `prepack` rather than in the build because the CDN artifacts keep their inlined sources —
 * the release workflow builds those in a separate job (`build-s3-artifacts`), so pack-time
 * stripping never reaches them.
 *
 * Rewrites in place, so a local `pnpm pack` leaves you without inlined sources until you build
 * again.
 */

const fs = require('fs')
const path = require('path')

const PACKAGE_ROOT = path.resolve(__dirname, '..')

function findMaps(dir) {
    if (!fs.existsSync(dir)) {
        return []
    }
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            return findMaps(entryPath)
        }
        return entry.name.endsWith('.js.map') ? [entryPath] : []
    })
}

const distDir = path.join(PACKAGE_ROOT, 'dist')
if (!fs.existsSync(distDir)) {
    console.error('FAIL: dist/ is missing — run `pnpm build` before packing')
    process.exit(1)
}

// Every directory in `files` that carries maps. `react/dist` is npm-only (the S3 upload takes
// `dist/*.js{,.map}` and nothing else), so it's safe to strip here too.
const maps = [distDir, path.join(PACKAGE_ROOT, 'lib'), path.join(PACKAGE_ROOT, 'react', 'dist')].flatMap(findMaps)

if (maps.length === 0) {
    console.warn('warn: no source maps found in dist/, lib/ or react/dist/ — nothing to strip')
    process.exit(0)
}

let stripped = 0
let bytesBefore = 0
let bytesAfter = 0

for (const mapPath of maps) {
    const raw = fs.readFileSync(mapPath, 'utf8')
    const map = JSON.parse(raw)
    bytesBefore += Buffer.byteLength(raw)

    if (!map.sourcesContent) {
        bytesAfter += Buffer.byteLength(raw)
        continue
    }

    delete map.sourcesContent
    const output = JSON.stringify(map)
    fs.writeFileSync(mapPath, output)
    bytesAfter += Buffer.byteLength(output)
    stripped++
}

const asMb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

console.log(
    `OK: stripped sourcesContent from ${stripped}/${maps.length} source map(s), ${asMb(bytesBefore)} -> ${asMb(bytesAfter)}`
)
