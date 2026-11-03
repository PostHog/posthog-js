import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const workflow = readFileSync(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8')
const script = workflow.match(/run: &check-package-version \|\n((?: {18}.*\n|\n)+)/)?.[1].replace(/^ {18}/gm, '')
assert.ok(script, 'Missing shared npm version check')
const metadata = {
    versions: ['1.0.0', '1.1.0-beta.1'],
    'dist-tags': { latest: '1.0.0', beta: '1.1.0-beta.1' },
}

function check(version: string, response: unknown, status = 0) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'check-package-version-'))
    try {
        const packagePath = path.join(root, 'package with spaces')
        mkdirSync(packagePath)
        writeFileSync(path.join(packagePath, 'package.json'), JSON.stringify({ name: '@posthog/test', version }))
        writeFileSync(path.join(root, 'output'), 'existing=value\n')
        writeFileSync(
            path.join(root, 'npm'),
            '#!/bin/sh\nprintf "%s\\n" "$@" > "$NPM_ARGS"\nprintf "%s" "$NPM_RESPONSE"\nexit "$NPM_STATUS"\n',
            { mode: 0o755 }
        )
        const child = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
            env: {
                ...process.env,
                PATH: `${root}${path.delimiter}${process.env.PATH}`,
                INPUT_PATH: packagePath,
                GITHUB_OUTPUT: path.join(root, 'output'),
                NPM_ARGS: path.join(root, 'args'),
                NPM_RESPONSE: typeof response === 'string' ? response : JSON.stringify(response),
                NPM_STATUS: String(status),
            },
            encoding: 'utf8',
        })
        return {
            ...child,
            output: readFileSync(path.join(root, 'output'), 'utf8'),
            args: child.status === 0 ? readFileSync(path.join(root, 'args'), 'utf8') : '',
        }
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
}

for (const [version, isNew] of [
    ['1.0.0', false],
    ['1.1.0-beta.1', false],
    ['1.1.0-beta.2', true],
    ['1.1.0', true],
] as const) {
    test(`checks exact npm version ${version} through environment files`, () => {
        const result = check(version, metadata)
        assert.equal(result.status, 0, result.stderr)
        assert.equal(result.args, 'view\n@posthog/test\nversions\ndist-tags\n--json\n')
        assert.equal(
            result.output,
            `existing=value\nis-new-version=${isNew}\nis-new-package=false\npublished-version=1.0.0\ncommitted-version=${version}\n`
        )
        assert.doesNotMatch(result.stdout + result.stderr, /::(?:set-output|save-state)/)
    })
}

test('an npm 404 marks a first publication without inventing a published version', () => {
    const result = check('0.1.0', { error: { code: 'E404' } }, 1)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.output, 'existing=value\nis-new-version=true\nis-new-package=true\ncommitted-version=0.1.0\n')
})

for (const code of ['E401', 'E403', 'E429', 'E500', 'ETIMEDOUT', 'ENOTFOUND']) {
    test(`fails closed on npm ${code}`, () => {
        const result = check('1.1.0', { error: { code } }, 1)
        assert.notEqual(result.status, 0)
        assert.equal(result.output, 'existing=value\n')
        assert.match(result.stderr, new RegExp(code))
    })
}

test('rejects malformed registry data without emitting publication outputs', () => {
    for (const response of ['not json', {}, { versions: null }]) {
        const result = check('1.1.0', response)
        assert.notEqual(result.status, 0)
        assert.equal(result.output, 'existing=value\n')
    }
})

test('both release checks share the inline migration, including recovery checkouts of older commits', () => {
    assert.match(
        workflow,
        /id: check-package-version\n +env:\n +INPUT_PATH: \$\{\{ steps.get-package-path.outputs.path \}\}\n +run: &check-package-version/
    )
    assert.match(workflow, /id: check-version\n +env:\n +INPUT_PATH: packages\/browser\n +run: \*check-package-version/)
    assert.doesNotMatch(workflow, /uses: PostHog\/check-package-version@/)
})
