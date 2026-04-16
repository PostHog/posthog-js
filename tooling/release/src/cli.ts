type Command = 'prepare-version-pointers' | 'upload-s3' | 'write-kv'

function getUsage(): string {
    return [
        'Usage:',
        '  node tooling/release/src/cli.ts prepare-version-pointers <version> <canonical-bucket> <output-dir>',
        '  node tooling/release/src/cli.ts upload-s3 <bucket> <version> <versions-path> <manifest-path>',
        '  node tooling/release/src/cli.ts write-kv <manifest-path>',
    ].join('\n')
}

async function main(): Promise<void> {
    const [command, ...args] = process.argv.slice(2) as [Command | undefined, ...string[]]

    switch (command) {
        case 'prepare-version-pointers': {
            const [version, canonicalBucket, outputDir] = args
            if (!version || !canonicalBucket || !outputDir) {
                throw new Error(
                    `prepare-version-pointers requires <version> <canonical-bucket> <output-dir>\n\n${getUsage()}`
                )
            }
            const { prepareVersionPointers } = await import('./prepare-version-pointers.ts')
            await prepareVersionPointers(version, canonicalBucket, outputDir)
            return
        }
        case 'upload-s3': {
            const [bucket, version, versionsPath, manifestPath] = args
            if (!bucket || !version || !versionsPath || !manifestPath) {
                throw new Error(`upload-s3 requires <bucket> <version> <versions-path> <manifest-path>\n\n${getUsage()}`)
            }
            const { uploadPostHogJsS3 } = await import('./upload-posthog-js-s3.ts')
            await uploadPostHogJsS3(bucket, version, versionsPath, manifestPath)
            return
        }
        case 'write-kv': {
            const [manifestPath] = args
            if (!manifestPath) {
                throw new Error(`write-kv requires <manifest-path>\n\n${getUsage()}`)
            }
            const { writeCloudflareManifestKv } = await import('./write-cloudflare-manifest-kv.ts')
            await writeCloudflareManifestKv(manifestPath)
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
