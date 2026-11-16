type Command = 'upload-s3' | 'upload-browser-s3'

function getUsage(): string {
    return [
        'Usage:',
        '  node tooling/release/src/cli.ts upload-s3 <bucket> <version> [--immutable-only | --aliases-only] [--force-overwrite]',
        '  node tooling/release/src/cli.ts upload-browser-s3 <bucket> <version> (--immutable-only | --aliases-only)',
    ].join('\n')
}

async function main(): Promise<void> {
    const [command, ...args] = process.argv.slice(2) as [Command | undefined, ...string[]]

    switch (command) {
        case 'upload-browser-s3': {
            const [bucket, version, phase, ...extra] = args
            if (!bucket || !version || extra.length || !['--immutable-only', '--aliases-only'].includes(phase)) {
                throw new Error(`Invalid upload-browser-s3 arguments\n\n${getUsage()}`)
            }
            const { uploadBrowserS3 } = await import('./upload-browser-s3.ts')
            await uploadBrowserS3(bucket, version, phase === '--immutable-only' ? 'immutable' : 'aliases')
            return
        }
        case 'upload-s3': {
            const [bucket, version, ...options] = args
            if (!bucket || !version) {
                throw new Error(`upload-s3 requires <bucket> <version>\n\n${getUsage()}`)
            }
            const supportedOptions = new Set(['--immutable-only', '--aliases-only', '--force-overwrite'])
            if (
                options.some((option) => !supportedOptions.has(option)) ||
                new Set(options).size !== options.length ||
                (options.includes('--aliases-only') &&
                    (options.includes('--immutable-only') || options.includes('--force-overwrite')))
            ) {
                throw new Error(`Invalid upload-s3 option\n\n${getUsage()}`)
            }
            const { uploadPostHogJsS3 } = await import('./upload-posthog-js-s3.ts')
            await uploadPostHogJsS3(bucket, version, {
                publishMutableAliases: !options.includes('--immutable-only'),
                forceOverwrite: options.includes('--force-overwrite'),
                aliasesOnly: options.includes('--aliases-only'),
            })
            return
        }
        default:
            throw new Error(getUsage())
    }
}

void main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
})
