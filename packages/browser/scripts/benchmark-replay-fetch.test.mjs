import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

const scratch = mkdtempSync(path.join(tmpdir(), 'replay-fetch-cli-'))
after(() => rmSync(scratch, { recursive: true, force: true }))
const script = path.join(import.meta.dirname, 'benchmark-replay-fetch.mjs')
const message = 'REPLAY_FETCH_RUNS must be a positive safe integer'

for (const mode of ['abort', 'benchmark']) {
    for (const runs of ['0', '-1', 'invalid', '1.5', 'Infinity', '9007199254740992', '1', '3']) {
        test(`${mode}: repetition count ${runs}`, () => {
            const result = spawnSync(process.execPath, [script], {
                encoding: 'utf8',
                timeout: 10000,
                env: {
                    ...process.env,
                    REPLAY_FETCH_MODE: mode === 'benchmark' ? 'benchmark' : 'correctness',
                    REPLAY_FETCH_CASE: mode === 'abort' ? 'abort' : 'body',
                    REPLAY_FETCH_RUNS: runs,
                    REPLAY_FETCH_BASELINE: scratch,
                    REPLAY_FETCH_CANDIDATE: scratch,
                    REPLAY_FETCH_OUTPUT: path.join(scratch, 'output'),
                    REPLAY_FETCH_WRAPPERS: 'none',
                    REPLAY_FETCH_BROWSERS: 'chromium',
                },
            })
            assert.ifError(result.error)
            assert.equal(result.status, 1)
            if (runs === '1' || runs === '3') {
                assert.match(result.stderr, /ENOENT/)
                assert.ok(!result.stderr.includes(message))
            } else {
                assert.ok(result.stderr.includes(message), result.stderr)
                assert.doesNotMatch(result.stderr, /ENOENT/)
            }
        })
    }
}
