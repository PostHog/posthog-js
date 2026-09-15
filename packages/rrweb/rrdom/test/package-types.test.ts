import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'

const workspace = path.resolve(__dirname, '../..')
const packages = ['rrdom', 'rrweb-snapshot', 'types'].map((directory) => ({
    directory: path.join(workspace, directory),
    manifest: JSON.parse(readFileSync(path.join(workspace, directory, 'package.json'), 'utf8')),
}))

it.each(['@posthog/rrdom', '@posthog/rrweb-snapshot'])(
    '%s exposes resolvable ESM and CommonJS types without devDependencies',
    (name) => {
        const fixture = mkdtempSync(path.join(tmpdir(), 'rrweb-package-types-'))
        function install(packageName: string, nodeModules: string) {
            const pkg = packages.find(({ manifest }) => manifest.name === packageName)
            if (!pkg) return
            const destination = path.join(nodeModules, packageName)
            cpSync(path.join(pkg.directory, 'dist'), path.join(destination, 'dist'), {
                recursive: true,
            })
            writeFileSync(path.join(destination, 'package.json'), JSON.stringify(pkg.manifest))
            for (const dependency of Object.keys(pkg.manifest.dependencies ?? {})) {
                install(dependency, path.join(destination, 'node_modules'))
            }
        }

        try {
            install(name, path.join(fixture, 'node_modules'))
            const entrypoints = name.endsWith('/rrweb-snapshot') ? [name, `${name}/record`, `${name}/replay`] : [name]
            const consumer = entrypoints.map((entry, i) => `export * as entry${i} from '${entry}';`).join('\n')
            for (const extension of ['mts', 'cts']) {
                writeFileSync(path.join(fixture, `consumer.${extension}`), consumer)
            }
            writeFileSync(
                path.join(fixture, 'tsconfig.json'),
                JSON.stringify({
                    compilerOptions: {
                        noEmit: true,
                        strict: true,
                        skipLibCheck: false,
                        target: 'ES2020',
                        module: 'NodeNext',
                        types: [],
                    },
                    files: ['consumer.mts', 'consumer.cts'],
                })
            )
            const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc')], {
                cwd: fixture,
                encoding: 'utf8',
            })
            expect(result.error).toBeUndefined()
            expect(result.status, result.stdout + result.stderr).toBe(0)
        } finally {
            rmSync(fixture, { recursive: true, force: true })
        }
    }
)
