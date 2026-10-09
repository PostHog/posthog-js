import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url))

test('compatibility update rejects partial selectors and insufficient repeats before preparation', () => {
    const folder = mkdtempSync(join(tmpdir(), 'compat-cli-'))
    try {
        for (const args of [
            ['--modes', 'npm'],
            ['--repeats', '1'],
        ]) {
            const output = join(folder, args[0].slice(2))
            const result = spawnSync(process.execPath, [cli, 'update', ...args, '--output', output], {
                encoding: 'utf8',
            })
            assert.equal(result.status, 1)
            assert.match(result.stderr, /Updates require the full matrix|At least two repetitions/)
            assert.equal(existsSync(output), false)
        }
    } finally {
        rmSync(folder, { recursive: true })
    }
})
