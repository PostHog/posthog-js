const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { rmSync, writeFileSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')

const repoRoot = resolve(__dirname, '../..')
const oxlintBin = join(dirname(require.resolve('oxlint/package.json')), 'bin', 'oxlint')
const fixtureSuffix = `${process.pid}-${Date.now()}`
const reactFixture = join(repoRoot, 'packages/react/src', `oxlint-config-smoke-${fixtureSuffix}.tsx`)
const browserFixture = join(repoRoot, 'packages/browser/src', `oxlint-config-smoke-${fixtureSuffix}.ts`)
const jestFixture = join(__dirname, `oxlint-config-smoke-${fixtureSuffix}.test.ts`)

try {
    writeFileSync(
        reactFixture,
        [
            "import { useEffect } from 'react'",
            'export function Smoke({ enabled, value }) {',
            '    if (enabled) useEffect(() => {})',
            '    return <div>{value}</div>',
            '}',
        ].join('\n')
    )
    writeFileSync(browserFixture, ['Promise.all([])', 'Array.isArray([])'].join('\n'))
    writeFileSync(jestFixture, "it.only('smoke', () => {})\n")

    const result = spawnSync(oxlintBin, [reactFixture, browserFixture, jestFixture], {
        cwd: repoRoot,
        encoding: 'utf8',
    })
    const output = `${result.stdout}\n${result.stderr}`

    assert.ifError(result.error)
    assert.equal(result.status, 1, `Expected lint fixtures to fail, but Oxlint exited ${result.status}:\n${output}`)
    for (const rule of [
        'react-hooks(rules-of-hooks)',
        'react-js(prop-types)',
        'jest(no-focused-tests)',
        'compat(compat)',
        'posthog-js(no-direct-array-check)',
    ]) {
        assert.match(output, new RegExp(rule.replace(/[()]/g, '\\$&')), `Expected ${rule} to run:\n${output}`)
    }
} finally {
    rmSync(reactFixture, { force: true })
    rmSync(browserFixture, { force: true })
    rmSync(jestFixture, { force: true })
}
