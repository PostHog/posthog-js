/* oxlint-disable compat/compat, posthog-js/no-direct-null-check, posthog-js/no-direct-undefined-check -- This Node-only policy test runs without building SDK helpers. */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../../', import.meta.url))
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
})
    .split('\0')
    .filter(Boolean)
const fileSet = new Set(files)

function supportsCooldown(packageManager) {
    const match = /^pnpm@(\d+)\.(\d+)\.(\d+)(?:\+sha\d+\..+)?$/.exec(packageManager ?? '')
    return match !== null && (Number(match[1]) > 10 || (Number(match[1]) === 10 && Number(match[2]) >= 16))
}

async function manifest(file) {
    return JSON.parse(await readFile(path.join(root, file), 'utf8'))
}

test('every pnpm workspace explicitly configures a seven-day cooldown and a supported package manager', async () => {
    const problems = []
    for (const file of files.filter((file) => path.basename(file) === 'pnpm-workspace.yaml')) {
        const config = await readFile(path.join(root, file), 'utf8')
        if (!/^minimumReleaseAge: 10080\s*(?:#.*)?$/m.test(config)) problems.push(`${file}: missing seven-day cooldown`)
        const packageFile = path.join(path.dirname(file), 'package.json')
        if (!fileSet.has(packageFile) || !supportsCooldown((await manifest(packageFile)).packageManager)) {
            problems.push(`${packageFile}: missing supported pnpm pin`)
        }
    }
    assert.deepEqual(problems, [])
})

test('nested package-manager pins cannot select a pnpm version without cooldown support', async () => {
    const problems = []
    for (const file of files.filter((file) => path.basename(file) === 'package.json')) {
        const { packageManager } = await manifest(file)
        if (packageManager !== undefined && !supportsCooldown(packageManager))
            problems.push(`${file}: ${packageManager}`)
    }
    assert.deepEqual(problems, [])
})

test('independent pnpm installs have their own workspace policy', () => {
    const missing = files
        .filter((file) => path.basename(file) === 'pnpm-lock.yaml')
        .map((file) => path.join(path.dirname(file), 'pnpm-workspace.yaml'))
        .filter((file) => !fileSet.has(file))
    assert.deepEqual(missing, [])
})

test('pnpm hooks do not weaken the seven-day workspace policy', () => {
    const require = createRequire(import.meta.url)
    for (const file of files.filter((file) => path.basename(file) === '.pnpmfile.cjs')) {
        const { hooks } = require(path.join(root, file))
        const config = { minimumReleaseAge: 10080 }
        assert.equal(hooks.updateConfig?.(config).minimumReleaseAge ?? config.minimumReleaseAge, 10080, file)
    }
})

test('native example CI does not bypass its workspace policy', async () => {
    const workflow = await readFile(path.join(root, '.github/workflows/react-native-plugin-native-ci.yml'), 'utf8')
    assert.doesNotMatch(workflow, /run: pnpm install[^\n]*--ignore-workspace/)
})

test('pnpm rejects a six-day-old version and resolves an eight-day-old version', { timeout: 30000 }, async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'posthog-cooldown-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const packageName = 'posthog-cooldown-test'
    const server = createServer((request, response) => {
        if (request.url !== `/${packageName}`) {
            response.writeHead(404).end()
            return
        }
        const url = `http://127.0.0.1:${server.address().port}`
        response.setHeader('Content-Type', 'application/json')
        response.end(
            JSON.stringify({
                name: packageName,
                'dist-tags': { latest: '1.0.1' },
                versions: Object.fromEntries(
                    ['1.0.0', '1.0.1'].map((version) => [
                        version,
                        {
                            name: packageName,
                            version,
                            dist: { tarball: `${url}/${packageName}/-/${packageName}-${version}.tgz` },
                        },
                    ])
                ),
                time: {
                    '1.0.0': new Date(Date.now() - 8 * 86400000).toISOString(),
                    '1.0.1': new Date(Date.now() - 6 * 86400000).toISOString(),
                },
            })
        )
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise((resolve) => server.close(resolve)))
    const registry = `http://127.0.0.1:${server.address().port}`
    const userConfig = path.join(directory, '.npmrc')
    await writeFile(userConfig, '')
    const pnpmScript = process.env.npm_execpath
    const command = pnpmScript?.includes('pnpm') ? process.execPath : 'pnpm'
    const prefix = pnpmScript?.includes('pnpm') ? [pnpmScript] : []

    async function install(name, version) {
        const cwd = path.join(directory, name)
        await mkdir(cwd)
        await writeFile(
            path.join(cwd, 'package.json'),
            JSON.stringify({ private: true, dependencies: { [packageName]: version } })
        )
        await writeFile(path.join(cwd, 'pnpm-workspace.yaml'), 'packages: []\nminimumReleaseAge: 10080\n')
        const result = await new Promise((resolve, reject) => {
            const child = spawn(
                command,
                [...prefix, 'install', '--lockfile-only', '--ignore-scripts', '--registry', registry],
                {
                    cwd,
                    env: {
                        PATH: process.env.PATH,
                        HOME: directory,
                        CI: 'true',
                        npm_config_userconfig: userConfig,
                        npm_config_store_dir: path.join(directory, 'store'),
                        npm_config_cache_dir: path.join(directory, 'cache'),
                        npm_config_state_dir: path.join(directory, 'state'),
                        npm_config_update_notifier: 'false',
                        COREPACK_ENABLE_NETWORK: '0',
                    },
                    stdio: ['ignore', 'pipe', 'pipe'],
                }
            )
            let output = ''
            child.stdout.on('data', (data) => {
                output += data
            })
            child.stderr.on('data', (data) => {
                output += data
            })
            child.on('error', reject)
            child.on('close', (status) => resolve({ status, output }))
            t.after(() => child.kill())
        })
        return { ...result, cwd }
    }

    const rejected = await install('exact', '1.0.1')
    assert.notEqual(rejected.status, 0, rejected.output)
    assert.match(rejected.output, /release|published|ERR_PNPM_NO_MATCHING_VERSION/i)

    const accepted = await install('range', '^1.0.0')
    assert.equal(accepted.status, 0, accepted.output)
    const lockfile = await readFile(path.join(accepted.cwd, 'pnpm-lock.yaml'), 'utf8')
    assert.match(lockfile, /version: 1\.0\.0/)
    assert.doesNotMatch(lockfile, /version: 1\.0\.1/)
})
