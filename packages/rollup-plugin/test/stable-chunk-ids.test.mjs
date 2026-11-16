import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { rollup } from 'rollup'
import { build } from 'vite'
import { createChunkIdSnippet } from '@posthog/plugin-utils'
import posthogRollupPlugin from '../dist/index.js'

for (const bundler of ['rollup', 'vite']) {
    test(`${bundler}: unrelated lazy chunks preserve existing event-mode chunk ids`, async (t) => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-stable-chunks-'))
        t.after(() => fs.rm(root, { recursive: true, force: true }))
        const cliPath = path.join(root, 'release-stub.cjs')
        await fs.writeFile(cliPath, '#!/usr/bin/env node\nprocess.stdout.write("release-a")\n')
        await fs.chmod(cliPath, 0o755)
        await fs.writeFile(path.join(root, 'shared.js'), 'export const shared = "shared";\n')
        await fs.writeFile(path.join(root, 'added.js'), 'export const added = "unrelated";\n')
        for (let i = 0; i < 40; i++) {
            await fs.writeFile(
                path.join(root, `page${i}.js`),
                `import { shared } from './shared.js'; export const page = () => shared + 'page${i}';\n`
            )
        }
        const entry = Array.from(
            { length: 40 },
            (_, i) => `export const load${i} = () => import('./page${i}.js');`
        ).join('\n')

        async function generate(code, releaseId = 'release-a', withPlugin = true) {
            await fs.writeFile(path.join(root, 'entry.js'), code)
            await fs.writeFile(cliPath, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(releaseId)})\n`)
            const plugins = withPlugin
                ? [
                      posthogRollupPlugin({
                          personalApiKey: 'phx_test',
                          projectId: '1',
                          cliBinaryPath: cliPath,
                          sourcemaps: { releaseMode: 'event', deleteAfterUpload: false },
                      }),
                  ]
                : []
            const outputOptions = {
                format: 'es',
                entryFileNames: 'assets/entry-[hash].js',
                chunkFileNames: 'assets/chunk-[hash].js',
                sourcemap: true,
            }
            let output
            if (bundler === 'rollup') {
                const bundle = await rollup({ input: path.join(root, 'entry.js'), plugins })
                try {
                    output = (await bundle.generate(outputOptions)).output
                } finally {
                    await bundle.close()
                }
            } else {
                const results = await build({
                    configFile: false,
                    root,
                    logLevel: 'silent',
                    plugins,
                    build: {
                        lib: { entry: path.join(root, 'entry.js'), formats: ['es'] },
                        write: false,
                        minify: 'oxc',
                        sourcemap: true,
                        rolldownOptions: { output: outputOptions },
                    },
                })
                output = results[0].output
            }
            return new Map(
                output
                    .filter((chunk) => chunk.type === 'chunk')
                    .map((chunk) => {
                        const id = chunk.code.match(/(?:^|\n)\/\/# chunkId=(\S+)/)?.[1]
                        if (withPlugin) {
                            assert.ok(id)
                            assert.ok(chunk.code.includes(createChunkIdSnippet(id, releaseId)))
                        }
                        return [chunk.name, { ...chunk, id }]
                    })
            )
        }

        const baseline = await generate(entry)
        assert.equal(baseline.size, 42)
        for (const variant of [
            `export const added = () => import('./added.js');\n${entry}`,
            `${entry}\nexport const added = () => import('./added.js');`,
        ]) {
            const added = await generate(variant)
            assert.equal(added.size, 43)
            assert.notEqual(added.get('entry').id, baseline.get('entry').id)
            for (const [name, chunk] of baseline) {
                if (name === 'entry') continue
                const next = added.get(name)
                for (const key of ['mappings', 'names', 'sources', 'sourcesContent']) {
                    assert.deepEqual(next.map[key], chunk.map[key], `${name}: ${key}`)
                }
                assert.equal(next.id, chunk.id, `${name}: stable id after adding a lazy chunk`)
            }
        }

        const nextRelease = await generate(entry, 'release-b')
        for (const [name, chunk] of baseline) {
            assert.equal(nextRelease.get(name).id, chunk.id, `${name}: stable id across releases`)
            assert.notEqual(nextRelease.get(name).fileName, chunk.fileName, `${name}: release-sensitive filename`)
        }

        const withoutPlugin = await generate(entry, 'release-a', false)
        for (let i = 0; i < 40; i++) {
            const name = `page${i}`
            const original = withoutPlugin.get(name)
            const injected = baseline.get(name)
            assert.deepEqual(injected.map.sources, original.map.sources)
            assert.deepEqual(injected.map.sourcesContent, original.map.sourcesContent)
            if (bundler === 'vite') assert.equal(injected.map.mappings, `;${original.map.mappings}`)
        }

        await fs.writeFile(
            path.join(root, 'page20.js'),
            "import { shared } from './shared.js'; export const page = () => shared + 'edited page20';\n"
        )
        const edited = await generate(entry)
        for (const [name, chunk] of baseline) {
            if (name === 'page20') assert.notEqual(edited.get(name).id, chunk.id)
            else assert.equal(edited.get(name).id, chunk.id, `${name}: unaffected by a leaf edit`)
        }
    })
}
