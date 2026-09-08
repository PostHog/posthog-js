import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('build output', () => {
    it('does not include a source map URL in the inline canvas worker', () => {
        const bundle = readFileSync(resolve(__dirname, '../dist/rrweb-record.js'), 'utf8')

        expect(bundle).not.toContain('sourceMappingURL=image-bitmap-data-url-worker-')
        expect(bundle).toContain('sourceMappingURL=rrweb-record.js.map')
    })

    it('emits matching ESM and CommonJS declarations', () => {
        const esmDeclarations = readFileSync(resolve(__dirname, '../dist/index.d.ts'), 'utf8')
        const commonJsDeclarations = readFileSync(resolve(__dirname, '../dist/index.d.cts'), 'utf8')

        const expectedExports = [
            'DeferredStylesheetStats',
            'MutationCost',
            'SnapshotCost',
            'getDeferredStylesheetStats',
            'getDiscardedDurationSamples',
            'getLastSnapshotCost',
            'getMutationCost',
            'record',
            'resetMaxDepthState',
            'resetSnapshotCostState',
            'wasMaxDepthReached',
        ]

        expect(commonJsDeclarations).toBe(esmDeclarations)
        expectedExports.forEach((exportName) => expect(esmDeclarations).toContain(exportName))
    })
})
