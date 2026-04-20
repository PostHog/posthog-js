import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSemver } from './release-utils.ts'

for (const [input, expected] of [
    ['1.370.0', { major: 1, minor: 370, patch: 0, prerelease: undefined }],
    ['1.370.0-beta.1', { major: 1, minor: 370, patch: 0, prerelease: 'beta.1' }],
    ['1.370', null],
    ['v1.370.0', null],
] as const) {
    test(`parseSemver('${input}')`, () => {
        assert.deepEqual(parseSemver(input), expected)
    })
}
