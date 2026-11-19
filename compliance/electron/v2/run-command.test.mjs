import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('command cancellation never signals a retired child process group', () => {
    const directory = mkdtempSync(join(tmpdir(), 'electron-command-retired-'))
    try {
        const preload = join(directory, 'retired.cjs')
        writeFileSync(
            preload,
            `
const { EventEmitter } = require('node:events');
const cp = require('node:child_process');
cp.spawn = () => {
    const child = Object.assign(new EventEmitter(), { pid: 424242, exitCode: null, signalCode: null });
    setTimeout(() => {
        child.exitCode = 0;
        child.emit('exit', 0);
        process.emit('SIGTERM');
    }, 20);
    return child;
};
process.kill = () => { throw new Error('attempted to signal retired identity') };
require('node:module').syncBuiltinESMExports();
`
        )
        const result = spawnSync(
            process.execPath,
            ['--require', preload, fileURLToPath(new URL('./run-command.mjs', import.meta.url)), '1000', 'controlled'],
            { encoding: 'utf8', timeout: 2000 }
        )
        assert.equal(result.error, undefined)
        assert.equal(result.status, 0, result.stderr)
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
})
