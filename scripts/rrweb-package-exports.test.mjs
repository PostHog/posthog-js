import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const packages = new Map(
    globSync(['packages/*/package.json', 'packages/rrweb/*/package.json'], { cwd: root }).map((file) => {
        const manifest = JSON.parse(readFileSync(path.join(root, file), 'utf8'))
        return [manifest.name, { manifest, directory: path.join(root, path.dirname(file)) }]
    })
)

// Build first via test:rrweb-package-exports. Only packed artifacts are installed in this consumer.
test('rrweb package exports from installed tarballs', async (t) => {
    const consumer = mkdtempSync(path.join(tmpdir(), 'rrweb-package-exports-'))
    const tarballs = path.join(consumer, 'tarballs')
    mkdirSync(tarballs)
    const dependencies = {}
    function pack(name) {
        if (dependencies[name]) return
        const { manifest, directory } = packages.get(name)
        const filename = `${name.replace('@', '').replace('/', '-')}.tgz`
        execFileSync('pnpm', ['pack', '--out', path.join(tarballs, filename)], {
            cwd: directory,
            encoding: 'utf8',
            stdio: 'pipe',
        })
        dependencies[name] = `file:./tarballs/${filename}`
        for (const [dependency, version] of Object.entries(manifest.dependencies ?? {})) {
            if (version.startsWith('workspace:')) pack(dependency)
        }
    }
    function node(source, format = 'module') {
        return execFileSync(process.execPath, [`--input-type=${format}`, '-e', source], {
            cwd: consumer,
            encoding: 'utf8',
            stdio: 'pipe',
        })
    }
    try {
        pack('@posthog/rrweb-all')
        pack('rrdom-nodejs')
        writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ private: true, dependencies }))
        execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
            cwd: consumer,
            encoding: 'utf8',
            stdio: 'pipe',
        })

        await t.test('all static tarball targets and relative imports exist', () => {
            execFileSync(process.execPath, [path.join(root, 'scripts/check-package-tarballs.js'), tarballs], {
                cwd: root,
                encoding: 'utf8',
                stdio: 'pipe',
            })
        })

        const nativeFixture = path.join(consumer, 'native-consumer.mjs')
        writeFileSync(
            nativeFixture,
            readFileSync(path.join(root, 'packages/rrweb/rrdom-nodejs/test/fixtures/native-consumer.mjs'))
        )
        for (const format of ['import', 'require']) {
            for (const performanceMode of ['with-performance', 'without-performance']) {
                await t.test(`rrdom-nodejs ${format} ${performanceMode}`, () => {
                    execFileSync(process.execPath, [nativeFixture, format, 'rrdom-nodejs', performanceMode], {
                        cwd: consumer,
                        encoding: 'utf8',
                        stdio: 'pipe',
                    })
                })
            }
        }

        for (const name of ['@posthog/rrweb-all', '@posthog/rrweb']) {
            const packageRoot = path.join(consumer, 'node_modules', name)
            const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
            await t.test(`${name} legacy manifest targets and dual declarations`, () => {
                for (const field of ['main', 'module', 'unpkg', 'typings']) {
                    assert.ok(readFileSync(path.join(packageRoot, manifest[field])).length, `${name} ${field}`)
                }
                const entry = manifest.exports['.']
                assert.equal(
                    readFileSync(path.join(packageRoot, entry.import.types), 'utf8'),
                    readFileSync(path.join(packageRoot, entry.require.types), 'utf8')
                )
            })
            for (const format of ['module', 'commonjs']) {
                await t.test(`${name} Node ${format} entrypoint`, () => {
                    node(
                        `const api = ${format === 'module' ? `await import('${name}')` : `require('${name}')`};
                        const assert = ${format === 'module' ? "await import('node:assert/strict')" : "require('node:assert/strict')"};
                        for (const key of ['record', 'Replayer'${name.endsWith('-all') ? ", 'pack', 'unpack'" : ''}]) {
                            assert.equal(typeof api[key], 'function', key);
                        }`,
                        format
                    )
                })
            }
        }

        for (const format of ['module', 'commonjs']) {
            await t.test(`both CSS specifiers resolve to the existing stylesheet in Node ${format}`, () => {
                node(
                    `const fs = ${format === 'module' ? "await import('node:fs')" : "require('node:fs')"};
                    const assert = ${format === 'module' ? "await import('node:assert/strict')" : "require('node:assert/strict')"};
                    const resolve = ${format === 'module' ? '(specifier) => new URL(import.meta.resolve(specifier))' : 'require.resolve'};
                    const original = fs.readFileSync('./node_modules/@posthog/rrweb/dist/style.css', 'utf8');
                    assert.ok(original.length > 0);
                    for (const name of ['rrweb', 'style']) {
                        assert.equal(fs.readFileSync(resolve('@posthog/rrweb/dist/' + name + '.css'), 'utf8'), original);
                    }`,
                    format
                )
            })
        }

        await t.test('existing rrweb-all physical bundle paths remain available', () => {
            for (const extension of ['js', 'cjs', 'umd.cjs', 'umd.min.cjs']) {
                assert.ok(
                    readFileSync(path.join(consumer, 'node_modules/@posthog/rrweb-all/dist', `rrweb-all.${extension}`))
                        .length
                )
            }
        })

        for (const extension of ['mts', 'cts']) {
            await t.test(`installed ${extension} declarations type-check`, () => {
                const filename = `consumer.${extension}`
                writeFileSync(
                    path.join(consumer, filename),
                    `import { record, Replayer, pack, unpack } from '@posthog/rrweb-all';
                    import { record as baseRecord, Replayer as BaseReplayer } from '@posthog/rrweb';
                    const recorder: typeof baseRecord = record;
                    const replayer: typeof BaseReplayer = Replayer;
                    recorder.addCustomEvent('test', { value: 1 });
                    const roundTrip: ReturnType<typeof unpack> = unpack(pack({} as Parameters<typeof pack>[0]));
                    void replayer; void roundTrip;`
                )
                writeFileSync(
                    path.join(consumer, 'tsconfig.json'),
                    JSON.stringify({
                        compilerOptions: {
                            noEmit: true,
                            strict: true,
                            skipLibCheck: false,
                            module: 'NodeNext',
                            target: 'ES2020',
                            // Do not auto-include unrelated ambient @types packages from dependencies.
                            types: [],
                        },
                        files: [filename],
                    })
                )
                execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', '.'], {
                    cwd: consumer,
                    encoding: 'utf8',
                    stdio: 'pipe',
                })
            })
        }
    } finally {
        rmSync(consumer, { recursive: true, force: true })
    }
})
