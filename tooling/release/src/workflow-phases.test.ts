import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
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

test('@posthog/browser remains dormant while private, then uses the normal version check when public', () => {
    const check = job(release, 'check-posthog-browser-version')
    assert.match(check, /ref: \$\{\{ needs.version-bump.outputs.commit-hash \}\}/)
    assert.match(check, /if: steps.manifest.outputs.private != 'true'/)
    assert.match(
        check,
        /is-new-version: \$\{\{ steps.manifest.outputs.private == 'true' && 'false' \|\| steps.check-version.outputs.is-new-version \}\}/
    )
    const script = check.match(/ {14}run: \|\n((?: {18}.*\n|\n)+)/)?.[1]
    assert.ok(script)
    const root = mkdtempSync(path.join(os.tmpdir(), 'browser-cdn-manifest-'))
    try {
        mkdirSync(path.join(root, 'packages/browser-next'), { recursive: true })
        for (const manifest of [{ private: true }, { private: false }, {}]) {
            writeFileSync(path.join(root, 'packages/browser-next/package.json'), JSON.stringify(manifest))
            const output = path.join(root, 'output')
            writeFileSync(output, '')
            const child: SpawnSyncReturns<string> = spawnSync('bash', ['-c', script.replace(/^ {18}/gm, '')], {
                cwd: root,
                env: { ...process.env, GITHUB_OUTPUT: output },
                encoding: 'utf8',
            })
            assert.equal(child.status, 0, child.stdout + child.stderr)
            assert.equal(readFileSync(output, 'utf8'), `private=${manifest.private === true}\n`)
        }
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test('@posthog/browser builds once from the version commit and transfers the entire artifact tree without a toolbar dependency', () => {
    const build = job(release, 'build-posthog-browser-s3-artifacts')
    assert.match(build, /ref: \$\{\{ needs.version-bump.outputs.commit-hash \}\}/)
    assert.match(build, /needs.check-posthog-browser-version.result == 'success'/)
    assert.match(build, /needs.check-posthog-browser-version.outputs.is-new-version == 'true'/)
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

test('both @posthog/browser immutable regions are required before its aliases and npm gate', () => {
    const immutable = job(release, 'upload-posthog-browser-s3-immutable')
    const aliases = job(release, 'upload-posthog-browser-s3')
    assert.match(immutable, /needs.build-posthog-browser-s3-artifacts.result == 'success'/)
    assert.match(immutable, /upload-browser-s3 "\$BUCKET" "\$VERSION" --immutable-only/)
    assert.match(aliases, /upload-browser-s3 "\$BUCKET" "\$VERSION" --aliases-only/)
    assert.ok(dependencies(aliases).includes('upload-posthog-browser-s3-immutable'))
    assert.match(aliases, /needs.upload-posthog-browser-s3-immutable.result == 'success'/)
    assert.ok(dependencies(job(release, 'gate-posthog-browser-publish')).includes('upload-posthog-browser-s3'))
})

test('@posthog/browser S3 gate reports failures to the release approval thread', () => {
    const gate = job(release, 'gate-posthog-browser-publish')
    assert.ok(dependencies(gate).includes('notify-approval-needed'))
    for (const required of [
        'if: failure()',
        'continue-on-error: true',
        'actions/slack-thread-reply@',
        'thread_ts: ${{ needs.notify-approval-needed.outputs.slack_ts }}',
        "message: '❌ Blocked `@posthog/browser` npm publication because its S3 release did not succeed.",
    ]) {
        assert.ok(gate.includes(required), `Missing failure notification configuration: ${required}`)
    }
})

test('@posthog/browser npm gate rejects failed checks and incomplete S3 releases', () => {
    const gate = job(release, 'gate-posthog-browser-publish')
    const script = gate.match(/ {14}run: \|\n((?: {18}.*\n|\n)+)/)?.[1]
    assert.ok(script)
    const base = {
        ...process.env,
        CHECK_RESULT: 'success',
        IS_NEW_VERSION: 'true',
        UPLOAD_RESULT: 'success',
    }
    const run = (env: Record<string, string | undefined>, success: boolean) => {
        const child = spawnSync('bash', ['-c', script.replace(/^ {18}/gm, '')], { env, encoding: 'utf8' })
        assert.equal(child.status, success ? 0 : 1, child.stdout + child.stderr)
    }
    run(base, true)
    for (const field of ['CHECK_RESULT', 'UPLOAD_RESULT']) {
        for (const result of ['failure', 'cancelled', 'skipped', '']) {
            run({ ...base, [field]: result }, false)
        }
    }
    for (const value of ['', 'unknown']) run({ ...base, IS_NEW_VERSION: value }, false)
    run({ ...base, IS_NEW_VERSION: 'false', UPLOAD_RESULT: 'skipped' }, true)
    run({ ...base, IS_NEW_VERSION: 'false', CHECK_RESULT: 'failure' }, false)
})
