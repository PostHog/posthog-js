const { execFileSync } = require('child_process')

const referencePaths = [
    'packages/browser/references/posthog-js-references-latest.json',
    'packages/node/references/posthog-node-references-latest.json',
    'packages/react-native/references/posthog-react-native-references-latest.json',
]

let status
try {
    status = execFileSync('git', ['status', '--porcelain', '--', ...referencePaths], { encoding: 'utf8' }).trim()
} catch (error) {
    console.error('Failed to check public API references:', error.message)
    process.exit(1)
}

if (status) {
    console.error('Public API references are out of date. Run `pnpm generate-references` and commit the updated latest reference files.')
    console.error(status)

    try {
        const trackedDiff = execFileSync(
            'git',
            ['diff', '--no-ext-diff', '--no-color', 'HEAD', '--', ...referencePaths],
            {
                encoding: 'utf8',
            }
        ).trim()
        const untrackedDiffs = status
            .split('\n')
            .filter((line) => line.startsWith('?? '))
            .map((line) => line.slice(3))
            .map((path) => {
                try {
                    return execFileSync(
                        'git',
                        ['diff', '--no-ext-diff', '--no-color', '--no-index', '--', '/dev/null', path],
                        {
                            encoding: 'utf8',
                        }
                    ).trim()
                } catch (error) {
                    if (error.status === 1 && error.stdout) {
                        return error.stdout.trim()
                    }
                    throw error
                }
            })
        const diff = [trackedDiff, ...untrackedDiffs].filter(Boolean).join('\n\n')
        if (diff) {
            console.error(`\nPublic API reference diff:\n${diff}`)
        }
    } catch (error) {
        console.error('Failed to print public API reference diff:', error.message)
    }

    process.exit(1)
}

console.log('Public API references are up to date.')
