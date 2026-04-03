// TypeScript copies package.json into lib/ (due to resolveJsonModule + the import in src/config.ts).
// The copy retains unresolved workspace:* references which break npm audit fix for consumers.
// This script strips dependencies and devDependencies from the build artifact.
// See: https://github.com/PostHog/posthog-js/issues/3290

const fs = require('fs')
const path = require('path')

const filePath = path.resolve(__dirname, '..', 'lib', 'package.json')

if (!fs.existsSync(filePath)) {
    console.warn('warn: lib/package.json no longer exists — this postbuild script can be removed')
    process.exit(0)
}

const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'))
delete pkg.dependencies
delete pkg.devDependencies
fs.writeFileSync(filePath, JSON.stringify(pkg, null, 4) + '\n')
