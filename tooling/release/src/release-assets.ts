import { createRequire } from 'node:module'
import { putS3ObjectFromFile, s3ObjectMatchesFile } from './s3.ts'
import { mapConcurrent } from './concurrency.ts'

const require = createRequire(import.meta.url)
const mimeTypes = require('mime-types') as {
    lookup(filePath: string): string | false
}

export const IMMUTABLE_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export const MUTABLE_ALIAS_CACHE_CONTROL = 'public, max-age=300'

export type ReleaseAsset = {
    relativeKey: string
    filePath: string
    contentType?: string
}

export type PlannedAssetUpload = {
    key: string
    filePath: string
    contentType?: string
    cacheControl: string
}

export function inferContentType(filePath: string): string | undefined {
    const inferred = mimeTypes.lookup(filePath)
    return inferred || undefined
}

export async function uploadReleaseAssets(
    bucket: string,
    uploads: PlannedAssetUpload[],
    label: string,
    options: { ifNoneMatch?: string } = {}
): Promise<void> {
    if (uploads.length === 0) {
        return
    }

    console.log(`==> Uploading ${label} to s3://${bucket}`)

    await mapConcurrent(uploads, (upload) =>
        putS3ObjectFromFile(bucket, upload.key, upload.filePath, {
            cacheControl: upload.cacheControl,
            contentType: upload.contentType,
            ifNoneMatch: options.ifNoneMatch,
        })
    )
}

async function matchesUploadedAsset(bucket: string, upload: PlannedAssetUpload): Promise<boolean> {
    return s3ObjectMatchesFile(bucket, upload.key, upload.filePath, upload)
}

export async function verifyUploadedAssets(
    bucket: string,
    uploads: PlannedAssetUpload[],
    label: string
): Promise<void> {
    console.log(`==> Verifying ${label} bytes and metadata in s3://${bucket}`)
    await mapConcurrent(uploads, async (upload) => {
        if (!(await matchesUploadedAsset(bucket, upload))) {
            throw new Error(`Expected uploaded object s3://${bucket}/${upload.key} to exist`)
        }
    })
}

export async function assertCanUploadImmutableAssets(
    bucket: string,
    uploads: PlannedAssetUpload[],
    forceOverwrite: boolean,
    matchesExisting: (bucket: string, upload: PlannedAssetUpload) => Promise<boolean> = matchesUploadedAsset
): Promise<void> {
    if (forceOverwrite) {
        return
    }

    // Check the whole immutable set before writing anything. Missing or identical
    // objects are safe to resume; mismatches and lookup failures throw.
    await mapConcurrent(uploads, (upload) => matchesExisting(bucket, upload))
}
