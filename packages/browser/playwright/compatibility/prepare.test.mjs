import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inventoryTree, coreSource } from './prepare.mjs'
import { HISTORICAL_PACKAGES } from './golden.mjs'

test('historical slim selects its pinned package while snippet and npm retain the older core', () => {
    const manifest = {
        sources: {
            candidate: { version: 'current' },
            historical: { version: HISTORICAL_PACKAGES.historical.version },
            'historical-slim': { version: HISTORICAL_PACKAGES['historical-slim'].version },
        },
    }
    for (const entrypoint of ['snippet', 'npm', 'slim']) {
        assert.equal(coreSource(manifest, 'current', entrypoint), manifest.sources.candidate)
        const source = coreSource(manifest, 'historical', entrypoint)
        assert.equal(source, manifest.sources[entrypoint === 'slim' ? 'historical-slim' : 'historical'])
        assert.equal(source.version, entrypoint === 'slim' ? '1.407.6' : '1.354.0')
    }
})

const runtimeFiles = new Set(['browser/firefox/firefox/.parentlock'])

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'compat-browser-inventory-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, 'firefox'))
    writeFileSync(join(root, 'firefox', 'firefox'), 'browser executable')
    return root
}

const inventory = (root, label = 'browser/firefox') => inventoryTree(root, label, {}, new Set(), runtimeFiles)

test('Firefox runtime lock creation, changes and removal do not change immutable inputs', (t) => {
    const root = fixture(t)
    const expected = inventory(root)
    const lock = join(root, 'firefox', '.parentlock')
    writeFileSync(lock, '')
    assert.deepEqual(inventory(root), expected)
    writeFileSync(lock, 'runtime lock state')
    assert.deepEqual(inventory(root), expected)
    unlinkSync(lock)
    symlinkSync('runtime-process-id', lock)
    assert.deepEqual(inventory(root), expected)
    unlinkSync(lock)
    assert.deepEqual(inventory(root), expected)
})

test('browser executable changes and additional files remain fingerprinted', (t) => {
    const root = fixture(t)
    const expected = inventory(root)
    writeFileSync(join(root, 'firefox', 'firefox'), 'changed executable')
    assert.notEqual(inventory(root)['browser/firefox/firefox/firefox'], expected['browser/firefox/firefox/firefox'])
    writeFileSync(join(root, 'firefox', 'additional.js'), 'additional input')
    assert(Object.hasOwn(inventory(root), 'browser/firefox/firefox/additional.js'))
})

test('same-named files outside the Firefox installation path remain fingerprinted', (t) => {
    const root = fixture(t)
    const lock = join(root, 'firefox', '.parentlock')
    writeFileSync(lock, 'initial input')
    for (const label of ['candidate/sdk', 'compatibility', 'browser/chromium']) {
        const before = inventory(root, label)
        writeFileSync(lock, 'changed input')
        assert.notEqual(inventory(root, label)[`${label}/firefox/.parentlock`], before[`${label}/firefox/.parentlock`])
        writeFileSync(lock, 'initial input')
    }
    writeFileSync(join(root, '.parentlock'), 'different path')
    assert(Object.hasOwn(inventory(root), 'browser/firefox/.parentlock'))
})

test('directories at the runtime-lock path are not excluded', (t) => {
    const root = fixture(t)
    const directory = join(root, 'firefox', '.parentlock')
    mkdirSync(directory)
    writeFileSync(join(directory, 'input.js'), 'immutable input')
    assert(Object.hasOwn(inventory(root), 'browser/firefox/firefox/.parentlock/input.js'))
})
