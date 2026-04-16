import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSemver } from './release-utils.ts'

test('parseSemver accepts stable and prerelease versions', () => {
    assert.deepEqual(parseSemver('1.370.0'), { major: 1, minor: 370, patch: 0, prerelease: undefined })
    assert.deepEqual(parseSemver('1.370.0-beta.1'), { major: 1, minor: 370, patch: 0, prerelease: 'beta.1' })
    assert.equal(parseSemver('1.370'), null)
    assert.equal(parseSemver('v1.370.0'), null)
})
