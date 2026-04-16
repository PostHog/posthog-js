import test from 'node:test'
import assert from 'node:assert/strict'
import {
    assertVersionEntries,
    generateManifestFromVersions,
    getManifestKvKey,
    isFlatStringMap,
    parseSemver,
    parseStableSemver,
    toCanonicalJsonString,
} from './release-utils.ts'

test('parseSemver accepts stable and prerelease versions', () => {
    assert.deepEqual(parseSemver('1.370.0'), { major: 1, minor: 370, patch: 0, prerelease: undefined })
    assert.deepEqual(parseSemver('1.370.0-beta.1'), { major: 1, minor: 370, patch: 0, prerelease: 'beta.1' })
    assert.equal(parseSemver('1.370'), null)
})

test('parseStableSemver rejects prereleases', () => {
    assert.deepEqual(parseStableSemver('1.370.0'), { major: 1, minor: 370, patch: 0, prerelease: undefined })
    assert.equal(parseStableSemver('1.370.0-beta.1'), null)
})

test('generateManifestFromVersions ignores yanked entries and prereleases', () => {
    assert.deepEqual(
        generateManifestFromVersions([
            { version: '1.369.0', timestamp: '2026-04-10T00:00:00Z' },
            { version: '1.370.0-beta.1', timestamp: '2026-04-11T00:00:00Z' },
            { version: '1.370.0', timestamp: '2026-04-12T00:00:00Z' },
            { version: '1.370.1', timestamp: '2026-04-13T00:00:00Z', yanked: true },
            { version: '2.0.0', timestamp: '2026-04-14T00:00:00Z' },
        ]),
        {
            '1': '1.370.0',
            '1.369': '1.369.0',
            '1.370': '1.370.0',
            '2': '2.0.0',
            '2.0': '2.0.0',
        }
    )
})

test('isFlatStringMap validates manifest payloads', () => {
    assert.equal(isFlatStringMap({ '1': '1.370.0' }), true)
    assert.equal(isFlatStringMap({ '1': 1370 }), false)
    assert.equal(isFlatStringMap(['1.370.0']), false)
})

test('assertVersionEntries validates version pointer history', () => {
    assert.deepEqual(assertVersionEntries([{ version: '1.370.0', timestamp: '2026-04-16T00:00:00Z' }], 'versions.json'), [
        { version: '1.370.0', timestamp: '2026-04-16T00:00:00Z' },
    ])
    assert.throws(() => assertVersionEntries([{ version: 1370 }], 'versions.json'))
})

test('toCanonicalJsonString sorts object keys', () => {
    assert.equal(toCanonicalJsonString({ b: '2', a: '1' }), '{"a":"1","b":"2"}')
})

test('getManifestKvKey returns the global manifest key', () => {
    assert.equal(getManifestKvKey(), 'manifest')
})
