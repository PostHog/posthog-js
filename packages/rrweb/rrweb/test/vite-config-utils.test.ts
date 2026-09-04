import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureSourcemap } from '../../vite.config.utils'

const temporaryDirectories: string[] = []

afterEach(() => {
    temporaryDirectories.splice(0).forEach((directory) => {
        rmSync(directory, { recursive: true, force: true })
    })
})

describe('ensureSourcemap', () => {
    it('preserves a bundler-generated map after a second watch build', () => {
        const outputDir = mkdtempSync(join(tmpdir(), 'rrweb-vite-config-'))
        temporaryDirectories.push(outputDir)
        const outputPath = join(outputDir, 'facade.js')
        const mapPath = `${outputPath}.map`
        const generatedMap = {
            version: 3,
            file: 'facade.js',
            sources: ['source.ts'],
            mappings: 'AAAA',
        }

        writeFileSync(outputPath, 'export { value };')
        ensureSourcemap(outputDir, 'facade.js')

        writeFileSync(mapPath, JSON.stringify(generatedMap))
        writeFileSync(outputPath, 'export { nextValue };')
        ensureSourcemap(outputDir, 'facade.js')

        expect(readFileSync(outputPath, 'utf8')).toBe('export { nextValue };\n//# sourceMappingURL=facade.js.map\n')
        expect(JSON.parse(readFileSync(mapPath, 'utf8'))).toEqual(generatedMap)
    })

    it('preserves a current bundler-generated map', () => {
        const outputDir = mkdtempSync(join(tmpdir(), 'rrweb-vite-config-'))
        temporaryDirectories.push(outputDir)
        const outputPath = join(outputDir, 'mapped.cjs')
        const mapPath = `${outputPath}.map`
        const generatedMap = { version: 3, file: 'mapped.cjs', mappings: 'AAAA' }

        writeFileSync(outputPath, 'exports.value = 1;\n//# sourceMappingURL=mapped.cjs.map\n')
        writeFileSync(mapPath, JSON.stringify(generatedMap))
        ensureSourcemap(outputDir, 'mapped.cjs')

        expect(JSON.parse(readFileSync(mapPath, 'utf8'))).toEqual(generatedMap)
    })
})
