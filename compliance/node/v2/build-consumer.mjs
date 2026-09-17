// Runs inside the isolated build stage, never in the selected checkout.
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { packageMetadata } from './package-metadata.mjs'

const root = '/output/consumer'
mkdirSync(root, { recursive: true })
const dependencies = {
    'posthog-node': 'file:../tarballs/posthog-node.tgz',
    '@posthog/core': 'file:../tarballs/core.tgz',
    '@posthog/types': 'file:../tarballs/types.tgz',
}
writeFileSync(`${root}/package.json`, JSON.stringify({
    private: true, dependencies,
    overrides: { '@posthog/core': '$@posthog/core', '@posthog/types': '$@posthog/types' },
}, null, 2))
execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit' })
execFileSync('npm', ['ls', '--all'], { cwd: root, stdio: 'inherit' })
const require = createRequire(`${root}/package.json`)
const sdkRequire = createRequire(require.resolve('posthog-node'))
const coreEntry = realpathSync(require.resolve('@posthog/core'))
if (realpathSync(sdkRequire.resolve('@posthog/core')) !== coreEntry) throw new Error('SDK resolves a different core')
const installed = Object.keys(dependencies).map(name => {
    const metadata = packageMetadata(require, name)
    const source = JSON.parse(readFileSync(`/source/packages/${name === 'posthog-node' ? 'node' : name.split('/')[1]}/package.json`))
    if (metadata.version !== source.version) throw new Error('Installed version differs from source')
    return metadata
})
const lock = JSON.parse(readFileSync(`${root}/package-lock.json`))
for (const name of Object.keys(dependencies)) {
    if (lock.packages[`node_modules/${name}`].resolved !== dependencies[name]) {
        throw new Error('Installed dependency was not resolved from its fresh tarball')
    }
}
writeFileSync('/output/installed.json', JSON.stringify({
    installed, sdk_resolves_consumer_core: true, core_entry: coreEntry,
    node_version: process.version, platform: process.platform, arch: process.arch,
}, null, 2))
