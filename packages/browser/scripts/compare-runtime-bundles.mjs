/* oxlint-disable no-console -- This CLI prints the bundle comparison. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { parseSync } from 'rolldown/utils'

const [baselineDir, currentDir = 'dist'] = process.argv.slice(2)
assert.ok(baselineDir, 'Usage: node scripts/compare-runtime-bundles.mjs <baseline-dist> [current-dist]')

const files = (dir) =>
    fs
        .readdirSync(dir)
        .filter((file) => /\.(m?js|d\.ts)(\.map)?$/.test(file))
        .sort()
assert.deepEqual(files(currentDir), files(baselineDir), 'Published artifact filenames changed')

function moduleContract(file, code) {
    const { module, errors } = parseSync(file, code)
    assert.deepEqual(errors, [], `${file}: parse errors`)
    return {
        imports: module.staticImports.map(({ moduleRequest }) => moduleRequest.value).sort(),
        exports: module.staticExports
            .flatMap(({ entries }) =>
                entries.map(
                    ({ exportName, moduleRequest }) =>
                        `${moduleRequest?.value ?? ''}:${exportName.kind}:${exportName.name ?? ''}`
                )
            )
            .sort(),
    }
}

const size = (buffer) => [buffer.length, gzipSync(buffer).length, brotliCompressSync(buffer).length]
const delta = (before, after) => `${before} → ${after} (${((after / before - 1) * 100).toFixed(2)}%)`
console.log('| Bundle | Raw bytes | Gzip bytes | Brotli bytes |')
console.log('| --- | ---: | ---: | ---: |')
for (const file of files(currentDir)) {
    const before = fs.readFileSync(path.join(baselineDir, file))
    const after = fs.readFileSync(path.join(currentDir, file))
    if (file.endsWith('.d.ts')) {
        assert.deepEqual(after, before, `${file}: declarations changed`)
    } else if (/\.m?js$/.test(file)) {
        assert.deepEqual(
            moduleContract(file, after.toString()),
            moduleContract(file, before.toString()),
            `${file}: module contract changed`
        )
        const beforeSizes = size(before)
        console.log(
            `| ${file} | ${size(after)
                .map((bytes, i) => delta(beforeSizes[i], bytes))
                .join(' | ')} |`
        )
    }
}
console.log(
    '\nArtifact filenames, declarations, ESM export names and external import paths match. Runtime compatibility requires separate tests.'
)
