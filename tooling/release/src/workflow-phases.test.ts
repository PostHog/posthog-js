import assert from 'node:assert/strict'
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import test from 'node:test'

const release = readFileSync(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8')
const recovery = readFileSync(new URL('../../../.github/workflows/recover-s3-release.yml', import.meta.url), 'utf8')

// Small structural assertions complement actionlint without adding a YAML runtime
// dependency to the privileged uploader. Job blocks use the repository's indentation.
function job(workflow: string, id: string): string {
    const header = `    ${id}:\n`
    const start = workflow.indexOf(header)
    assert.notEqual(start, -1, `Missing ${id}`)
    const rest = workflow.slice(start + header.length)
    const end = rest.search(/^ {4}[a-z][a-z0-9-]*:\n/m)
    return header + (end < 0 ? rest : rest.slice(0, end))
}
function dependencies(block: string): string[] {
    const match = block.match(/^ {8}needs:\s*\[([^\]]+)\]/m)
    assert.ok(match)
    return match[1].split(',').map((id) => id.trim())
}
function stepScript(block: string, name: string): string {
    const start = block.indexOf(`name: ${name}`)
    assert.notEqual(start, -1, `Missing step ${name}`)
    const script = block.slice(start).match(/ {14}run: \|\n((?: {18}.*\n|\n)+)/)?.[1]
    assert.ok(script)
    return script.replace(/^ {18}/gm, '')
}
function runScript(script: string, env: Record<string, string>, cwd?: string): SpawnSyncReturns<string> {
    return spawnSync('bash', ['-c', script], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' })
}
function assertSameArtifacts(first: string, second: string) {
    const artifacts = [...first.matchAll(/ {18}name: (.*dist.*)/g)]
    assert.equal(artifacts.length, 2, 'Both SDK and regional toolbar artifacts are required')
    for (const artifact of artifacts) {
        assert.ok(second.includes(artifact[0]), `Artifact changed across phases: ${artifact[1]}`)
    }
    for (const block of [first, second]) {
        assert.match(block, /environment: 'S3 Upload'/)
        assert.match(block, /id-token: write/)
        assert.match(block, /contents: read/)
        assert.match(block, /fail-fast: false/)
        assert.match(block, /role-to-assume: \$\{\{ vars.AWS_S3_UPLOAD_ROLE_ARN_US \}\}/)
        assert.match(block, /role-to-assume: \$\{\{ vars.AWS_S3_UPLOAD_ROLE_ARN_EU \}\}/)
    }
}

test('normal release gates every alias matrix cell on all immutable matrix cells', () => {
    const immutable = job(release, 'upload-s3-immutable')
    const aliases = job(release, 'upload-s3')
    assertSameArtifacts(immutable, aliases)
    assert.match(immutable, /upload-s3 "\$BUCKET" "\$VERSION" --immutable-only/)
    assert.match(aliases, /upload-s3 "\$BUCKET" "\$VERSION" --aliases-only/)
    assert.ok(dependencies(aliases).includes('upload-s3-immutable'))
    assert.match(aliases, /needs\.upload-s3-immutable\.result == 'success'/)
    for (const block of [immutable, aliases]) {
        assert.match(block, /name: us, bucket: us-assets\.i\.posthog\.com/)
        assert.match(block, /name: eu, bucket: eu-assets\.i\.posthog\.com/)
        assert.match(block, /ref: \$\{\{ needs.version-bump.outputs.commit-hash \}\}/)
    }
    assert.ok(dependencies(job(release, 'gate-posthog-js-publish')).includes('upload-s3'))
})

test('recovery has the same barrier, retains explicit force only in immutable phase, and supports immutable-only recovery', () => {
    const immutable = job(recovery, 'upload-s3')
    const aliases = job(recovery, 'promote-s3-aliases')
    assertSameArtifacts(immutable, aliases)
    assert.match(immutable, /options=\(--immutable-only\)/)
    assert.match(immutable, /options\+=\(--force-overwrite\)/)
    assert.match(aliases, /--aliases-only/)
    assert.doesNotMatch(aliases, /--force-overwrite/)
    assert.ok(dependencies(aliases).includes('upload-s3'))
    assert.match(aliases, /inputs\.update_latest_aliases &&/)
    assert.match(aliases, /needs\.upload-s3\.result == 'success'/)
    for (const block of [immutable, aliases]) {
        assert.match(block, /region: \$\{\{ fromJSON\(needs.validate.outputs.upload-matrix\) \}\}/)
        assert.match(block, /ref: \$\{\{ github.sha \}\}/)
    }
    assert.match(recovery, /Updating latest CDN aliases requires region=all/)
})

test('npm gate fails closed for failed, cancelled or skipped alias promotion on main only', () => {
    const run = stepScript(job(release, 'gate-posthog-js-publish'), 'Require successful')
    for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
        for (const env of [
            { MAINTENANCE: 'false', BUILD_RESULT: 'success', CHECK_RESULT: 'success', IS_NEW_VERSION: 'true' },
            // Maintenance runs skip every posthog-js S3 job.
            { MAINTENANCE: 'true', BUILD_RESULT: 'skipped', CHECK_RESULT: 'skipped', IS_NEW_VERSION: '' },
        ]) {
            const child = runScript(run, { ...env, UPLOAD_RESULT: result })
            const allowed = env.MAINTENANCE === 'true' || result === 'success'
            assert.equal(child.status, allowed ? 0 : 1, child.stdout + child.stderr)
        }
    }
})

