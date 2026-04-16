import path from 'node:path'
import { assertVersionEntries, generateManifestFromVersions, writeJsonFile } from './release-utils.ts'
import { assertS3BucketAccessible, readS3JsonObject } from './s3.ts'

async function loadCanonicalVersions(bucket: string): Promise<ReturnType<typeof assertVersionEntries>> {
    // Distinguish a genuinely new canonical pointer history from a misconfigured
    // release target. Missing `versions.json` in an existing bucket is a valid
    // bootstrap case; a missing/inaccessible bucket must fail hard so we don't
    // silently fork the global version graph from the wrong source.
    await assertS3BucketAccessible(bucket)

    const versions = await readS3JsonObject<unknown>(bucket, 'versions.json')
    if (versions === null) {
        console.log(`No existing versions.json found in s3://${bucket}/, starting fresh`)
        return []
    }

    return assertVersionEntries(versions, `s3://${bucket}/versions.json`)
}

export async function prepareVersionPointers(version: string, canonicalBucket: string, outputDir: string): Promise<void> {
    const versions = await loadCanonicalVersions(canonicalBucket)
    const nextVersions = versions.some((entry) => entry.version === version)
        ? versions
        : [
              ...versions,
              {
                  version,
                  timestamp: new Date().toISOString(),
              },
          ]

    const manifest = generateManifestFromVersions(nextVersions)

    await writeJsonFile(path.join(outputDir, 'versions.json'), nextVersions)
    await writeJsonFile(path.join(outputDir, 'manifest.json'), manifest)

    console.log(`==> Prepared canonical version pointers from s3://${canonicalBucket}/versions.json`)
    console.log(`    versions.json entries: ${nextVersions.length}`)
    console.log(`    manifest.json: ${JSON.stringify(manifest)}`)
}
