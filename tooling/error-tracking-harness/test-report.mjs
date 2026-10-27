import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'

// Exercise the actual inline github-script without checking out PR code in the write-capable job.
const workflow = readFileSync(
    path.resolve(import.meta.dirname, '../../.github/workflows/error-tracking-harness.yml'),
    'utf8'
).split('\n')
const start = workflow.findIndex((line) => line.trim() === 'script: |')
assert.ok(start !== -1)
const indent = workflow[start].search(/\S/) + 4
const body = []
for (const line of workflow.slice(start + 1)) {
    if (line.trim() && !line.startsWith(' '.repeat(indent))) break
    body.push(line.slice(indent))
}
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const runScript = new AsyncFunction('require', 'github', 'context', 'core', 'process', body.join('\n'))
const fixtureCases = [
    ['rollup-4', 'baseline/smoke'],
    ['vite-8-autocapture', 'autoexception/baseline'],
    ['webpack-5.112', 'baseline/smoke'],
    ['next-14', 'next/smoke'],
    ['next-15', 'next/smoke'],
    ['nuxt-4', 'nuxt/smoke'],
]
const sha = 'a'.repeat(40)
const require = createRequire(import.meta.url)

async function report({ summary, currentSha = sha, comments = [], outcome = 'success' }) {
    const dir = mkdtempSync(path.join(tmpdir(), 'harness-comment-'))
    const file = path.join(dir, 'summary.json')
    if (summary) writeFileSync(file, JSON.stringify(summary))
    const created = [],
        updated = [],
        errors = []
    const github = {
        rest: {
            pulls: { get: async () => ({ data: { head: { sha: currentSha } } }) },
            issues: {
                listComments: async () => {},
                createComment: async (args) => {
                    created.push(args)
                },
                updateComment: async (args) => {
                    updated.push(args)
                },
            },
        },
        paginate: async () => comments,
    }
    const context = {
        serverUrl: 'https://github.com',
        runId: 123,
        repo: { owner: 'PostHog', repo: 'posthog-js' },
        payload: { pull_request: { number: 5402, head: { sha, repo: { full_name: 'PostHog/posthog-js' } } } },
    }
    try {
        await runScript(
            require,
            github,
            context,
            { info() {}, setFailed: (message) => errors.push(message) },
            { env: { REPORT_FILE: file, SMOKE_RESULT: outcome } }
        )
        return { created, updated, errors }
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

const successful = () => ({
    total: 6,
    passed: 6,
    failed: 0,
    skipped: 0,
    uncovered: 0,
    results: fixtureCases.map(([fixture, kase]) => ({ fixture, case: kase, cli: '0.18.11', ok: true, failures: [] })),
})

test('new smoke results create one bounded PR comment, later runs update that comment', async () => {
    const first = await report({ summary: successful() })
    assert.equal(first.created.length, 1)
    assert.match(first.created[0].body, /6\/6 passed/)
    assert.match(first.created[0].body, /vite-8-autocapture \| ✅ Passed/)
    assert.match(first.created[0].body, /actions\/runs\/123/)
    const next = await report({
        summary: successful(),
        comments: [{ id: 12, user: { login: 'github-actions[bot]' }, body: first.created[0].body }],
    })
    assert.equal(next.created.length, 0)
    assert.equal(next.updated[0].comment_id, 12)
    assert.deepEqual(next.errors, [])
})

test('PR-supplied failure text is escaped; missing data never claims success', async () => {
    const summary = successful()
    summary.passed = 5
    summary.failed = 1
    summary.results[0] = { ...summary.results[0], ok: false, failures: ['boom | <script>@team</script>'] }
    const failed = await report({ summary })
    assert.match(failed.created[0].body, /5\/6 passed/)
    assert.doesNotMatch(failed.created[0].body, /<script>|@team/)
    assert.match(failed.created[0].body, /&#124;/)
    const missing = await report({ outcome: 'success' })
    assert.match(missing.created[0].body, /No valid smoke summary/)
    assert.doesNotMatch(missing.created[0].body, /6\/6 passed/)
    assert.equal(missing.errors.length, 1)
})

test('a run from an outdated PR head cannot overwrite the current report', async () => {
    const stale = await report({ summary: successful(), currentSha: 'b'.repeat(40) })
    assert.deepEqual([stale.created.length, stale.updated.length], [0, 0])
})
