import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

describe('built static loader', () => {
    it('stays small and does not bundle the SDK core or extensions', () => {
        const dist = path.resolve(__dirname, '../../../dist')
        const source = fs.readFileSync(path.join(dist, 'loader.js'))
        const map = JSON.parse(fs.readFileSync(path.join(dist, 'loader.js.map'), 'utf8'))

        expect(gzipSync(source).byteLength).toBeLessThan(3 * 1024)
        expect(map.sources.some((file: string) => file.includes('posthog-core') || file.includes('/extensions/'))).toBe(
            false
        )
    })
})
