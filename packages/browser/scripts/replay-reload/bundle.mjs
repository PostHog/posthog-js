import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { URL, fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const sourcePaths = {
    core: 'core/src',
    types: 'types/src',
    'browser-common': 'browser-common/src',
    rrdom: 'rrweb/rrdom/src/index.ts',
    rrweb: 'rrweb/rrweb/src/entries/record.ts',
    'rrweb-record': 'rrweb/record/src/index.ts',
    'rrweb-plugin-console-record': 'rrweb/plugins/rrweb-plugin-console-record/src/index.ts',
    'rrweb-types': 'rrweb/types/src/index.ts',
    'rrweb-utils': 'rrweb/utils/src/index.ts',
    'rrweb-snapshot': 'rrweb/rrweb-snapshot/src/record.ts',
}

const inlineWorker = {
    name: 'rrweb-inline-worker',
    setup(builder) {
        builder.onLoad({ filter: /image-bitmap-data-url-worker\.ts$/ }, async ({ path: worker, suffix }) => {
            if (suffix !== '?worker&inline') return
            const result = await build({
                entryPoints: [worker],
                bundle: true,
                write: false,
                nodePaths: builder.initialOptions.nodePaths,
            })
            const source = JSON.stringify(result.outputFiles[0].text)
            return {
                contents: `export default class extends Worker { constructor() { super(URL.createObjectURL(new Blob([${source}], {type:'text/javascript'}))) } }`,
            }
        })
    },
}

export async function bundleRevision(ref) {
    const revision = execFileSync('git', ['rev-parse', '--verify', ref + '^{commit}'], {
        cwd: root,
        encoding: 'utf8',
    }).trim()
    const scratch = mkdtempSync(path.join(tmpdir(), 'posthog-replay-'))
    try {
        const archive = path.join(scratch, 'sdk.tar')
        const packages = ['browser', 'browser-common', 'core', 'types', 'rrweb']
        execFileSync(
            'git',
            ['archive', '--output', archive, revision, '--', ...packages.map((name) => 'packages/' + name)],
            { cwd: root }
        )
        execFileSync('tar', ['-xf', archive, '-C', scratch])
        const sources = path.join(scratch, 'packages')
        const alias = Object.fromEntries(
            Object.entries(sourcePaths).map(([name, src]) => ['@posthog/' + name, path.join(sources, src)])
        )
        const result = await build({
            stdin: {
                contents: "import './lazy-recorder'; import './array'",
                resolveDir: path.join(sources, 'browser/src/entrypoints'),
            },
            bundle: true,
            write: false,
            ignoreAnnotations: true,
            logLevel: 'error',
            alias,
            plugins: [inlineWorker],
            nodePaths: ['browser', 'browser-common', 'core', 'rrweb/rrweb', 'rrweb/rrweb-snapshot'].map((pkg) =>
                path.join(root, 'packages', pkg, 'node_modules')
            ),
        })
        return { revision, sdk: result.outputFiles[0].contents }
    } finally {
        rmSync(scratch, { recursive: true, force: true })
    }
}
