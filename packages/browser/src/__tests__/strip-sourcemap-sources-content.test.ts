import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { stripSourceMapSourcesContent } from '../../scripts/strip-sourcemap-sources-content'

describe('stripSourceMapSourcesContent', () => {
    let packageRoot: string

    beforeEach(() => {
        packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-strip-sourcemaps-'))
        fs.mkdirSync(path.join(packageRoot, 'dist'))
    })

    afterEach(() => {
        fs.rmSync(packageRoot, { recursive: true, force: true })
    })

    it('fails packing when no source maps are present', () => {
        const scriptsDir = path.join(packageRoot, 'scripts')
        const scriptPath = path.join(scriptsDir, 'strip-sourcemap-sources-content.js')
        fs.mkdirSync(scriptsDir)
        fs.copyFileSync(path.resolve(__dirname, '../../scripts/strip-sourcemap-sources-content.js'), scriptPath)

        const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' })

        expect(result.status).toBe(1)
        expect(result.stderr).toContain('FAIL: no source maps found in dist/, lib/ or react/dist/')
    })

    it('retains source maps while removing sourcesContent', () => {
        const mapPath = path.join(packageRoot, 'dist', 'main.js.map')
        fs.writeFileSync(
            mapPath,
            JSON.stringify({
                version: 3,
                sources: ['main.ts'],
                sourcesContent: ['export const value = 1'],
                names: [],
                mappings: '',
            })
        )

        expect(stripSourceMapSourcesContent(packageRoot)).toMatchObject({ stripped: 1, total: 1 })
        expect(fs.existsSync(mapPath)).toBe(true)
        expect(JSON.parse(fs.readFileSync(mapPath, 'utf8'))).not.toHaveProperty('sourcesContent')
    })
})
