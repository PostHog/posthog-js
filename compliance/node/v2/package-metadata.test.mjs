// Synthetic packages test installed identity discovery, not SDK conformance.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { packageMetadata } from './package-metadata.mjs'

for (const version of ['5.52.4', '97.3.1-test']) {
    test(`reads installed version ${version} behind public exports and fingerprints metadata/entry`, () => {
        const root = mkdtempSync(join(tmpdir(), 'posthog-v2-metadata-'))
        try {
            const pkg = join(root, 'node_modules/posthog-node')
            mkdirSync(pkg, { recursive: true })
            const metadata = { name: 'posthog-node', version, exports: './entry.cjs' }
            const write = () => writeFileSync(join(pkg, 'package.json'), JSON.stringify(metadata))
            write()
            writeFileSync(join(pkg, 'entry.cjs'), 'exports.PostHog = class {}')
            const require = createRequire(join(root, 'package.json'))
            const original = packageMetadata(require, 'posthog-node')
            assert.equal(original.version, version)
            metadata.description = 'different package metadata'
            write()
            assert.notEqual(packageMetadata(require, 'posthog-node').metadata_sha256, original.metadata_sha256)
            writeFileSync(join(pkg, 'entry.cjs'), 'exports.PostHog = class Changed {}')
            assert.notEqual(packageMetadata(require, 'posthog-node').entry_sha256, original.entry_sha256)
            for (const invalid of ['', ' ', null, 42, undefined]) {
                metadata.version = invalid
                write()
                assert.throws(() => packageMetadata(require, 'posthog-node'), /no version/)
            }
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })
}
