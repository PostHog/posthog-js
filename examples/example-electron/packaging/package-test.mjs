import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const directory = fileURLToPath(new URL('.', import.meta.url))
const example = fileURLToPath(new URL('../', import.meta.url))
const tool = process.argv[2]
assert.ok(['forge', 'builder'].includes(tool), 'choose forge or builder')
const electronVersion = require('electron/package.json').version
const source = join(directory, 'dist', 'app')
const output = join(directory, 'dist', tool)
await rm(source, { recursive: true, force: true })
await rm(output, { recursive: true, force: true })
await mkdir(source, { recursive: true })
for (const name of [
    'main.mjs',
    'index.html',
    'styles.css',
    'mock-server.mjs',
    'smoke-driver.mjs',
    'fixtures',
    'dist',
]) {
    await cp(join(example, name), join(source, name), { recursive: true })
}

// Both packagers must resolve and copy the installed SDK and its production dependencies.
// Do not copy SDK files manually: that would bypass the consumer packager's dependency collector.
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
let binary
if (tool === 'forge') {
    const { api: forge } = await import('@electron-forge/core')
    const packages = await forge.package({ dir: directory, outDir: output, interactive: false })
    assert.equal(packages.length, 1)
    const root = packages[0].packagedPath
    binary =
        process.platform === 'darwin'
            ? join(root, 'PostHogFixture.app', 'Contents', 'MacOS', 'PostHogFixture')
            : join(root, process.platform === 'win32' ? 'PostHogFixture.exe' : 'PostHogFixture')
} else {
    const { build, Platform } = await import('electron-builder')
    await build({
        projectDir: directory,
        targets: Platform.current().createTarget('dir'),
        config: {
            appId: 'com.posthog.packaging.fixture',
            productName: 'PostHogFixture',
            electronVersion,
            asar: true,
            npmRebuild: false,
            directories: { output },
            files: ['dist/app/**', 'package.json'],
            mac: { identity: null },
            win: { signAndEditExecutable: false },
            linux: { executableName: 'PostHogFixture', category: 'Development' },
        },
    })
    const platformOutput =
        process.platform === 'darwin'
            ? `mac${process.arch === 'arm64' ? '-arm64' : ''}`
            : process.platform === 'win32'
              ? `win${process.arch === 'arm64' ? '-arm64' : ''}-unpacked`
              : `linux${process.arch === 'arm64' ? '-arm64' : ''}-unpacked`
    const root = join(output, platformOutput)
    binary =
        process.platform === 'darwin'
            ? join(root, 'PostHogFixture.app', 'Contents', 'MacOS', 'PostHogFixture')
            : join(root, process.platform === 'win32' ? 'PostHogFixture.exe' : 'PostHogFixture')
}
const executable = await stat(binary)
assert.ok(executable.isFile() && executable.size > 0, 'packager must produce a native executable')
await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(directory, 'package-isolation.test.mjs'), binary], {
        cwd: directory,
        stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
        if (code === 0) resolve()
        else reject(new Error(`${tool} dependency isolation failed: code ${code}, signal ${signal}`))
    })
})
console.log(`Running ${tool} packaged consumer with Electron ${electronVersion}: ${binary}`)
await new Promise((resolve, reject) => {
    const child = spawn(
        process.execPath,
        [join(example, 'smoke-test.mjs'), `--packaged=${binary}`, '--fixture=platform'],
        {
            cwd: example,
            stdio: 'inherit',
            env: { ...process.env, ELECTRON_EXAMPLE_PACKAGER: tool },
        }
    )
    child.once('error', reject)
    child.once('close', (code, signal) => {
        if (code === 0) resolve()
        else reject(new Error(`${tool} packaged smoke failed: code ${code}, signal ${signal}`))
    })
})
console.log(`${tool} installed-consumer packaging and runtime assertions passed.`)
