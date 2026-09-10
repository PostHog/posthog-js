import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const script = resolve(root, 'scripts/check-pull-request-target.mjs')
const workflow = readFileSync(resolve(root, '.github/workflows/public-api-label.yml'), 'utf8')

function check(text) {
    const dir = mkdtempSync(join(tmpdir(), 'prt-'))
    writeFileSync(join(dir, 'workflow.yml'), text)
    return spawnSync('node', [script, dir], { encoding: 'utf8' })
}

function addStep(step) {
    return workflow.replace('        steps:\n', `        steps:\n${step}\n`)
}

test('passes the public API label workflow', () => {
    assert.equal(check(workflow).status, 0)
})

test('ignores workflows without pull_request_target', () => {
    assert.equal(check('on: pull_request\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n').status, 0)
})

test('rejects checking out code', () => {
    const result = check(addStep('            - uses: actions/checkout@v4'))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /uses an action/)
})

test('rejects fetching PR code with git or gh', () => {
    assert.equal(check(addStep('            - run: gh pr checkout 1')).status, 1)
    assert.equal(check(addStep('            - run: git fetch origin pull/1/head')).status, 1)
})

test('rejects expressions in run scripts', () => {
    const result = check(
        addStep('            - run: |\n                  echo "${{ github.event.pull_request.title }}"')
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /through env/)
})
