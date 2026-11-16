import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

describe('built integrity manifest', () => {
    it('contains hashes of the exact final runtime bytes', () => {
        const dist = path.resolve(__dirname, '../../../dist')
        const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'integrity.json'), 'utf8'))
        const runtimeFiles = fs
            .readdirSync(dist, { recursive: true })
            .filter((file): file is string => typeof file === 'string' && /\.(?:[cm]?js|css|wasm)$/.test(file))
            .map((file) => file.split(path.sep).join('/'))
            .sort()
        expect(Object.keys(manifest.files)).toEqual(runtimeFiles)
        for (const file of runtimeFiles) {
            const integrity =
                'sha384-' +
                createHash('sha384')
                    .update(new Uint8Array(fs.readFileSync(path.join(dist, file))))
                    .digest('base64')
            expect(manifest.files[file]).toBe(integrity)
        }
        expect(manifest.files).toHaveProperty('array.js')
        expect(manifest.files).toHaveProperty('loader.js')
        expect(manifest.files).toHaveProperty('recorder.js')
    })
})
