import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
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
