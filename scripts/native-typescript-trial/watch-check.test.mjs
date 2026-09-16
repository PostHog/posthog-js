import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'

// The real watch check writes temporary package sources; do not run it concurrently in this checkout.
test(
    'watch check waits for recovery even when the failed build emits declarations',
    { skip: process.platform === 'win32' },
    () => {
        const fixture = mkdtempSync(join(tmpdir(), 'native-watch-regression-'))
        const recovered = join(fixture, 'recovered')
        try {
            writeFileSync(
                join(fixture, 'pnpm'),
                `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const configPath = process.argv.at(-1)
const config = readFileSync(configPath, 'utf8')
const dest = JSON.parse(config.match(/root: ("[^"]+")/)[1])
const pid = configPath.match(/(\\d+)\\.mjs$/)[1]
const name = '__native_watch_trial_' + pid
const source = join(process.cwd(), 'src', name + '.ts')
const declaration = join(dest, name + '.d.ts')
let previous
let failed = false
setInterval(() => {
    const content = readFileSync(source, 'utf8')
    if (content === previous) return
    previous = content
    const type = content.match(/value: (\\w+)/)[1]
    const emit = () => writeFileSync(declaration, 'export declare const value: ' + type + ';\\n')
    if (content.includes('string = 123')) {
        failed = true
        emit()
        process.stdout.write('error TS2322\\n')
    } else if (failed) {
        setTimeout(() => {
            writeFileSync(process.env.RECOVERY_MARKER, 'recovered')
            emit()
        }, 1000)
    } else {
        emit()
    }
}, 20)
`,
                { mode: 0o755 }
            )
            writeFileSync(join(fixture, 'package.json'), '{"type":"module"}\n')
            const result = spawnSync(process.execPath, [join(import.meta.dirname, 'watch-check.mjs')], {
                env: { ...process.env, PATH: `${fixture}${delimiter}${process.env.PATH}`, RECOVERY_MARKER: recovered },
                encoding: 'utf8',
                timeout: 45_000,
            })
            assert.equal(result.status, 0, result.stdout + result.stderr)
            assert.ok(
                existsSync(recovered),
                'watch check reported success before the corrected build emitted declarations'
            )
        } finally {
            rmSync(fixture, { recursive: true, force: true })
        }
    }
)
