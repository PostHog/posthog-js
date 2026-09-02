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
const nuxtDir = join(repoRoot, 'packages/nuxt')
const nuxtFixture = join(nuxtDir, 'src', `oxlint-config-smoke-${fixtureSuffix}.ts`)

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
    writeFileSync(
        browserFixture,
        ["require('module')", 'var value = Promise.all([])', 'Array.isArray(value)'].join('\n')
    )
    writeFileSync(jestFixture, "it.only('smoke', () => {})\n")
    writeFileSync(
        nuxtFixture,
        [
            "import { defineNuxtModule } from '@nuxt/kit'",
            "import { addPlugin } from '@nuxt/kit'",
            '/** @property */',
            'const values: any = new Array()',
            'const pattern = /[0-9]/',
            'if (process.client) console.log(values, pattern, defineNuxtModule, addPlugin)',
        ].join('\n')
    )

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
        'typescript(no-require-imports)',
        'eslint(no-var)',
        'compat(compat)',
        'posthog-js(no-direct-array-check)',
    ]) {
        assert.match(output, new RegExp(rule.replace(/[()]/g, '\\$&')), `Expected ${rule} to run:\n${output}`)
    }

    const nuxtResult = spawnSync(oxlintBin, [nuxtFixture], { cwd: nuxtDir, encoding: 'utf8' })
    const nuxtOutput = `${nuxtResult.stdout}\n${nuxtResult.stderr}`

    assert.ifError(nuxtResult.error)
    assert.equal(
        nuxtResult.status,
        1,
        `Expected Nuxt lint fixture to fail, but Oxlint exited ${nuxtResult.status}:\n${nuxtOutput}`
    )
    for (const rule of [
        'import(no-duplicates)',
        'jsdoc(require-property-name)',
        'regexp-js(prefer-d)',
        'typescript(no-explicit-any)',
        'posthog-js(prefer-import-meta)',
    ]) {
        assert.match(nuxtOutput, new RegExp(rule.replace(/[()]/g, '\\$&')), `Expected ${rule} to run:\n${nuxtOutput}`)
    }
} finally {
    rmSync(reactFixture, { force: true })
    rmSync(browserFixture, { force: true })
    rmSync(jestFixture, { force: true })
    rmSync(nuxtFixture, { force: true })
}
