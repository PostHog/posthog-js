import { execFileSync } from 'node:child_process'
import { mkdtemp, cp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const root = resolve(packageRoot, '../..')
const directory = await mkdtemp(join(tmpdir(), 'posthog-electron-utility-installed-'))
console.log(`Installed utilityProcess fixture: ${directory}`)
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit', timeout: 120_000 })
for (const [name, path] of [
    ['types', 'types'],
    ['core', 'core'],
    ['electron', 'electron'],
]) {
    run('pnpm', ['pack', '--out', join(directory, `${name}.tgz`)], join(root, 'packages', path))
}
await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({
        private: true,
        main: 'main.cjs',
        packageManager: 'pnpm@11.7.0',
        dependencies: { '@posthog/electron': 'file:./electron.tgz' },
    })
)
await writeFile(
    join(directory, 'pnpm-workspace.yaml'),
    `minimumReleaseAge: 10080\nautoInstallPeers: false\noverrides:\n  '@posthog/core': file:./core.tgz\n  '@posthog/types': file:./types.tgz\n`
)
await cp(new URL('main.cjs', import.meta.url), join(directory, 'main.cjs'))
await cp(new URL('child.cjs', import.meta.url), join(directory, 'child.cjs'))
run('pnpm', ['install', '--ignore-scripts'], directory)
const require = createRequire(new URL('../../package.json', import.meta.url))
const binary = require('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
execFileSync(binary, [directory], { cwd: directory, env, stdio: 'inherit', timeout: 60_000 })
