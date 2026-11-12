import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import test from 'node:test'
import { assertCoreHooks, checkRegistry, metadata, packageName, validateManifest } from '../electron-alpha-release.mjs'

const manifest = {
    name: packageName,
    version: '0.1.0-alpha.0',
    dependencies: { '@posthog/core': '^1.67.3', '@posthog/browser-common': '^0.10.9' },
}
const now = Date.parse('2026-11-20T00:00:00Z')
function mockRegistry({ target = null, age = 8, missing = false, status = 200 } = {}) {
    return async (url) => {
        const name = decodeURIComponent(url.split('/').at(-1))
        const version = name === '@posthog/core' ? '1.67.3' : '0.10.9'
        if (name === packageName) return { status: target ? 200 : 404, ok: !!target, json: async () => target }
        return {
            status,
            ok: status === 200,
            json: async () => ({
                name,
                versions: missing ? {} : { [version]: {} },
                time: { [version]: new Date(now - age * 86400_000).toISOString() },
            }),
        }
    }
}

test('only the reviewed Electron alpha version with external stable lower bounds is accepted', () => {
    validateManifest(manifest, manifest.version)
    for (const version of ['0.1.0', '0.1.0-beta.0', '0.1.0-alpha', '0.1.0-alpha.01', 'latest', '0.1.0-alpha.1']) {
        assert.throws(() => validateManifest(manifest, version))
    }
    for (const patch of [
        { name: '@posthog/core' },
        { private: true },
        { bundledDependencies: ['@posthog/core'] },
        { dependencies: {} },
        { dependencies: { '@posthog/core': 'workspace:^' } },
        { dependencies: { '@posthog/core': 'file:../core' } },
        { dependencies: { '@posthog/core': '^1.67.3-alpha.0' } },
    ])
        assert.throws(() => validateManifest({ ...manifest, ...patch }, manifest.version))
})

test('registry checks require unpublished alpha and published cooled-down dependency lower bounds', async () => {
    await checkRegistry(manifest, manifest.version, mockRegistry(), now)
    for (const options of [
        { age: 6 },
        { missing: true },
        { status: 401 },
        { status: 429 },
        { status: 500 },
        { target: { name: packageName, versions: { [manifest.version]: {} } } },
        { target: {} },
    ])
        await assert.rejects(checkRegistry(manifest, manifest.version, mockRegistry(options), now))
    await assert.rejects(
        metadata(packageName, async () => {
            throw new Error('network unavailable')
        })
    )
    await assert.rejects(metadata(packageName, async () => ({ status: 403, ok: false })))
})

test('published core must actually implement both required hooks, including inherited hooks', () => {
    class Missing {}
    assert.throws(() => assertCoreHooks({ PostHogCore: Missing }), /getFlagsForContext/)
    class Partial {
        getFlagsForContext() {}
    }
    assert.throws(() => assertCoreHooks({ PostHogCore: Partial }), /shouldRetainBatchOnError/)
    class Complete extends Partial {
        shouldRetainBatchOnError() {}
    }
    assertCoreHooks({ PostHogCore: Complete })
})

test('stable release discovery deliberately excludes Electron while retaining core release', () => {
    const config = JSON.parse(readFileSync('.changeset/config.json', 'utf8'))
    assert.ok(config.ignore.includes(packageName))
    const stable = readFileSync('.github/workflows/release.yml', 'utf8')
    assert.doesNotMatch(stable, /name: ['"]?@posthog\/electron/)
    assert.match(stable, /name: '@posthog\/core'/)
    for (const file of readdirSync('.changeset').filter((file) => file.endsWith('.md') && file !== 'README.md')) {
        const frontmatter = readFileSync(join('.changeset', file), 'utf8').split('---')[1]
        assert.ok(!frontmatter?.includes(packageName), `${file}: ignored Electron must not appear in stable changesets`)
    }
    const output = join(mkdtempSync(join(tmpdir(), 'electron-alpha-changesets-')), 'status.json')
    execFileSync('pnpm', ['changeset', 'status', '--output', relative(process.cwd(), output)], {
        stdio: 'pipe',
        env: { ...process.env, CI: 'true', COLUMNS: '80', LINES: '24' },
    })
    const plan = JSON.parse(readFileSync(output, 'utf8'))
    for (const release of plan.releases.filter((release) => release.name === packageName)) {
        assert.equal(release.type, 'none')
        assert.equal(
            release.newVersion,
            release.oldVersion,
            'Dependency updates must not stabilize the Electron version'
        )
    }
})

test('manual alpha workflow has no default publishing, stable promotion, or build OIDC credentials', () => {
    const workflow = readFileSync('.github/workflows/release-electron-alpha.yml', 'utf8')
    assert.match(workflow, /permissions: \{\}/)
    assert.doesNotMatch(workflow, /^ {4}(push|pull_request|pull_request_target):/m)
    assert.match(workflow, /if: inputs.publish == true/)
    assert.match(workflow, /environment: Electron Alpha NPM/)
    assert.match(workflow, /version: 11\.7\.0/)
    assert.match(workflow, /node-version: 24/)
    assert.match(workflow, /--tag alpha --registry https:\/\/registry.npmjs.org --provenance/)
    assert.match(workflow, /--ignore-scripts --access public/)
    assert.match(workflow, /consumer target\/electron-alpha\/electron.tgz/)
    assert.match(workflow, /sha256sum --check/)
    assert.equal((workflow.match(/id-token: write/g) ?? []).length, 1)
    const build = workflow.split('    build:\n')[1].split('    publish:\n')[0]
    assert.doesNotMatch(build, /id-token:|secrets\.|npm publish/)
    assert.doesNotMatch(workflow, /--tag latest|changeset pre|pnpm bump|git push/)
    for (const action of workflow.matchAll(/uses: ([^\n]+)/g)) assert.match(action[1], /@[a-f0-9]{40} #/)
    const pkg = JSON.parse(readFileSync('packages/electron/package.json', 'utf8'))
    assert.equal(pkg.publishConfig.tag, 'alpha')
    assert.equal(pkg.publishConfig.registry, 'https://registry.npmjs.org')
    assert.ok(pkg.files.includes('MIGRATION.md'))
})

test('native optional-feature CI keeps merged fixtures on one pinned macOS runtime without publishing privileges', () => {
    const workflow = readFileSync('.github/workflows/electron-features.yml', 'utf8')
    assert.match(workflow, /runs-on: macos-14/)
    assert.match(workflow, /timeout-minutes: 25/)
    assert.match(workflow, /permissions: \{\}/)
    assert.match(workflow, /contents: read/)
    assert.match(workflow, /node-version: 24/)
    assert.match(workflow, /version: 11\.7\.0/)
    assert.match(workflow, /42\.4\.0/)
    assert.match(workflow, /pnpm install --filter @posthog\/electron\.\.\. --frozen-lockfile --ignore-scripts/)
    assert.match(workflow, /node packages\/electron\/node_modules\/electron\/install\.js/)
    assert.match(workflow, /build check-types test:unit test:built/)
    for (const fixture of ['delivery', 'autocapture', 'errors', 'utility']) {
        assert.ok(workflow.includes(`pnpm --filter @posthog/electron test:${fixture}`))
    }
    for (const action of workflow.matchAll(/uses: ([^\n]+)/g)) assert.match(action[1], /@[a-f0-9]{40} #/)
    assert.doesNotMatch(workflow, /id-token:|contents: write|secrets\.|--no-sandbox|continue-on-error|npm publish/)
})
