import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// Exercise the exact inline script: the write-capable job must not load PR code.
const workflow = readFileSync(
    new URL('../../../.github/workflows/sdk-compliance-tests-node-v2.yml', import.meta.url),
    'utf8'
)
const script = workflow
    .split('                  script: |\n')[1]
    .split('\n')
    .map((line) => line.slice(22))
    .join('\n')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const run = new AsyncFunction('require', 'process', 'context', 'core', 'github', script)
const marker = '<!-- posthog-sdk-compliance-report-posthog-node -->'
const sha = 'a'.repeat(40)

function report(mode, status = 'passed') {
    const profile = mode === 'v0' ? 'node-legacy' : 'node-analytics-v1'
    return {
        contract_version: 'sdk-compliance-v2-draft2',
        profiles: [{ id: profile }],
        results: [
            {
                profile_id: profile,
                case_id: 'example',
                result: {
                    status,
                    executed: true,
                    failure: status === 'passed' ? undefined : { message: 'Unexpected flag value' },
                },
            },
        ],
        errors: [],
    }
}

async function exercise(options = {}) {
    const root = mkdtempSync(join(tmpdir(), 'node-compliance-report-'))
    const calls = []
    const context = {
        serverUrl: 'https://github.com',
        repo: { owner: 'PostHog', repo: 'posthog-js' },
        runId: 123,
        sha,
        actor: options.actor || 'contributor',
        payload: options.noPr
            ? {}
            : {
                  pull_request: {
                      number: 5052,
                      head: {
                          sha,
                          repo: { full_name: options.fork ? 'contributor/posthog-js' : 'PostHog/posthog-js' },
                      },
                  },
              },
    }
    let summary = ''
    const core = {
        info() {},
        summary: {
            addRaw(body) {
                summary = body
                return this
            },
            async write() {
                calls.push('summary')
            },
        },
    }
    const github = {
        rest: {
            pulls: {
                async get() {
                    calls.push('get')
                    return { data: { head: { sha: options.currentSha || sha } } }
                },
            },
            issues: {
                listComments() {},
                async updateComment(input) {
                    calls.push(['update', input])
                },
                async createComment(input) {
                    calls.push(['create', input])
                    if (options.postError) throw new Error('Forbidden')
                },
            },
        },
        async paginate() {
            calls.push('paginate')
            return options.comments || []
        },
    }
    try {
        for (const mode of ['v0', 'v1']) {
            if (options.missing?.includes(mode)) continue
            const dir = join(root, `node-v2-${mode}`)
            mkdirSync(join(dir, 'reports'), { recursive: true })
            const data = options.reports?.[mode] || report(mode)
            writeFileSync(join(dir, 'source.txt'), options.source || sha)
            writeFileSync(join(dir, 'reports/report.json'), typeof data === 'string' ? data : JSON.stringify(data))
            writeFileSync(join(dir, 'reports/cli-exit.txt'), options.exit || '0')
            writeFileSync(join(dir, 'reports/report-check-exit.txt'), options.validation || '0')
        }
        let error
        try {
            await run(createRequire(import.meta.url), { env: { REPORT_ROOT: root } }, context, core, github)
        } catch (caught) {
            error = caught
        }
        return { summary, calls, error }
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
}

test('creates one combined comment for both profiles and writes the same summary', async () => {
    const { summary, calls, error } = await exercise()
    assert.equal(error, undefined)
    assert.match(summary, /Capture v0/)
    assert.match(summary, /Capture v1/)
    assert.match(summary, /Advisory results/)
    assert.equal((summary.match(/All selected cases passed/g) || []).length, 2)
    assert.equal(calls[0], 'summary')
    assert.equal(calls.at(-1)[0], 'create')
    assert.equal(calls.at(-1)[1].body, summary)
})

test('updates the existing bot comment, ignoring a matching human comment', async () => {
    const { calls } = await exercise({
        comments: [
            { id: 1, user: { login: 'contributor' }, body: marker },
            { id: 2, user: { login: 'github-actions[bot]' }, body: `${marker}\nOld report` },
        ],
    })
    assert.equal(calls.at(-1)[0], 'update')
    assert.equal(calls.at(-1)[1].comment_id, 2)
})

test('shows failed cases without losing the other profile', async () => {
    const { summary, error } = await exercise({
        reports: { v0: report('v0', 'failed_assertion') },
        exit: '1',
        validation: '1',
    })
    assert.equal(error, undefined)
    assert.match(summary, /0 passed \/ 1 non-passing/)
    assert.match(summary, /Unexpected flag value/)
    assert.match(summary, /Capture v1/)
    assert.doesNotMatch(summary, /All selected cases passed/)
})

for (const options of [
    { missing: ['v0'] },
    { missing: ['v0', 'v1'] },
    { reports: { v0: 'not json' } },
    { source: 'wrong-sha' },
    { reports: { v0: report('v1') } },
]) {
    test(`reports unavailable/incomplete data: ${JSON.stringify(options)}`, async () => {
        const { summary, calls, error } = await exercise(options)
        assert.equal(error, undefined)
        assert.match(summary, /Results unavailable or incomplete/)
        assert.equal(calls.at(-1)[0], 'create')
    })
}

for (const options of [{ noPr: true }, { fork: true }, { actor: 'dependabot[bot]' }, { currentSha: 'b'.repeat(40) }]) {
    test(`retains summary without posting: ${JSON.stringify(options)}`, async () => {
        const { summary, calls } = await exercise(options)
        assert.match(summary, /Capture v0/)
        assert.ok(!calls.some((call) => Array.isArray(call)))
    })
}

test('preserves summary when comment publication fails', async () => {
    const { summary, error } = await exercise({ postError: true })
    assert.match(summary, /Capture v1/)
    assert.match(error.message, /Forbidden/)
})

test('escapes artifact markup and mentions and bounds the comment size', async () => {
    const data = report('v0', 'failed_assertion')
    data.results[0].case_id = '<script>@someone **bad**</script>'
    data.results[0].result.failure.message = '[click](https://example.com)'.repeat(1000)
    data.results = Array(100).fill(data.results[0])
    const v1 = JSON.parse(JSON.stringify(data))
    v1.profiles[0].id = 'node-analytics-v1'
    for (const result of v1.results) result.profile_id = 'node-analytics-v1'
    const { summary } = await exercise({ reports: { v0: data, v1 } })
    assert.doesNotMatch(summary, /<script>|@someone|\[click\]/)
    assert.match(summary, /80 more non-passing/)
    assert.ok(summary.length < 65536)
})

test('empty selections and harness errors are not presented as conformant', async () => {
    const data = report('v0')
    data.results = []
    data.errors = [{ message: 'fixture startup failed' }]
    const { summary } = await exercise({ reports: { v0: data } })
    assert.match(summary, /fixture startup failed/)
    assert.match(summary, /Not conformant or incomplete/)
})
