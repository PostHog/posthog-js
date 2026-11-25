import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PostHogExtensionKind } from '../../utils/globals'
import { EXTENSION_INTEGRITY } from '../../utils/extension-integrity'
import * as buildScript from '../../../scripts/extension-integrity.mjs'

const { EXTENSION_FILES, embedExtensionIntegrity, placeholderFor, readEmbeddedIntegrity, verifyEmbeddedIntegrity } =
    buildScript as {
        EXTENSION_FILES: string[]
        embedExtensionIntegrity: (dist: string) => { hashes: Record<string, string>; embedded: string[] }
        placeholderFor: (file: string) => string
        readEmbeddedIntegrity: (code: string) => Record<string, string> | undefined
        verifyEmbeddedIntegrity: (dist: string, extensionsDist?: string) => string[]
    }

const dist = path.resolve(__dirname, '../../../dist')
const sha384 = (file: string) =>
    `sha384-${createHash('sha384')
        .update(new Uint8Array(fs.readFileSync(file)))
        .digest('base64')}`

// Every kind except those that can't be pinned must have a built-in hash.
const PINNED_KINDS = {
    'exception-autocapture': true,
    'web-vitals': true,
    'web-vitals-with-attribution': true,
    'web-vitals-soft-navs': true,
    'web-vitals-with-attribution-soft-navs': true,
    recorder: true,
    'lazy-recorder': true,
    'tracing-headers': true,
    surveys: true,
    logs: true,
    conversations: true,
    'product-tours': true,
    'dead-clicks-autocapture': true,
    'intercom-integration': true,
    'crisp-chat-integration': true,
} satisfies Record<Exclude<PostHogExtensionKind, 'toolbar' | 'remote-config'>, true>

describe('extension integrity', () => {
    it('covers every pinnable extension kind', () => {
        const expected = Object.keys(PINNED_KINDS)
            .map((kind) => `${kind}.js`)
            .sort()
        expect([...EXTENSION_FILES].sort()).toEqual(expected)
        expect(Object.keys(EXTENSION_INTEGRITY).sort()).toEqual(expected)
        for (const file of expected) {
            expect(EXTENSION_INTEGRITY[file]).toBe(placeholderFor(file))
            expect(placeholderFor(file)).toHaveLength(`sha384-${'A'.repeat(64)}`.length)
            expect(placeholderFor(file)).not.toMatch(/^sha384-[A-Za-z0-9+/]{64}$/)
        }
    })

    describe('built bundles', () => {
        const coreBundles = [
            'array.js',
            'array.full.js',
            'main.js',
            'module.js',
            'module.mjs',
            'module.full.js',
            'module.full.cjs',
            'module.slim.js',
            'external-scripts-loader.js',
        ]

        it.each(coreBundles)('%s embeds the SHA-384 of every final extension file', (bundle) => {
            const embedded = readEmbeddedIntegrity(fs.readFileSync(path.join(dist, bundle), 'utf8'))
            expect(embedded).toEqual(
                Object.fromEntries(EXTENSION_FILES.map((file) => [file, sha384(path.join(dist, file))]))
            )
        })

        it('only bundles with the external scripts loader embed the map', () => {
            expect(verifyEmbeddedIntegrity(dist).sort()).toEqual([...coreBundles].sort())
        })

        it.each([
            'array.no-external.js',
            'array.full.no-external.js',
            'array.full.es5.js',
            'module.no-external.js',
            'module.full.no-external.js',
            'module.slim.no-external.js',
            ...EXTENSION_FILES,
        ])('%s does not contain the map or a placeholder', (bundle) => {
            const code = fs.readFileSync(path.join(dist, bundle), 'utf8')
            expect(readEmbeddedIntegrity(code)).toBeUndefined()
            expect(code).not.toContain('sha384-~')
        })

        it('leaves no placeholder in any emitted file', () => {
            for (const file of fs.readdirSync(dist)) {
                if (/\.(?:[cm]?js|map)$/.test(file)) {
                    expect(fs.readFileSync(path.join(dist, file), 'utf8')).not.toContain('sha384-~')
                }
            }
        })

        it('the integrity manifest matches the patched core bytes', () => {
            const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'integrity.json'), 'utf8'))
            for (const bundle of coreBundles) {
                expect(manifest.files[bundle]).toBe(sha384(path.join(dist, bundle)))
            }
        })
    })

    describe('embedding', () => {
        let directory: string

        beforeEach(() => {
            directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-extension-integrity-'))
            for (const file of EXTENSION_FILES) {
                fs.writeFileSync(path.join(directory, file), `/* ${file} */`)
            }
        })

        afterEach(() => {
            fs.rmSync(directory, { recursive: true, force: true })
        })

        const map = () => `var m={${EXTENSION_FILES.map((f) => `"${f}":"${placeholderFor(f)}"`).join(',')}};`

        it('is deterministic and preserves byte length and source maps', () => {
            const code = `${map()}\n//# sourceMappingURL=array.js.map`
            const sourceMap = JSON.stringify({ version: 3, mappings: 'AAAA', sourcesContent: [map()] })
            fs.writeFileSync(path.join(directory, 'array.js'), code)
            fs.writeFileSync(path.join(directory, 'array.js.map'), sourceMap)

            const { embedded } = embedExtensionIntegrity(directory)
            const first = fs.readFileSync(path.join(directory, 'array.js'), 'utf8')

            expect(embedded).toEqual(['array.js'])
            expect(Buffer.byteLength(first)).toBe(Buffer.byteLength(code))
            expect(fs.readFileSync(path.join(directory, 'array.js.map'), 'utf8')).toHaveLength(sourceMap.length)
            expect(verifyEmbeddedIntegrity(directory)).toEqual(['array.js'])

            fs.writeFileSync(path.join(directory, 'array.js'), code)
            embedExtensionIntegrity(directory)
            expect(fs.readFileSync(path.join(directory, 'array.js'), 'utf8')).toBe(first)
        })

        it('rejects an extension that embeds the map', () => {
            fs.writeFileSync(path.join(directory, 'surveys.js'), map())
            expect(() => embedExtensionIntegrity(directory)).toThrow(/surveys\.js is an integrity-pinned extension/)
        })

        it('rejects a bundle with a duplicated placeholder', () => {
            fs.writeFileSync(path.join(directory, 'array.js'), map() + map())
            expect(() => embedExtensionIntegrity(directory)).toThrow(/exactly once/)
        })

        it('detects hashes that differ from another build of the extensions', () => {
            fs.writeFileSync(path.join(directory, 'array.js'), map())
            embedExtensionIntegrity(directory)
            const other = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-extension-integrity-s3-'))
            try {
                for (const file of EXTENSION_FILES) {
                    fs.writeFileSync(path.join(other, file), `/* ${file} */`)
                }
                expect(verifyEmbeddedIntegrity(directory, other)).toEqual(['array.js'])
                fs.writeFileSync(path.join(other, 'recorder.js'), '/* different bytes */')
                expect(() => verifyEmbeddedIntegrity(directory, other)).toThrow(/array\.js embeds .* for recorder\.js/)
            } finally {
                fs.rmSync(other, { recursive: true, force: true })
            }
        })
    })
})
