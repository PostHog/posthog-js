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
                NEXT_CHECK_RESULT: 'success',
                NEXT_IS_NEW_VERSION: 'false',
            },
            encoding: 'utf8',
        })
        assert.equal(child.status, result === 'success' ? 0 : 1, child.stdout + child.stderr)
    }
})

test('browser-next remains dormant while private, then uses the normal version check when public', () => {
    const check = job(release, 'check-browser-next-version')
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

test('browser CDN builds once from the version commit and transfers the entire artifact tree without a toolbar dependency', () => {
    const build = job(release, 'build-browser-cdn')
    assert.match(build, /ref: \$\{\{ needs.version-bump.outputs.commit-hash \}\}/)
    assert.match(build, /needs.check-browser-next-version.result == 'success'/)
    assert.match(build, /needs.check-browser-next-version.outputs.is-new-version == 'true'/)
    assert.match(build, /pnpm turbo run build --filter='@posthog\/browser\^\.\.\.'/)
    assert.match(build, /pnpm --filter @posthog\/browser build:cdn/)
    assert.ok(
        build.indexOf('Build browser CDN dependencies') < build.indexOf('run: pnpm --filter @posthog/browser build:cdn')
    )
    assert.match(build, /test -s packages\/browser-next\/dist-cdn\/posthog.js/)
    assert.match(build, /path: packages\/browser-next\/dist-cdn\/\n/)
    assert.match(build, /include-hidden-files: true/)
    assert.doesNotMatch(build, /matrix:|toolbar/)
    for (const id of ['upload-browser-cdn-immutable', 'promote-browser-cdn']) {
        const upload = job(release, id)
        assert.doesNotMatch(upload, /toolbar|build:cdn/)
        assert.match(upload, /name: browser-cdn-dist/)
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

test('both browser immutable regions are a required barrier before any browser aliases or coordinated npm publication', () => {
    const immutable = job(release, 'upload-browser-cdn-immutable')
    const aliases = job(release, 'promote-browser-cdn')
    assert.match(immutable, /needs.build-browser-cdn.result == 'success'/)
    assert.match(immutable, /upload-browser-s3 "\$BUCKET" "\$VERSION" --immutable-only/)
    assert.match(aliases, /upload-browser-s3 "\$BUCKET" "\$VERSION" --aliases-only/)
    assert.ok(dependencies(aliases).includes('upload-browser-cdn-immutable'))
    assert.match(aliases, /needs.upload-browser-cdn-immutable.result == 'success'/)
    const gate = job(release, 'gate-posthog-js-publish')
    for (const id of [
        'check-browser-next-version',
        'build-browser-cdn',
        'upload-browser-cdn-immutable',
        'promote-browser-cdn',
    ]) {
        assert.ok(dependencies(gate).includes(id))
    }
    for (const id of ['publish', 'publish-posthog-js']) {
        const publish = job(release, id)
        assert.ok(dependencies(publish).includes('gate-posthog-js-publish'))
        assert.match(publish, /needs.gate-posthog-js-publish.result == 'success'/)
    }
    const notified = job(release, 'notify-released')
    assert.ok(dependencies(notified).includes('promote-browser-cdn'))
    assert.match(notified, /needs.promote-browser-cdn.result == 'success'/)
    // Legacy recovery remains separately approved and gated by its own regional barrier.
    assert.match(job(release, 'publish-recovered-posthog-js'), /needs.recover-posthog-js-s3.result == 'success'/)
})

test('coordinated npm gate evaluates browser-next even when legacy browser is unchanged and rejects incomplete work', () => {
    const gate = job(release, 'gate-posthog-js-publish')
    const step = gate.slice(gate.indexOf('            - name: Require successful'))
    const script = step.match(/ {14}run: \|\n((?: {18}.*\n|\n)+)/)?.[1]
    assert.ok(script)
    const base = {
        ...process.env,
        BUILD_RESULT: 'success',
        CHECK_RESULT: 'success',
        IS_NEW_VERSION: 'false',
        UPLOAD_RESULT: 'skipped',
        NEXT_CHECK_RESULT: 'success',
        NEXT_IS_NEW_VERSION: 'true',
        NEXT_BUILD_RESULT: 'success',
        NEXT_IMMUTABLE_RESULT: 'success',
        NEXT_ALIAS_RESULT: 'success',
    }
    const run = (env: Record<string, string | undefined>, success: boolean) => {
        const child = spawnSync('bash', ['-c', script.replace(/^ {18}/gm, '')], { env, encoding: 'utf8' })
        assert.equal(child.status, success ? 0 : 1, child.stdout + child.stderr)
    }
    run(base, true)
    for (const field of ['NEXT_CHECK_RESULT', 'NEXT_BUILD_RESULT', 'NEXT_IMMUTABLE_RESULT', 'NEXT_ALIAS_RESULT']) {
        for (const result of ['failure', 'cancelled', 'skipped', '']) {
            run({ ...base, [field]: result }, false)
        }
    }
    for (const value of ['', 'unknown']) run({ ...base, NEXT_IS_NEW_VERSION: value }, false)
    run(
        {
            ...base,
            NEXT_IS_NEW_VERSION: 'false',
            NEXT_BUILD_RESULT: 'skipped',
            NEXT_IMMUTABLE_RESULT: 'skipped',
            NEXT_ALIAS_RESULT: 'skipped',
        },
        true
    )
    run({ ...base, IS_NEW_VERSION: 'true', UPLOAD_RESULT: 'success' }, true)
    run({ ...base, IS_NEW_VERSION: 'true', UPLOAD_RESULT: 'failure' }, false)
    run({ ...base, CHECK_RESULT: 'failure' }, false)
})
