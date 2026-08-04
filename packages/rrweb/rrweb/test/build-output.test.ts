import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('build output', () => {
    it('does not include a source map URL in the inline canvas worker', () => {
        const bundle = readFileSync(resolve(__dirname, '../dist/rrweb.js'), 'utf8')

        expect(bundle).not.toContain('sourceMappingURL=image-bitmap-data-url-worker-')
        expect(bundle).toContain('sourceMappingURL=rrweb.js.map')
    })
})
