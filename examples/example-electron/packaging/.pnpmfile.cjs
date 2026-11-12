const { resolve } = require('node:path')

module.exports = {
    hooks: {
        readPackage(pkg) {
            for (const dependencies of [pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies]) {
                for (const name of Object.keys(dependencies || {})) {
                    if (name.startsWith('@posthog/')) {
                        const tarball = name.replace('@', '').replace('/', '-')
                        dependencies[name] = `file:${resolve(__dirname, '../../../target', `${tarball}.tgz`)}`
                    }
                }
            }
            return pkg
        },
        updateConfig(config) {
            // Reinstall freshly packed SDKs instead of reusing a lockfile from an older build.
            return { ...config, lockfile: false, preferFrozenLockfile: false, minimumReleaseAge: 10080 }
        },
    },
}
