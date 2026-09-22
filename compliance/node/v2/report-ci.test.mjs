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
const specsCommit = 'b'.repeat(40)
const source = { path: 'migration/yaml-parity-v1/local-evaluation-v1.feature', line: 1118, revision: 'c'.repeat(64) }
const failedStep = { index: 5, source: { ...source, line: 1187 } }

function diagnostics(
    data,
    details = {
        operation: '/get_feature_flag',
        arguments: { key: 'flag', distinct_id: 'user', person_properties: { value: false } },
        expected: false,
        actual: true,
    }
) {
    return {
        run_id: data.run_id,
        distribution: { source: { commit: specsCommit, dirty: false } },
        cases: data.results.map((r) => ({
            case_id: r.case_id,
            profile_id: r.profile_id,
            source: r.source,
            invocations: [],
            failure: r.result.failure
                ? { ...r.result.failure, kind: 'assertion', step_text: 'Then the local flag value is false', details }
                : undefined,
        })),
    }
}

function report(mode, status = 'passed') {
    const profile = mode === 'v0' ? 'node-legacy' : 'node-analytics-v1'
    return {
        contract_version: 'sdk-compliance-v2-draft2',
        run_id: `run-${mode}`,
        profiles: [{ id: profile }],
        results: [
            {
                profile_id: profile,
                case_id: 'example',
                source,
                result: {
                    status,
                    executed: true,
                    failure:
                        status === 'passed'
                            ? undefined
                            : { code: 'local_flag_value', message: 'Unexpected flag value', failed_step: failedStep },
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
            if (options.diagnostics?.[mode] !== null && typeof data !== 'string') {
                const diagnostic = options.diagnostics?.[mode] ?? diagnostics(data)
                writeFileSync(
                    join(dir, 'reports/report.json.diagnostics.json'),
                    typeof diagnostic === 'string' ? diagnostic : JSON.stringify(diagnostic)
                )
            }
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
    assert.doesNotMatch(summary, /example|<details>/)
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
    assert.match(summary, /✅ 0 passed \/ ❌ 1 non-passing/)
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
    const { summary } = await exercise({ reports: { v0: data, v1 }, diagnostics: { v0: null, v1: null } })
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

test('renders attributed getter failure, public arguments, expected/actual, specs commit and artifact drill-down', async () => {
    const data = report('v0', 'failed_assertion')
    const diagnostic = diagnostics(data)
    diagnostic.cases[0].wire_requests = [{ headers: { authorization: 'wire-secret' } }]
    Object.assign(diagnostic.cases[0].failure.details, { headers: 'header-secret', unknown: 'unknown-secret' })
    Object.assign(diagnostic.cases[0].failure.details.arguments, {
        api_key: 'arg-secret',
        config: { token: 'config-secret' },
    })
    diagnostic.cases[0].failure.details.arguments.person_properties.token = 'nested-secret'
    const { summary } = await exercise({ reports: { v0: data }, diagnostics: { v0: diagnostic } })
    assert.match(summary, /<details>\n<summary>❌ example/)
    assert.match(summary, /Then the local flag value is false/)
    assert.match(summary, /Operation: <code>\/get&#95;feature&#95;flag<\/code>/)
    assert.match(summary, /Arguments:<pre>.*"key":"flag".*"value":false/)
    assert.match(summary, /Expected:<pre>false<\/pre>/)
    assert.match(summary, /Actual:<pre>true<\/pre>/)
    assert.ok(summary.includes(`https://github.com/PostHog/sdk-specs/blob/${specsCommit}/${source.path}#L1187`))
    assert.doesNotMatch(summary, /-secret|cccccccccccccccc|unknown|wire_requests/)
    assert.match(summary, /node-v2-v0/)
    assert.match(summary, /reports\/report.json.diagnostics.json/)
    assert.match(summary, /actions\/runs\/123#artifacts/)
})

for (const [expected, actual] of [
    [null, false],
    [0, { kind: 'undefined' }],
    ['conclusive value', { kind: 'inconclusive' }],
    [{ variant: [true, 0] }, 'control'],
]) {
    test(`preserves expected and actual JSON: ${JSON.stringify([expected, actual])}`, async () => {
        const data = report('v0', 'failed_assertion')
        const { summary } = await exercise({
            reports: { v0: data },
            diagnostics: { v0: diagnostics(data, { operation: '/get_feature_flag', expected, actual }) },
        })
        const decode = (text) => text.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        assert.ok(decode(summary).includes(`Expected:<pre>${JSON.stringify(expected)}</pre>`))
        assert.ok(decode(summary).includes(`Actual:<pre>${JSON.stringify(actual)}</pre>`))
    })
}

for (const operation of ['/flags', '/flags/']) {
    test(`renders remote wire assertion fields and missing values for ${operation}`, async () => {
        const data = report('v0', 'failed_assertion')
        const { summary } = await exercise({
            reports: { v0: data },
            diagnostics: {
                v0: diagnostics(data, {
                    operation,
                    field: 'person_properties.email',
                    expected: 'user@example.com',
                    actual: { kind: 'missing' },
                }),
            },
        })
        assert.ok(summary.includes(`Operation: <code>${operation}</code>`))
        assert.match(summary, /Field: <code>person&#95;properties.email<\/code>/)
        assert.match(summary, /Expected:<pre>"user&#64;example.com"/)
        assert.match(summary, /Actual:<pre>{"kind":"missing"}/)
    })
}

test('old diagnostics preserve exact failed step without invented values', async () => {
    const data = report('v0', 'failed_assertion')
    const diagnostic = diagnostics(data)
    delete diagnostic.cases[0].failure
    const { summary } = await exercise({ reports: { v0: data }, diagnostics: { v0: diagnostic } })
    assert.match(summary, /Unexpected flag value/)
    assert.match(summary, /local-evaluation-v1.feature:1187/)
    assert.doesNotMatch(summary, /Expected:|Actual:|Arguments:|Detailed diagnostics unavailable/)
})

for (const [name, mutate] of [
    [
        'run',
        (d) => {
            d.run_id = 'other-run'
        },
    ],
    [
        'profile',
        (d) => {
            d.cases[0].profile_id = 'node-analytics-v1'
        },
    ],
    [
        'case',
        (d) => {
            d.cases[0].case_id = 'other-case'
        },
    ],
    [
        'source',
        (d) => {
            d.cases[0].source = { ...source, revision: 'other' }
        },
    ],
    [
        'duplicate',
        (d) => {
            d.cases.push(d.cases[0])
        },
    ],
    ['malformed', () => 'not json'],
    ['oversized', () => ' '.repeat(10 * 1024 * 1024 + 1)],
    ['missing', () => null],
]) {
    test(`rejects ${name} diagnostics without losing report totals and source`, async () => {
        const data = report('v0', 'failed_assertion')
        const diagnostic = diagnostics(data)
        const replacement = mutate(diagnostic)
        const { summary } = await exercise({
            reports: { v0: data },
            diagnostics: { v0: replacement === undefined ? diagnostic : replacement },
        })
        assert.match(summary, /Detailed diagnostics unavailable or mismatched/)
        assert.match(summary, /❌ 1 non-passing/)
        assert.match(summary, /local-evaluation-v1.feature:1187/)
        assert.doesNotMatch(summary, /Expected:|Actual:|sdk-specs\/blob/)
    })
}

test('rejects failure details attributed to a different step', async () => {
    const data = report('v0', 'failed_assertion')
    const diagnostic = diagnostics(data)
    diagnostic.cases[0].failure.failed_step = { ...failedStep, index: 6 }
    const { summary } = await exercise({ reports: { v0: data }, diagnostics: { v0: diagnostic } })
    assert.match(summary, /Unexpected flag value/)
    assert.doesNotMatch(summary, /Expected:|Actual:|Then the local/)
})

for (const provenance of [
    { dirty: true, commit: specsCommit },
    { dirty: false, commit: source.revision },
    { dirty: false },
    { commit: specsCommit },
    { dirty: false, commit: 'https://example.com' },
]) {
    test(`does not link uncertain specs provenance: ${JSON.stringify(provenance)}`, async () => {
        const data = report('v0', 'failed_assertion')
        const diagnostic = diagnostics(data)
        diagnostic.distribution.source = provenance
        const { summary } = await exercise({ reports: { v0: data }, diagnostics: { v0: diagnostic } })
        assert.match(summary, /local-evaluation-v1.feature:1187/)
        assert.doesNotMatch(summary, /sdk-specs\/blob/)
    })
}

for (const path of [
    '../bad.feature',
    '/absolute.feature',
    'a/../bad.feature',
    'a\\bad.feature',
    'https://host/bad.feature',
    'a\nbad.feature',
]) {
    test(`does not link unsafe source path: ${JSON.stringify(path)}`, async () => {
        const data = report('v0', 'failed_assertion')
        data.results[0].result.failure.failed_step = { index: 5, source: { ...source, path } }
        const { summary } = await exercise({ reports: { v0: data } })
        assert.doesNotMatch(summary, /sdk-specs\/blob/)
    })
}

test('encodes source URL path segments', async () => {
    const data = report('v0', 'failed_assertion')
    data.results[0].result.failure.failed_step = { index: 5, source: { ...source, path: 'migration/a b#(c).feature' } }
    const { summary } = await exercise({ reports: { v0: data } })
    assert.match(summary, /\/migration\/a%20b%23%28c%29.feature#L1118/)
})

test('bounds worst-case escaped and multibyte failures across both profiles without broken details', async () => {
    const reports = {}
    for (const mode of ['v0', 'v1']) {
        const data = report(mode, 'failed_assertion')
        const failure = data.results[0]
        failure.result.failure.message = '<@[`&\\*_\n'.repeat(1000)
        data.results = Array.from({ length: 100 }, (_, i) => ({ ...failure, case_id: `case-${i}-` + '😀'.repeat(300) }))
        data.errors = Array(20).fill({ message: '😀'.repeat(400) })
        reports[mode] = data
    }
    const allDiagnostics = Object.fromEntries(
        Object.entries(reports).map(([mode, data]) => {
            const d = diagnostics(data, {
                operation: '/get_feature_flag',
                arguments: { key: '😀'.repeat(1200) },
                expected: '<script>@mention</script>'.repeat(500),
                actual: '😀'.repeat(1200),
            })
            for (const c of d.cases) c.failure.step_text = '</pre></details>@mention'.repeat(500)
            return [mode, d]
        })
    )
    const { summary } = await exercise({ reports, diagnostics: allDiagnostics })
    assert.ok(Buffer.byteLength(summary, 'utf8') <= 60000)
    assert.match(summary, /Capture v0/)
    assert.match(summary, /Capture v1/)
    assert.match(summary, /more non-passing cases/)
    assert.doesNotMatch(summary, /<script>|@mention|&#\d*…/)
    assert.equal((summary.match(/<details>/g) || []).length, (summary.match(/<\/details>/g) || []).length)
    assert.ok(summary.includes('…'))
})

test('enforces the overall UTF-8 comment budget with an explicit artifact truncation notice', async () => {
    const reports = {}
    const allDiagnostics = {}
    for (const mode of ['v0', 'v1']) {
        const data = report(mode, 'failed_assertion')
        data.results[0].result.failure.message = 'x'.repeat(400)
        data.results = Array.from({ length: 100 }, (_, i) => ({
            ...data.results[0],
            case_id: `${i}-` + 'x'.repeat(390),
        }))
        data.errors = Array(20).fill({ message: '界'.repeat(400) })
        reports[mode] = data
        allDiagnostics[mode] = diagnostics(data)
        for (const c of allDiagnostics[mode].cases) delete c.failure
    }
    const { summary, calls } = await exercise({ reports, diagnostics: allDiagnostics })
    assert.ok(Buffer.byteLength(summary, 'utf8') <= 60000)
    assert.match(summary, /Report truncated; see \[workflow artifacts\]/)
    assert.match(summary, /Capture v0/)
    assert.match(summary, /Capture v1/)
    assert.equal((summary.match(/<details>/g) || []).length, (summary.match(/<\/details>/g) || []).length)
    assert.equal(calls.at(-1)[1].body, summary)
})
