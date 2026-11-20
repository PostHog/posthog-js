import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

// An npm install fails when the published manifest names a workspace package that the release never publishes, such
// as the rrweb fork, which is bundled instead.
const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const releaseWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/release.yml'), 'utf8')

// The release publishes the packages its npm matrix names, one `- name: <package>` entry each.
const published = new Set([...releaseWorkflow.matchAll(/^\s*- name: '?([@\w./-]+)'?\s*$/gm)].map((match) => match[1]))
const workspace = new Set(
    JSON.parse(
        execFileSync('pnpm', ['ls', '--recursive', '--depth', '-1', '--json'], {
            cwd: repositoryRoot,
            encoding: 'utf8',
        })
    )
        .map((project) => project.name)
        .filter(Boolean)
)
const unpublished = (names) => names.filter((name) => workspace.has(name) && !published.has(name))

assert.deepEqual(
    unpublished(['@posthog/rrweb-record', '@posthog/browser-common', 'web-vitals']),
    ['@posthog/rrweb-record'],
    'The packed dependency guard must reject only unpublished workspace packages'
)

const destination = mkdtempSync(join(tmpdir(), 'posthog-browser-pack-'))
try {
    execFileSync('pnpm', ['pack', '--pack-destination', destination], {
        cwd: packageRoot,
        stdio: ['ignore', 'ignore', 'inherit'],
    })
    const tarball = readdirSync(destination).find((file) => file.endsWith('.tgz'))
    assert(tarball, 'pnpm pack did not produce a tarball')
    const manifest = JSON.parse(
        execFileSync('tar', ['-xOzf', join(destination, tarball), 'package/package.json'], { encoding: 'utf8' })
    )
    const found = unpublished(
        ['dependencies', 'optionalDependencies', 'peerDependencies'].flatMap((field) =>
            Object.keys(manifest[field] ?? {})
        )
    )
    if (found.length > 0) {
        throw new Error(
            `The packed manifest depends on workspace packages the release does not publish: ${found.join(', ')}. ` +
                'Bundle them and list them in devDependencies.'
        )
    }
    stdout.write('Packed manifest depends only on published packages\n')
} finally {
    rmSync(destination, { recursive: true, force: true })
}
