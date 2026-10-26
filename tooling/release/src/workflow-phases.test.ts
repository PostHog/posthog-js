import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

test('npm gate fails closed for failed, cancelled or skipped alias promotion', () => {
    const gate = job(release, 'gate-posthog-js-publish')
    const step = gate.slice(gate.indexOf('            - name: Require successful'))
    const script = step.match(/ {14}run: \|\n((?: {18}.*\n|\n)+)/)?.[1]
    assert.ok(script)
    const run = script.replace(/^ {18}/gm, '')
    for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
        const child = spawnSync('bash', ['-c', run], {
            env: {
                ...process.env,
                BUILD_RESULT: 'success',
                CHECK_RESULT: 'success',
                IS_NEW_VERSION: 'true',
                UPLOAD_RESULT: result,
            },
            encoding: 'utf8',
        })
        assert.equal(child.status, result === 'success' ? 0 : 1, child.stdout + child.stderr)
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
    assert.match(build, /test -s packages\/browser-next\/dist-cdn\/posthog.js/)
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

test('@posthog/browser reports S3 failures to the release approval thread', () => {
    const notify = job(release, 'notify-posthog-browser-s3-failed')
    assert.match(notify, /steps:\n {12}- name: Audit runner egress/)
    assert.match(notify, /uses: step-security\/harden-runner@[a-f0-9]{40}/)
    assert.match(notify, /egress-policy: audit/)
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
