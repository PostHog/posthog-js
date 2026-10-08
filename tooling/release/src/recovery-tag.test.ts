import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const workflow = readFileSync(new URL('../../../.github/workflows/recover-s3-release.yml', import.meta.url), 'utf8')
const start = workflow.indexOf("                  tag_sha=''\n")
const end = workflow.indexOf('                  source_sha="$INPUT_SOURCE_SHA"\n', start)
assert.ok(start >= 0 && end > start, 'Recovery tag lookup must be present')
const lookup = workflow.slice(start, end).replace(/^ {18}/gm, '')

for (const kind of ['missing', 'lightweight', 'annotated'] as const) {
    test(`recovery tag lookup handles ${kind} tags under errexit`, async (t) => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-tag-'))
        t.after(() => fs.rm(dir, { recursive: true, force: true }))
        // Use an isolated Git configuration and identity; never invoke the user's
        // signing agent or hooks while creating disposable test commits/tags.
        const env = {
            PATH: process.env.PATH,
            HOME: dir,
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: path.join(dir, 'empty-gitconfig'),
            GIT_AUTHOR_NAME: 'Release test',
            GIT_AUTHOR_EMAIL: 'release-test@example.invalid',
            GIT_COMMITTER_NAME: 'Release test',
            GIT_COMMITTER_EMAIL: 'release-test@example.invalid',
        }
        const git = (...args: string[]) => {
            const result = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' })
            assert.equal(result.status, 0, result.stderr)
            return result.stdout.trim()
        }
        git('init', '--quiet')
        git('commit', '--allow-empty', '--quiet', '-m', 'fixture')
        const commit = git('rev-parse', 'HEAD')
        const tag = 'posthog-js@1.438.3'
        if (kind === 'lightweight') git('tag', tag)
        if (kind === 'annotated') git('tag', '-a', tag, '-m', 'fixture release')

        // Execute the actual workflow snippet, including its failed-command
        // assignment, and the same non-empty test that blocks npm publication.
        const result = spawnSync(
            'bash',
            [
                '-c',
                `set -euo pipefail
${lookup}
printf 'resolved=%s\\n' "$tag_sha"
if [ -n "$tag_sha" ]; then printf 'exists\\n'; else printf 'missing\\n'; fi
`,
            ],
            { cwd: dir, env: { ...env, tag }, encoding: 'utf8' }
        )
        assert.equal(result.status, 0, result.stderr)
        if (kind === 'missing') {
            assert.equal(result.stdout, 'resolved=\nmissing\n')
        } else {
            assert.equal(result.stdout, `✓ found ${tag} at ${commit}\nresolved=${commit}\nexists\n`)
        }
    })
}
