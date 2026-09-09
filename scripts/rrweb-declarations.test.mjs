import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { globSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { rolldown } from 'rolldown'
import declarations from '../packages/rrweb/rolldown.dts.config.mts'

const root = path.resolve(import.meta.dirname, '..')
const manifests = globSync(['packages/rrweb/*/package.json', 'packages/rrweb/plugins/*/package.json'], { cwd: root })

for (const isolatedDeclarations of [true, false]) {
    test(`self-contained dual declarations with ${isolatedDeclarations ? 'Oxc' : 'TypeScript'}`, async () => {
        const cwd = process.cwd()
        const fixture = mkdtempSync(path.join(tmpdir(), 'rrweb-declarations-'))
        try {
            symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir')
            writeFileSync(path.join(fixture, 'package.json'), '{"type":"module"}')
            writeFileSync(
                path.join(fixture, 'tsconfig.json'),
                JSON.stringify({
                    compilerOptions: {
                        isolatedDeclarations,
                        declaration: true,
                        strict: true,
                        skipLibCheck: true,
                        target: 'ESNext',
                        module: 'ESNext',
                        moduleResolution: 'Node',
                        types: [],
                    },
                    include: ['*.ts'],
                })
            )
            writeFileSync(path.join(fixture, 'shared.ts'), 'export interface Shared { value: string }')
            writeFileSync(
                path.join(fixture, 'index.ts'),
                `
                import './style.css';
                export type { CompilerOptions } from 'typescript';
                export type { Shared } from './shared';
                export const value: number = 1;
            `
            )
            writeFileSync(path.join(fixture, 'secondary.ts'), "export type { Shared } from './shared';")
            process.chdir(fixture)
            for (const config of declarations({ index: 'index.ts', secondary: 'secondary.ts' })) {
                const build = await rolldown(config)
                try {
                    await build.write(config.output)
                } finally {
                    await build.close()
                }
            }
            assert.deepEqual(readdirSync('dist').sort(), [
                'index.d.cts',
                'index.d.ts',
                'secondary.d.cts',
                'secondary.d.ts',
            ])
            for (const name of ['index', 'secondary']) {
                const esm = readFileSync(`dist/${name}.d.ts`, 'utf8')
                assert.equal(readFileSync(`dist/${name}.d.cts`, 'utf8'), esm)
                assert.match(esm, /interface Shared/)
                assert.doesNotMatch(esm, /["']\.\.?\//)
            }
            assert.match(readFileSync('dist/index.d.ts', 'utf8'), /from ["']typescript["']/)
            writeFileSync('invalid.ts', 'export const invalid: number = "not a number";')
            assert.throws(
                () =>
                    execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'], {
                        stdio: 'pipe',
                    }),
                (error) => error.status !== 0 && error.stdout.toString().includes('TS2322')
            )
        } finally {
            process.chdir(cwd)
            rmSync(fixture, { recursive: true, force: true })
        }
    })
}

test('every rrweb production build retains semantic checking before declaration emission', () => {
    assert.equal(manifests.length, 16)
    for (const manifest of manifests) {
        const { scripts } = JSON.parse(readFileSync(path.join(root, manifest), 'utf8'))
        assert.equal(scripts.prepublish, undefined, manifest)
        assert.equal(scripts.build, 'pnpm check-types && vite build && pnpm build:declarations', manifest)
        assert.equal(scripts['check-types'], 'tsc --noEmit', manifest)
        assert.equal(scripts['build:declarations'], 'rolldown -c rolldown.dts.config.mts', manifest)
        assert.equal(scripts['dev:runtime'] ?? scripts.dev, 'vite build --watch', manifest)
        if (scripts['dev:runtime']) {
            assert.equal(scripts['dev:declarations'], 'pnpm build:declarations --watch', manifest)
        }
    }
})
