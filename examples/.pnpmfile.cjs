/** @type {import('pnpm').Hooks} */
// Overrides posthog dependencies to local versions
module.exports = {
    hooks: {
        readPackage(pkg) {
            function rewriteLocalDeps(deps) {
                if (deps) {
                    for (const dep in deps) {
                        if (['@posthog/cli', 'posthog-react-native-session-replay'].includes(dep)) {
                            continue
                        }
                        if (dep.startsWith('posthog') || dep.startsWith('@posthog')) {
                            const tarballName = dep.replace('@', '').replace('/', '-')
                            deps[dep] = `file:../../target/${tarballName}.tgz`
                        }
                    }
                }
            }

            rewriteLocalDeps(pkg.dependencies)
            rewriteLocalDeps(pkg.devDependencies)
            rewriteLocalDeps(pkg.optionalDependencies)

            return pkg
        },
        updateConfig(config) {
            return Object.assign(config, {
                lockfile: false,
                packages: ['.'],
                preferFrozenLockfile: false,
                verifyDepsBeforeRun: true,
            })
        },
    },
}
