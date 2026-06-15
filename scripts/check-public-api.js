const { execFileSync } = require('child_process')

const referencePaths = ['packages/browser/references', 'packages/node/references', 'packages/react-native/references']

const status = execFileSync('git', ['status', '--porcelain', '--', ...referencePaths], { encoding: 'utf8' }).trim()

if (status) {
    console.error('Public API references are out of date. Run `pnpm generate-references` and commit the updated files.')
    console.error(status)
    process.exit(1)
}

console.log('Public API references are up to date.')
