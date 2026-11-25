import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// CLI status also enforces unrelated changed-package policy and requires a Git base branch.
const require = createRequire(import.meta.url)
const getReleasePlan = createRequire(require.resolve('@changesets/cli/package.json'))(
    '@changesets/get-release-plan'
).default
const packageName = '@posthog/electron'

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

test('shared release publishes Electron with the default npm tag', () => {
    const config = JSON.parse(readFileSync('.changeset/config.json', 'utf8'))
    assert.ok(!config.ignore.includes(packageName), 'Electron must participate in Changesets')
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    const publish = workflow.split('    publish:\n')[1].split('    gate-posthog-js-publish:\n')[0]
    assert.match(publish, /name: '@posthog\/electron'/)
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
