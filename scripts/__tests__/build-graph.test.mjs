import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const rootPackage = readJson('package.json')
const turbo = readJson('turbo.json')
const rrwebPackages = globSync(['packages/rrweb/*/package.json', 'packages/rrweb/plugins/*/package.json'], {
    cwd: root,
}).map(readJson)
const graphs = new Map()

function dryRun(args) {
    const key = args.join(' ')
    if (!graphs.has(key)) {
        const output = execFileSync('pnpm', ['exec', 'turbo', ...args, '--dry=json'], {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 8 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        graphs.set(key, JSON.parse(output))
    }
    return graphs.get(key).tasks
}

function rootScriptGraph(name) {
    const [command, ...args] = rootPackage.scripts[name].split(' ')
    assert.equal(command, 'turbo')
    return dryRun(args)
}

function prerequisites(tasks, taskId) {
    const byId = new Map(tasks.map((task) => [task.taskId, task]))
    const visited = new Set()
    function visit(id) {
        for (const dependency of byId.get(id).dependencies) {
            if (!visited.has(dependency)) {
                visited.add(dependency)
                visit(dependency)
            }
        }
    }
    visit(taskId)
    return visited
}

const executable = (tasks) => tasks.filter((task) => task.command !== '<NONEXISTENT>')

test('rrweb has one local build command per package, with no parallel prepublish graph', () => {
    assert.equal(turbo.tasks.prepublish, undefined)
    for (const pkg of rrwebPackages) {
        assert.doesNotMatch(pkg.scripts.build, /\bturbo\b/, pkg.name)
        assert.equal(pkg.scripts.prepublish, undefined, pkg.name)
        assert.match(pkg.scripts.build, /\bvite build\b/, pkg.name)
    }
    assert.match(readJson('packages/rrweb/record/package.json').scripts.build, /pnpm build:declarations/)
})

test('a filtered rrweb build includes non-rrweb prerequisites in the outer graph', () => {
    const tasks = dryRun(['run', 'build', '--filter=@posthog/rrweb-record'])
    const dependencies = prerequisites(tasks, '@posthog/rrweb-record#build')
    for (const pkg of ['@posthog/core', '@posthog/types', '@posthog/rrweb-utils', '@posthog/rrweb']) {
        assert.ok(dependencies.has(`${pkg}#build`), pkg)
    }
    for (const task of executable(tasks)) {
        assert.equal(task.task, 'build')
        assert.doesNotMatch(task.command, /\bturbo\b/, task.taskId)
    }
})

test('the browser compliance image builds the SDK and its prerequisites through Turbo', () => {
    const dockerfile = readFileSync(resolve(root, 'compliance/browser/Dockerfile'), 'utf8')
    const commands = [...dockerfile.matchAll(/^RUN pnpm turbo (.+)$/gm)]
    assert.equal(commands.length, 1)
    const tasks = dryRun(commands[0][1].split(' '))
    assert.ok(executable(tasks).some((task) => task.taskId === 'posthog-js#build'))
    const dependencies = prerequisites(tasks, 'posthog-js#build')
    for (const pkg of ['@posthog/types', '@posthog/core', '@posthog/browser-common', '@posthog/rrweb-record']) {
        assert.ok(dependencies.has(`${pkg}#build`), pkg)
    }
    assert.ok(executable(tasks).every((task) => task.task === 'build'))
})

test('shared rrweb tooling hashes without Git metadata or installed dependency directories', () => {
    const fixture = mkdtempSync(resolve(tmpdir(), 'rrweb-tooling-inputs-'))
    try {
        mkdirSync(resolve(fixture, 'packages/consumer'), { recursive: true })
        mkdirSync(resolve(fixture, 'tooling/rrweb-build/node_modules'), { recursive: true })
        mkdirSync(resolve(fixture, 'installed-vite'))
        symlinkSync(
            resolve(fixture, 'installed-vite'),
            resolve(fixture, 'tooling/rrweb-build/node_modules/vite'),
            'dir'
        )
        writeFileSync(
            resolve(fixture, 'package.json'),
            JSON.stringify({ name: 'tooling-input-fixture', private: true, packageManager: rootPackage.packageManager })
        )
        writeFileSync(resolve(fixture, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
        writeFileSync(
            resolve(fixture, 'pnpm-lock.yaml'),
            "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/consumer: {}\n"
        )
        writeFileSync(
            resolve(fixture, 'packages/consumer/package.json'),
            JSON.stringify({ name: 'consumer', scripts: { build: 'echo build' } })
        )
        writeFileSync(
            resolve(fixture, 'turbo.json'),
            JSON.stringify({ tasks: { build: { inputs: turbo.tasks.build.inputs } } })
        )
        const files = ['index.ts', 'vite.mjs', 'package.json']
        for (const file of files) {
            writeFileSync(
                resolve(fixture, 'tooling/rrweb-build', file),
                readFileSync(resolve(root, 'tooling/rrweb-build', file))
            )
        }
        const task = () => {
            return JSON.parse(
                execFileSync(
                    resolve(root, 'node_modules/.bin/turbo'),
                    ['run', 'build', '--filter=consumer', '--dry=json'],
                    {
                        cwd: fixture,
                        encoding: 'utf8',
                        stdio: ['ignore', 'pipe', 'pipe'],
                        timeout: 20_000,
                    }
                )
            ).tasks[0]
        }
        const initial = task()
        assert.ok(!Object.keys(initial.inputs).some((file) => file.includes('node_modules')))
        for (const file of files) {
            const target = resolve(fixture, 'tooling/rrweb-build', file)
            const original = readFileSync(target, 'utf8')
            writeFileSync(target, original + '\n')
            assert.notEqual(task().hash, initial.hash, `${file} must invalidate the build cache`)
            writeFileSync(target, original)
        }
    } finally {
        rmSync(fixture, { recursive: true, force: true })
    }
})

test('type checks use dependency builds without scheduling a second compilation graph', () => {
    const tasks = dryRun(['run', 'check-types'])
    assert.ok(!tasks.some((task) => task.task === 'prepublish'))
    assert.ok(prerequisites(tasks, '@posthog/rrweb-utils#check-types').has('@posthog/core#build'))
    assert.ok(prerequisites(tasks, '@posthog/browser#check-types').has('@posthog/browser#build'))
    assert.match(readJson('packages/browser-common/package.json').scripts['check-types'], /tsc --noEmit/)
})

test('root tests schedule leaf suites once, including every existing rrweb suite', () => {
    const tasks = rootScriptGraph('test')
    assert.ok(!tasks.some((task) => task.task === 'test'), 'package test wrappers must not rerun leaf suites')
    for (const task of executable(tasks)) {
        assert.doesNotMatch(task.command, /pnpm (?:test:unit|test:functional|test:headless|build)(?:\s|$)/, task.taskId)
    }
    for (const pkg of rrwebPackages.filter((pkg) => pkg.scripts.test)) {
        const id = `${pkg.name}#test:rrweb`
        assert.ok(
            executable(tasks).some((task) => task.taskId === id),
            id
        )
        assert.ok(prerequisites(tasks, id).has(`${pkg.name}#build`), id)
    }
    for (const id of ['posthog-js#test:unit', 'posthog-js#test:functional', '@posthog/browser#test:built']) {
        assert.ok(
            executable(tasks).some((task) => task.taskId === id),
            id
        )
    }
})

test('the unit CI entry point retains built-output checks without scheduling rrweb browser tests', () => {
    const tasks = rootScriptGraph('test:unit')
    const sourceId = '@posthog/browser#test:unit'
    const builtId = '@posthog/browser#test:built'
    assert.ok(executable(tasks).some((task) => task.taskId === builtId))
    assert.ok(!tasks.some((task) => task.task === 'test:rrweb'))
    assert.ok(!prerequisites(tasks, sourceId).has('@posthog/browser#build'))
    assert.ok(prerequisites(tasks, sourceId).has('@posthog/browser-common#build'))
    assert.ok(prerequisites(tasks, builtId).has('@posthog/browser#build'))
    for (const id of [sourceId, builtId]) {
        const task = tasks.find((task) => task.taskId === id)
        assert.doesNotMatch(task.command, /\b(?:rslib|pnpm) build\b/)
        assert.equal(task.resolvedTaskDefinition.cache, false)
    }
})

test('Node references consume the graph build without rebuilding inside the task', () => {
    const tasks = dryRun(['run', 'generate-references', '--filter=posthog-node'])
    const id = 'posthog-node#generate-references'
    assert.ok(prerequisites(tasks, id).has('posthog-node#build'))
    assert.doesNotMatch(tasks.find((task) => task.taskId === id).command, /pnpm build/)
})
