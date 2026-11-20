import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertCoreHooks, checkRegistry, metadata, packageName, validateManifest } from '../electron-release.mjs'

// CLI status also enforces unrelated changed-package policy and requires a Git base branch.
const require = createRequire(import.meta.url)
const getReleasePlan = createRequire(require.resolve('@changesets/cli/package.json'))(
    '@changesets/get-release-plan'
).default

const manifest = {
    name: packageName,
    version: '0.1.0',
    dependencies: { '@posthog/core': '^1.67.3', '@posthog/browser-common': '^0.10.9' },
}
const now = Date.parse('2026-11-20T00:00:00Z')
function mockRegistry({ target = null, age = 8, missing = false, status = 200 } = {}) {
    return async (url) => {
        const name = decodeURIComponent(url.split('/').at(-1))
        const version = { '@posthog/core': '1.67.3', '@posthog/browser-common': '0.10.9' }[name] ?? '1.0.0'
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

test('only an exact reviewed x.y.z version with external stable lower bounds is accepted', () => {
    validateManifest(manifest, manifest.version)
    for (const version of ['0.1.0-alpha.0', '0.1.0-beta.0', '0.1.0+build', 'v0.1.0', '00.1.0', 'latest']) {
        assert.throws(() => validateManifest({ ...manifest, version }, version), /Only exact x\.y\.z versions/)
    }
    assert.throws(() => validateManifest(manifest, '0.1.1'), /Commit and requested version must match/)
    for (const patch of [
        { name: '@posthog/core' },
        { private: true },
        { publishConfig: { tag: 'alpha' } },
        { bundledDependencies: ['@posthog/core'] },
        { dependencies: {} },
        { dependencies: { '@posthog/core': 'workspace:^' } },
        { dependencies: { '@posthog/core': 'file:../core' } },
        { dependencies: { '@posthog/core': '^1.67.3-alpha.0' } },
    ])
        assert.throws(() => validateManifest({ ...manifest, ...patch }, manifest.version))
})

test('registry checks require an unpublished version and cooled-down dependency lower bounds', async () => {
    await checkRegistry(manifest, manifest.version, mockRegistry(), now)
    await checkRegistry(manifest, manifest.version, mockRegistry({ age: 0 }), now)
    const thirdParty = { ...manifest, dependencies: { ...manifest.dependencies, 'third-party': '^1.0.0' } }
    await checkRegistry(thirdParty, manifest.version, mockRegistry(), now)
    await assert.rejects(
        checkRegistry(thirdParty, manifest.version, mockRegistry({ age: 6 }), now),
        /third-party@1\.0\.0 must satisfy the seven-day cooldown/
    )
    for (const options of [
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

test('Changesets handles an Electron patch after the initial version', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'electron-release-plan-'))
    const json = (path, value) => writeFileSync(join(directory, path), JSON.stringify(value))
    try {
        mkdirSync(join(directory, '.changeset'))
        mkdirSync(join(directory, 'packages/core'), { recursive: true })
        mkdirSync(join(directory, 'packages/electron'), { recursive: true })
        json('package.json', { name: 'electron-release-fixture', private: true })
        writeFileSync(join(directory, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
        json('packages/core/package.json', { name: '@posthog/core', version: '1.0.0' })
        json('packages/electron/package.json', {
            name: packageName,
            version: '0.1.0',
            dependencies: { '@posthog/core': 'workspace:^' },
        })
        json('.changeset/config.json', {
            ...JSON.parse(readFileSync('.changeset/config.json', 'utf8')),
            changelog: false,
        })
        writeFileSync(join(directory, '.changeset/core.md'), "---\n'@posthog/core': patch\n---\nCore hooks.\n")
        const first = await getReleasePlan(directory)
        assert.equal(first.releases.find(({ name }) => name === '@posthog/core')?.newVersion, '1.0.1')
        assert.ok(!first.releases.some(({ name }) => name === packageName))
        writeFileSync(
            join(directory, '.changeset/electron.md'),
            "---\n'@posthog/electron': patch\n---\nElectron fix.\n"
        )
        const next = await getReleasePlan(directory)
        assert.equal(next.releases.find(({ name }) => name === packageName)?.newVersion, '0.1.1')
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
})

test('shared release publishes Electron with the default npm tag after its registry check', () => {
    const config = JSON.parse(readFileSync('.changeset/config.json', 'utf8'))
    assert.ok(!config.ignore.includes(packageName), 'Electron must participate in Changesets')
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    const validate = workflow.split('    validate-electron-package:\n')[1].split('    publish:\n')[0]
    const publish = workflow.split('    publish:\n')[1].split('    gate-posthog-js-publish:\n')[0]
    assert.match(validate, /ref: \$\{\{ needs\.version-bump\.outputs\.commit-hash \}\}/)
    assert.match(validate, /persist-credentials: false/)
    assert.match(validate, /node scripts\/electron-release\.mjs "\$tarball" "\$VERSION"/)
    assert.doesNotMatch(validate, /id-token:|contents: write|secrets\.|npm publish/)
    assert.match(publish, /needs:\s*\[[^\]]*\bvalidate-electron-package\b/)
    assert.match(publish, /name: '@posthog\/electron'/)
    assert.match(
        publish,
        /if: steps\.check-package-version\.outputs\.is-new-version == 'true' && matrix\.package\.name == '@posthog\/electron'/
    )
    const gate = publish.indexOf('name: Require Electron registry compatibility')
    assert.ok(gate >= 0 && gate < publish.indexOf('name: Publish ${{ matrix.package.name }} to NPM'))
    assert.match(
        publish,
        /if \[ "\$VALIDATION_RESULT" != 'success' \] \|\| \[ "\$VALIDATED_VERSION" != "\$PACKAGE_VERSION" \] \|\|\s*\[ "\$VALIDATED_SOURCE" != "\$\(git rev-parse HEAD\)" \]; then/
    )
    const pkg = JSON.parse(readFileSync('packages/electron/package.json', 'utf8'))
    assert.notEqual(pkg.private, true)
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
    assert.equal(pkg.publishConfig.tag, undefined)
    assert.equal(pkg.publishConfig.registry, 'https://registry.npmjs.org')
    assert.ok(pkg.files.includes('MIGRATION.md'))
    assert.ok(pkg.files.includes('CHANGELOG.md'))
})

test('native optional-feature CI keeps merged fixtures on one pinned macOS runtime without publishing privileges', () => {
    const workflow = readFileSync('.github/workflows/electron-features.yml', 'utf8')
    assert.match(workflow, /runs-on: macos-15/)
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
