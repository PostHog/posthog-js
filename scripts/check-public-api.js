const { execFileSync } = require('child_process')

const referencePaths = ['packages/browser/references', 'packages/node/references', 'packages/react-native/references']

let status
try {
    status = execFileSync('git', ['status', '--porcelain', '--', ...referencePaths], { encoding: 'utf8' }).trim()
} catch (error) {
    console.error('Failed to check public API references:', error.message)
    process.exit(1)
}

if (status) {
    console.error('Public API references are out of date. Run `pnpm generate-references` and commit the updated files.')
    console.error(status)
    process.exit(1)
}

console.log('Public API references are up to date.')