test('@posthog/browser S3 eligibility follows the release commit and stays stable on retries', () => {
    const check = job(release, 'check-posthog-browser-version')
    const script = check.match(/ {14}run: \|\n((?: {18}.*\n|\n)+)/)?.[1]
    assert.ok(script)
    for (const manifest of [{ version: '0.1.0' }, { version: '0.0.3' }]) {
        const root = mkdtempSync(path.join(os.tmpdir(), 'browser-s3-version-'))
        try {
            const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
            git('init', '--quiet', '--initial-branch=main')
            git('config', 'user.name', 'Test')
            git('config', 'user.email', 'test@example.com')
            git('config', 'commit.gpgsign', 'false')
            mkdirSync(path.join(root, 'packages/browser-next'), { recursive: true })
            for (const current of [{ version: '0.0.3' }, manifest]) {
                writeFileSync(path.join(root, 'packages/browser-next/package.json'), JSON.stringify(current))
                git('add', 'packages/browser-next/package.json')
                git('commit', '--quiet', '--allow-empty', '-m', 'release')
            }
            for (let attempt = 0; attempt < 2; attempt++) {
                const output = path.join(root, 'output')
                writeFileSync(output, '')
                const child: SpawnSyncReturns<string> = spawnSync('bash', ['-c', script.replace(/^ {18}/gm, '')], {
                    cwd: root,
                    env: { ...process.env, GITHUB_OUTPUT: output },
                    encoding: 'utf8',
                })
                assert.equal(child.status, 0, child.stdout + child.stderr)
                assert.equal(
                    readFileSync(output, 'utf8'),
                    `committed-version=${manifest.version}\nversion-changed=${manifest.version !== '0.0.3'}\n`
                )
            }
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    }
    assert.match(check, /ref: \$\{\{ needs.version-bump.outputs.commit-hash \}\}/)
    assert.match(check, /fetch-depth: 2/)
    assert.match(check, /version-changed: \$\{\{ steps.check-version.outputs.version-changed \}\}/)
})

test('@posthog/browser builds once from the version commit and transfers the entire artifact tree without a toolbar dependency', () => {
    const build = job(release, 'build-posthog-browser-s3-artifacts')
    assert.match(build, /ref: \$\{\{ needs.version-bump.outputs.commit-hash \}\}/)
    assert.match(build, /needs.check-posthog-browser-version.result == 'success'/)
    assert.match(build, /needs.check-posthog-browser-version.outputs.version-changed == 'true'/)
    assert.match(build, /pnpm turbo run build --filter='@posthog\/browser\^\.\.\.'/)
    assert.match(build, /pnpm --filter @posthog\/browser build:cdn/)
    assert.ok(
        build.indexOf('Build @posthog/browser dependencies') <
            build.indexOf('run: pnpm --filter @posthog/browser build:cdn')
    )
    assert.match(build, /test -s packages\/browser-next\/dist-cdn\/script.js/)
    assert.match(build, /path: packages\/browser-next\/dist-cdn\/\n/)
    assert.match(build, /include-hidden-files: true/)
    assert.match(build, /retention-days: 30/)
    assert.doesNotMatch(build, /matrix:|toolbar/)
    for (const id of ['upload-posthog-browser-s3-immutable', 'upload-posthog-browser-s3']) {
        const upload = job(release, id)
        assert.doesNotMatch(upload, /toolbar|build:cdn/)
        assert.match(upload, /name: posthog-browser-dist/)
        assert.match(upload, /path: packages\/browser-next\/dist-cdn/)
        assert.match(upload, /ref: \$\{\{ needs.version-bump.outputs.commit-hash \}\}/)
        assert.match(upload, /environment: 'S3 Upload'/)
        assert.match(upload, /id-token: write/)
        assert.match(upload, /contents: read/)
        assert.match(upload, /fail-fast: false/)
        assert.match(upload, /name: us, bucket: us-assets\.i\.posthog\.com/)
        assert.match(upload, /name: eu, bucket: eu-assets\.i\.posthog\.com/)
        assert.match(upload, /role-to-assume: \$\{\{ vars.AWS_S3_UPLOAD_ROLE_ARN_US \}\}/)
        assert.match(upload, /role-to-assume: \$\{\{ vars.AWS_S3_UPLOAD_ROLE_ARN_EU \}\}/)
    }
})

test('both @posthog/browser immutable regions are required before its aliases', () => {
    const immutable = job(release, 'upload-posthog-browser-s3-immutable')
    const aliases = job(release, 'upload-posthog-browser-s3')
    assert.match(immutable, /needs.build-posthog-browser-s3-artifacts.result == 'success'/)
    assert.match(immutable, /upload-browser-s3 "\$BUCKET" "\$VERSION" --immutable-only/)
    assert.match(aliases, /upload-browser-s3 "\$BUCKET" "\$VERSION" --aliases-only/)
    assert.ok(dependencies(aliases).includes('upload-posthog-browser-s3-immutable'))
    assert.match(aliases, /needs.upload-posthog-browser-s3-immutable.result == 'success'/)
})

test('@posthog/browser stable aliases require the current main version', () => {
    assert.doesNotMatch(job(release, 'upload-posthog-browser-s3-immutable'), /Reject superseded/)
    const aliases = job(release, 'upload-posthog-browser-s3')
    const start = aliases.indexOf('            - name: Reject superseded browser alias promotion')
    assert.notEqual(start, -1)
    const step = aliases.slice(start, aliases.indexOf('            - name: Verify immutable assets', start))
    assert.match(
        step,
        /if: \$\{\{ !contains\(needs.check-posthog-browser-version.outputs.committed-version, '-'\) \}\}/
    )
    const script = step.match(/ {14}run: \|\n((?: {18}.*\n|\n)+)/)?.[1]
    assert.ok(script)
    const root = mkdtempSync(path.join(os.tmpdir(), 'browser-alias-version-'))
    try {
        const origin = path.join(root, 'origin')
        const checkout = path.join(root, 'checkout')
        const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
        mkdirSync(path.join(origin, 'packages/browser-next'), { recursive: true })
        mkdirSync(path.join(origin, 'tooling/release'), { recursive: true })
        writeFileSync(path.join(origin, 'tooling/release/README.md'), 'release tooling')
        git(origin, 'init', '--quiet', '--initial-branch=main')
        git(origin, 'config', 'user.name', 'Test')
        git(origin, 'config', 'user.email', 'test@example.com')
        git(origin, 'config', 'commit.gpgsign', 'false')
        const commit = (version: string) => {
            writeFileSync(path.join(origin, 'packages/browser-next/package.json'), JSON.stringify({ version }))
            git(origin, 'add', 'packages/browser-next/package.json', 'tooling/release/README.md')
            git(origin, 'commit', '--quiet', '-m', 'release')
        }
        commit('0.1.0')
        git(root, 'clone', '--quiet', '--depth=1', pathToFileURL(origin).href, checkout)
        git(checkout, 'sparse-checkout', 'set', '--cone', 'tooling/release')
        const pinned = git(checkout, 'rev-parse', 'HEAD')
        const run = (version: string): SpawnSyncReturns<string> =>
            spawnSync('bash', ['-c', script.replace(/^ {18}/gm, '')], {
                cwd: checkout,
                env: { ...process.env, VERSION: version },
                encoding: 'utf8',
            })
        assert.equal(run('0.1.0').status, 0)
        commit('0.1.1')
        const superseded = run('0.1.0')
        assert.equal(superseded.status, 1, superseded.stdout + superseded.stderr)
        assert.match(superseded.stdout, /Refusing superseded alias promotion/)
        assert.equal(git(checkout, 'rev-parse', 'HEAD'), pinned)
        git(checkout, 'checkout', '--quiet', '--detach', 'FETCH_HEAD')
        assert.equal(run('0.1.1').status, 0)
        git(checkout, 'remote', 'set-url', 'origin', pathToFileURL(path.join(root, 'missing')).href)
        assert.notEqual(run('0.1.1').status, 0)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test('@posthog/browser reports S3 failures to the release approval thread', () => {
    const notify = job(release, 'notify-posthog-browser-s3-failed')
    for (const id of [
        'check-posthog-browser-version',
        'build-posthog-browser-s3-artifacts',
        'upload-posthog-browser-s3-immutable',
        'upload-posthog-browser-s3',
    ]) {
        assert.ok(dependencies(notify).includes(id))
        assert.ok(notify.includes(`needs.${id}.result == 'failure'`))
    }
    assert.ok(dependencies(notify).includes('notify-approval-needed'))
    assert.match(notify, /continue-on-error: true/)
    assert.match(notify, /actions\/slack-thread-reply@/)
    assert.match(notify, /thread_ts: \$\{\{ needs.notify-approval-needed.outputs.slack_ts \}\}/)
    assert.match(notify, /message: '❌ `@posthog\/browser` S3 release failed/)
})

test('release context allows main and listed maintenance branches only', () => {
    const run = stepScript(job(release, 'release-context'), 'Resolve release context')
    const main = 'branch=main\nmaintenance=false\npackage=\ndist-tag=latest\n'
    const node5 = 'branch=posthog-node-5\nmaintenance=true\npackage=posthog-node\ndist-tag=latest-5\n'
    const cases: [Record<string, string>, string | null][] = [
        [{ BRANCH: 'main' }, main],
        [{ BRANCH: 'main', RECOVERY: 'true' }, main],
        [{ BRANCH: 'main', DRY_RUN: 'true' }, null],
        [{ BRANCH: 'posthog-node-5' }, node5],
        [{ BRANCH: 'posthog-node-5', DRY_RUN: 'true' }, node5],
        [{ BRANCH: 'posthog-node-5', RECOVERY: 'true' }, null],
        [{ BRANCH: 'posthog-node-6' }, null],
        [{ BRANCH: 'main', REF_TYPE: 'tag' }, null],
    ]
    const root = mkdtempSync(path.join(os.tmpdir(), 'release-context-'))
    try {
        for (const [env, expected] of cases) {
            const output = path.join(root, 'output')
            writeFileSync(output, '')
            const child = runScript(run, {
                REF_TYPE: 'branch',
                DRY_RUN: 'false',
                RECOVERY: 'false',
                ...env,
                GITHUB_OUTPUT: output,
            })
            const label = `${JSON.stringify(env)}: ${child.stdout}${child.stderr}`
            assert.equal(child.status, expected === null ? 1 : 0, label)
            assert.equal(readFileSync(output, 'utf8'), expected ?? '', label)
        }
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test('maintenance changeset guard rejects any changeset that releases another package', () => {
    const run = stepScript(job(release, 'check-changesets'), 'Require pending changesets')
    const allowed = {
        'single.md': "---\n'posthog-node': patch\n---\n\nFix a bug\n",
        'double.md': '---\n"posthog-node": minor\n---\n\nBody\n\n---\n\n@posthog/core: not front matter\n',
        'comment.md': '---\n# note\nposthog-node: patch\n\n---\n',
        'empty.md': '---\n---\n',
        'crlf.md': "---\r\n'posthog-node': patch\r\n---\r\n",
        'README.md': "---\n'@posthog/core': patch\n---\n",
    }
    const rejected: [string, string][] = [
        ["---\n'@posthog/core': patch\n---\n", '@posthog/core'],
        ["---\n'posthog-node': patch\n'@posthog/types': patch\n---\n", '@posthog/types'],
        ["---\n'posthog-js-lite': patch\n---\n", 'posthog-js-lite'],
        ["---\n'posthog-node-compat': patch\n---\n", 'posthog-node-compat'],
        ["---\r\n'@posthog/ai': patch\r\n---\r\n", '@posthog/ai'],
        ['---\nnot a release line\n---\n', 'not a release line'],
    ]
    const guard = (files: Record<string, string>): SpawnSyncReturns<string> => {
        const root = mkdtempSync(path.join(os.tmpdir(), 'changeset-scope-'))
        try {
            mkdirSync(path.join(root, '.changeset'))
            for (const [name, contents] of Object.entries(files)) {
                writeFileSync(path.join(root, '.changeset', name), contents)
            }
            return runScript(run, { RELEASE_BRANCH: 'posthog-node-5', RELEASE_PACKAGE: 'posthog-node' }, root)
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    }
    for (const files of [{}, allowed]) {
        const child = guard(files)
        assert.equal(child.status, 0, child.stdout + child.stderr)
        assert.match(child.stdout, /Pending changesets release only posthog-node/)
    }
    for (const [contents, release] of rejected) {
        const child = guard({ ...allowed, 'stray.md': contents })
        assert.equal(child.status, 1, child.stdout + child.stderr)
        assert.ok(child.stdout.includes(`::error file=.changeset/stray.md::Releases '${release}'`), child.stdout)
    }
})

test('the changeset guard runs before approval, after the version-bump pull and in the dry run', () => {
    const assertOrder = (block: string, ...markers: string[]) => {
        const positions = markers.map((marker) => block.indexOf(marker))
        assert.ok(!positions.includes(-1), `Missing one of ${markers.join(', ')}`)
        assert.deepEqual(
            positions,
            [...positions].sort((a, b) => a - b),
            `Out of order: ${markers.join(', ')}`
        )
    }
    const check = job(release, 'check-changesets')
    assertOrder(check, '- &changeset-scope-guard', '- name: Check for changesets')
    assert.match(check, /if: needs.release-context.outputs.maintenance == 'true'\n/)
    assertOrder(
        job(release, 'version-bump'),
        'git pull --ff-only origin "$RELEASE_BRANCH"',
        '- *changeset-scope-guard',
        '- name: Update versions and changelogs'
    )
    assertOrder(
        job(release, 'maintenance-dry-run'),
        '- *changeset-scope-guard',
        '- name: Update versions and changelogs'
    )
})

test('maintenance releases skip posthog-js, browser CDN, recovery and PostHog/posthog upgrade jobs', () => {
    for (const id of [
        'recover-posthog-js-s3',
        'check-browser-version',
        'check-posthog-browser-version',
        'publish-posthog-js',
        'dispatch-posthog-upgrade',
        'notify-recovery-result',
    ]) {
        const block = job(release, id)
        assert.ok(dependencies(block).includes('release-context'), id)
        assert.match(
            block,
            /^ {8}if: >-\n(?: {12}.*\n)*? {12}needs\.release-context\.outputs\.maintenance == 'false' &&$/m,
            id
        )
    }
    const publish = job(release, 'publish')
    assert.match(
        publish,
        /needs.release-context.outputs.maintenance == 'false' \|\|\n {18}matrix.package.name == needs.release-context.outputs.package\n {14}uses: PostHog\/check-package-version@/
    )
    assert.match(publish, /latest_option=\(--latest=false\)/)
    assert.match(job(release, 'check-changesets'), /inputs.maintenance_dry_run != true &&/)
})

test('the maintenance dry run has no approval, secrets or npm credentials', () => {
    const dryRun = job(release, 'maintenance-dry-run')
    assert.deepEqual(dependencies(dryRun), ['release-context'])
    assert.match(dryRun, /permissions:\n {12}contents: read\n {8}steps:/)
    assert.doesNotMatch(dryRun, /environment:|id-token|secrets\./)
    assert.match(dryRun, /persist-credentials: false/)
    assert.match(
        dryRun,
        /pnpm publish --filter="\$PACKAGE" --access public --no-git-checks --tag "\$DIST_TAG" --dry-run/
    )
})

test('main publishes with its original argv and a maintenance branch publishes under its dist-tag', () => {
    const script = stepScript(job(release, 'publish'), 'Publish ${{ matrix.package.name }} to NPM').replaceAll(
        '${{ matrix.package.name }}',
        'posthog-node'
    )
    const root = mkdtempSync(path.join(os.tmpdir(), 'publish-argv-'))
    try {
        const bin = path.join(root, 'bin')
        const argvFile = path.join(root, 'argv')
        mkdirSync(bin)
        writeFileSync(path.join(bin, 'pnpm'), '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$ARGV_FILE"\n', { mode: 0o755 })
        const publish = (env: Record<string, string>) => {
            rmSync(argvFile, { force: true })
            const child = runScript(script, { ...env, ARGV_FILE: argvFile, PATH: `${bin}:${process.env.PATH}` })
            const argv = existsSync(argvFile) ? readFileSync(argvFile, 'utf8').trimEnd().split('\n') : null
            return { child, argv }
        }
        const original = ['publish', '--filter=posthog-node', '--access', 'public', '--no-git-checks']
        const cases: [Record<string, string>, string[] | null][] = [
            [{ MAINTENANCE: 'false', DIST_TAG: 'latest' }, original],
            [{ MAINTENANCE: 'false', DIST_TAG: '' }, original],
            [{ MAINTENANCE: 'true', DIST_TAG: 'latest-5' }, [...original, '--tag', 'latest-5']],
            [{ MAINTENANCE: 'true', DIST_TAG: '' }, null],
        ]
        for (const [env, expected] of cases) {
            const { child, argv } = publish(env)
            const label = `${JSON.stringify(env)}: ${child.stdout}${child.stderr}`
            assert.equal(child.status, expected === null ? 1 : 0, label)
            assert.deepEqual(argv, expected, label)
        }
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test('a maintenance release fails when its package version is already on npm', () => {
    const publish = job(release, 'publish')
    const run = stepScript(publish, 'Require unpublished maintenance release')
    for (const [isNewVersion, status] of [
        ['true', 0],
        ['false', 1],
        ['', 1],
    ] as const) {
        const child = runScript(run, {
            IS_NEW_VERSION: isNewVersion,
            PACKAGE_NAME: 'posthog-node',
            PACKAGE_VERSION: '5.0.1',
        })
        assert.equal(child.status, status, child.stdout + child.stderr)
    }
    assert.match(
        publish,
        /- name: Require unpublished maintenance release\n {14}if: >-\n {18}needs.release-context.outputs.maintenance == 'true' &&\n {18}matrix.package.name == needs.release-context.outputs.package\n/
    )
    const order = [
        'id: check-package-version',
        '- name: Require unpublished maintenance release',
        '- name: Publish ${{ matrix.package.name }} to NPM',
    ].map((marker) => publish.indexOf(marker))
    assert.ok(!order.includes(-1))
    assert.deepEqual(
        order,
        [...order].sort((a, b) => a - b)
    )
})

test('main keeps the release concurrency group and other branches and dry runs get their own', () => {
    assert.match(
        release,
        /\nconcurrency:\n {4}group: >-\n {8}\$\{\{ inputs.maintenance_dry_run == true && format\('release-dry-run-\{0\}', github.ref_name\) \|\|\n {8}github.ref_name != 'main' && format\('release-\{0\}', github.ref_name\) \|\| 'release' \}\}\n {4}cancel-in-progress: false\n/
    )
})
