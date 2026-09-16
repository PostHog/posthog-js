import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { mkdirSync, rmSync, symlinkSync, writeFileSync, existsSync, lstatSync, readlinkSync } from 'node:fs'

// Each invocation gets an isolated output directory and temporary config. The
// optional compiler link points only at a dependency installed in this worktree.
export function buildTrial({ root, here, scratch, pkg, compiler, execute, timed = false, negative = false, files }) {
    const cwd = join(root, 'packages', pkg)
    const config = join(cwd, `.native-trial-${process.pid}.mjs`)
    const dest = join(scratch, pkg, 'rslib-output')
    const link = join(cwd, 'node_modules/@typescript/native-preview')
    const canary = join(cwd, 'src', `__native_trial_canary_${process.pid}.ts`)
    let linked = false
    let injected = false
    let originalLink
    let savedLink = false
    if (existsSync(config) || existsSync(canary)) throw new Error('Temporary trial file already exists')
    const require = createRequire(join(cwd, 'package.json'))
    const rslib = require.resolve('@rslib/core')
    const productionTypescript = createRequire(rslib)('typescript/package.json').version
    try {
        if (compiler !== 'tsc') {
            const existing = lstatSync(link, { throwIfNoEntry: false })
            if (existing) {
                if (!existing.isSymbolicLink()) throw new Error(`Refusing to replace a real directory: ${link}`)
                const target = readlinkSync(link)
                rmSync(link)
                originalLink = target
                savedLink = true
            }
            mkdirSync(dirname(link), { recursive: true })
            symlinkSync(
                compiler === 'nextPreview'
                    ? join(root, 'packages/next/node_modules/@typescript/native-preview')
                    : join(here, 'node_modules/@typescript/native-preview'),
                link,
                'dir'
            )
            linked = true
        }
        rmSync(dest, { recursive: true, force: true })
        writeFileSync(
            config,
            `import original from './rslib.config.ts'\nexport default { ...original, output: { distPath: { root: ${JSON.stringify(dest)} } }, lib: original.lib.map(lib => ({...lib, dts: {tsgo: ${compiler !== 'tsc'}}})) }\n`
        )
        if (negative) {
            writeFileSync(canary, 'export const mustFail: string = 123\n', { flag: 'wx' })
            injected = true
        }
        const result = execute('pnpm', ['exec', 'rslib', 'build', '--config', config], cwd, timed)
        const artifacts = existsSync(dest) ? files(dest) : {}
        // Maps embed output locations; report their presence, compare executable
        // and declaration bytes separately without normalizing those contents.
        return {
            ...result,
            productionTypescript,
            files: artifacts,
            semanticCanary: negative ? result.status !== 0 && /TS2322/.test(result.diagnostics) : undefined,
        }
    } finally {
        rmSync(config, { force: true })
        if (linked) rmSync(link)
        if (savedLink) symlinkSync(originalLink, link, 'dir')
        if (injected) rmSync(canary)
    }
}
