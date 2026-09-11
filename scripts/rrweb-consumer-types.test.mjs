import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const filters = ['rrdom-nodejs', '@posthog/rrweb-plugin-canvas-webrtc-record', '@posthog/core']
const versions = ['4.7.4', '5.8.2', '6.0.3']
const env = { ...process.env, CI: '1', PREK: '0', PUPPETEER_SKIP_DOWNLOAD: '1' }

// Use real installed tarballs: workspace hoisting hides missing declaration dependencies.
// Retain the consumer, tarballs and compiler logs outside the repository for diagnosis.
test('strict rrdom-nodejs, canvas WebRTC and core installed consumer declarations', async (t) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'rrweb-consumer-types-'))
    t.diagnostic(`Artifacts: ${fixture}`)
    function pnpm(args, cwd, log) {
        const result = spawnSync('pnpm', args, { cwd, env, encoding: 'utf8' })
        writeFileSync(path.join(fixture, log), result.stdout + result.stderr)
        assert.equal(result.status, 0, `${args.join(' ')}: see ${path.join(fixture, log)}`)
    }
    pnpm(
        [
            '--filter=@posthog/rrweb-plugin-canvas-webrtc-record',
            '--filter=@posthog-tooling/rrweb-build',
            'peers',
            'check',
        ],
        root,
        'build-tool-peers.log'
    )
    pnpm(['turbo', 'run', 'build', ...filters.map((name) => `--filter=${name}`)], root, 'build.log')
    const packages = JSON.parse(
        execFileSync('pnpm', ['list', ...filters.map((name) => `--filter=${name}...`), '--depth', '-1', '--json'], {
            cwd: root,
            env,
            encoding: 'utf8',
        })
    ).filter((pkg) => !JSON.parse(readFileSync(path.join(pkg.path, 'package.json'), 'utf8')).private)
    const tarballs = path.join(fixture, 'tarballs')
    mkdirSync(tarballs)
    const dependencies = {}
    for (const [index, pkg] of packages.entries()) {
        const tarball = path.join(tarballs, `${index}.tgz`)
        pnpm(['pack', '--out', tarball], pkg.path, `pack-${index}.log`)
        dependencies[pkg.name] = `file:${tarball}`
    }
    for (const nodeTypes of [undefined, '22.19.1', '24.13.3']) {
        const label = nodeTypes ? `node-${nodeTypes}` : 'browser'
        const consumer = path.join(fixture, label)
        mkdirSync(consumer)
        const compilers = nodeTypes ? versions.slice(1) : versions
        writeFileSync(
            path.join(consumer, 'package.json'),
            JSON.stringify(
                {
                    private: true,
                    packageManager: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).packageManager,
                    dependencies,
                    devDependencies: {
                        ...Object.fromEntries(
                            compilers.map((version) => [`typescript-${version}`, `npm:typescript@${version}`])
                        ),
                        ...(nodeTypes ? { '@types/node': nodeTypes } : {}),
                    },
                },
                null,
                2
            )
        )
        // Overrides ensure transitive workspace ranges resolve to the same built tarballs.
        writeFileSync(
            path.join(consumer, 'pnpm-workspace.yaml'),
            `minimumReleaseAge: 10080\noverrides: ${JSON.stringify(dependencies)}\n`
        )
        pnpm(['install', '--lockfile-only'], consumer, `${label}-lock.log`)
        pnpm(['install', '--frozen-lockfile'], consumer, `${label}-install.log`)
        for (const name of Object.keys(dependencies)) {
            assert.ok(
                realpathSync(path.join(consumer, 'node_modules', name)).startsWith(realpathSync(consumer) + path.sep)
            )
        }
        const plugin = path.join(consumer, 'node_modules/@posthog/rrweb-plugin-canvas-webrtc-record')
        assert.equal(
            readFileSync(path.join(plugin, 'dist/simple-peer-light.d.ts'), 'utf8'),
            readFileSync(
                path.join(root, 'packages/rrweb/plugins/rrweb-plugin-canvas-webrtc-record/src/simple-peer-light.d.ts'),
                'utf8'
            )
        )
        assert.equal(
            readFileSync(path.join(plugin, 'dist/index.d.ts'), 'utf8'),
            readFileSync(path.join(plugin, 'dist/index.d.cts'), 'utf8')
        )
        for (const format of ['mts', 'cts']) {
            const source = readFileSync(path.join(root, 'scripts/fixtures/rrweb-consumer-types/consumer.ts'), 'utf8')
            const nodeSource = nodeTypes
                ? readFileSync(path.join(root, 'scripts/fixtures/rrweb-consumer-types/node.ts'), 'utf8')
                : ''
            writeFileSync(path.join(consumer, `consumer.${format}`), source + nodeSource)
            const config = `tsconfig.${format}.json`
            writeFileSync(
                path.join(consumer, config),
                JSON.stringify({
                    compilerOptions: {
                        strict: true,
                        skipLibCheck: false,
                        noEmit: true,
                        target: 'ES2020',
                        module: 'NodeNext',
                        moduleResolution: 'NodeNext',
                        types: nodeTypes ? ['node'] : [],
                    },
                    files: [`consumer.${format}`],
                })
            )
            for (const version of compilers) {
                await t.test(`${label} TypeScript ${version} ${format}`, () => {
                    const compiler = path.join(consumer, 'node_modules', `typescript-${version}`, 'bin/tsc')
                    const result = spawnSync(
                        process.execPath,
                        [compiler, '-p', config, '--pretty', 'false', '--listFiles'],
                        {
                            cwd: consumer,
                            env,
                            encoding: 'utf8',
                        }
                    )
                    writeFileSync(
                        path.join(fixture, `${label}-${version}-${format}.log`),
                        result.stdout + result.stderr
                    )
                    assert.equal(result.status, 0, result.stdout + result.stderr)
                    if (nodeTypes) {
                        // The shim must coexist with, not replace, the consumer's Node globals.
                        assert.ok(
                            result.stdout.includes(
                                realpathSync(path.join(consumer, 'node_modules/@types/node')) + path.sep
                            )
                        )
                        assert.ok(!result.stdout.includes('@types+node@16.'))
                    }
                })
            }
        }
    }
})
