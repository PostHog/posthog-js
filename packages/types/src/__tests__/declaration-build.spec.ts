import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from 'vitest'

const packageRoot = resolve(__dirname, '../..')
const require = createRequire(join(packageRoot, 'package.json'))
const rslib = join(dirname(require.resolve('@rslib/core/package.json')), 'bin/rslib.js')

test('native declarations match TypeScript and retain semantic build failures', () => {
    const fixture = mkdtempSync(join(packageRoot, '.declaration-build-'))
    const source = join(fixture, 'src')
    const output = join(fixture, 'dist')
    const config = join(fixture, 'rslib.config.mjs')
    try {
        cpSync(join(packageRoot, 'src'), source, {
            recursive: true,
            filter: (path) => !path.includes('__tests__'),
        })
        writeFileSync(
            join(fixture, 'tsconfig.json'),
            JSON.stringify({
                extends: join(packageRoot, 'tsconfig.build.json'),
                compilerOptions: { rootDir: source, outDir: output },
                include: ['src/**/*'],
                exclude: [],
            })
        )
        const build = (native: boolean) => {
            rmSync(output, { recursive: true, force: true })
            writeFileSync(
                config,
                `
import original from ${JSON.stringify(pathToFileURL(join(packageRoot, 'rslib.config.ts')).href)}
export default {
    ...original,
    lib: ${native ? 'original.lib' : 'original.lib.map(lib => ({ ...lib, dts: true }))'},
    source: {
        ...original.source,
        entry: { index: [${JSON.stringify(join(source, '**/*'))}] },
        tsconfigPath: ${JSON.stringify(join(fixture, 'tsconfig.json'))},
    },
    output: { ...original.output, distPath: { root: ${JSON.stringify(output)} } },
}
`
            )
            const result = spawnSync(process.execPath, [rslib, 'build', '--config', config], {
                cwd: packageRoot,
                encoding: 'utf8',
                timeout: 60_000,
            })
            expect(result.error).toBeUndefined()
            expect(result.signal).toBeNull()
            return { status: result.status, diagnostics: result.stdout + result.stderr }
        }
        const artifacts = () =>
            Object.fromEntries(
                readdirSync(output, { recursive: true, withFileTypes: true })
                    .filter((entry) => entry.isFile())
                    .map((entry) => {
                        const path = join(entry.parentPath, entry.name)
                        return [relative(output, path), createHash('sha256').update(readFileSync(path)).digest('hex')]
                    })
            )
        const baseline = build(false)
        expect(baseline.status, baseline.diagnostics).toBe(0)
        const expected = artifacts()
        expect(Object.keys(expected)).toContain('index.d.ts')
        const native = build(true)
        expect(native.status, native.diagnostics).toBe(0)
        expect(artifacts()).toEqual(expected)

        writeFileSync(join(source, 'semantic-error.ts'), 'export const mustFail: string = 123\n')
        for (const native of [false, true]) {
            const result = build(native)
            expect(result.status, result.diagnostics).not.toBe(0)
            expect(result.diagnostics).toContain('TS2322')
            expect(result.diagnostics).toContain('semantic-error.ts')
        }
    } finally {
        rmSync(fixture, { recursive: true, force: true })
    }
}, 120_000)
