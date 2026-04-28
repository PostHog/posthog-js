import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { parseSemver } from './release-utils.ts'
import { putS3ObjectFromFile, s3ObjectExists } from './s3.ts'

const require = createRequire(import.meta.url)
const mimeTypes = require('mime-types') as {
    lookup(filePath: string): string | false
}

const IMMUTABLE_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const MUTABLE_ALIAS_CACHE_CONTROL = 'public, max-age=300'
const COMPATIBILITY_VERSION_NAMESPACE_COLLISION_PATH = /^\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.]+)?(?:\/|$)/
const DIST_DIR = path.resolve('packages/browser/dist')

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

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath)
        return true
    } catch {
        return false
    }
}

async function listFilesRecursively(root: string): Promise<string[]> {
    const entries = await fs.readdir(root, { withFileTypes: true })
    const files = await Promise.all(
        entries.map(async (entry) => {
            const fullPath = path.join(root, entry.name)
            if (entry.isDirectory()) {
                return await listFilesRecursively(fullPath)
            }
            return [fullPath]
        })
    )

    return files.flat()
}

async function collectReleaseAssets(): Promise<ReleaseAsset[]> {
    const distEntries = await fs.readdir(DIST_DIR)
    const assets: ReleaseAsset[] = distEntries
        .filter((name) => name.endsWith('.js'))
        .map((entry) => ({
            relativeKey: entry,
            filePath: path.join(DIST_DIR, entry),
            contentType: 'application/javascript',
        }))

    const toolbarCssPath = path.join(DIST_DIR, 'toolbar.css')
    if (await fileExists(toolbarCssPath)) {
        assets.push({
            relativeKey: 'toolbar.css',
            filePath: toolbarCssPath,
            contentType: 'text/css',
        })
    }

    const assetsDir = path.join(DIST_DIR, 'assets')
    if (await fileExists(assetsDir)) {
        const files = await listFilesRecursively(assetsDir)
        assets.push(
            ...files.map((filePath) => ({
                relativeKey: `assets/${path.relative(assetsDir, filePath).replaceAll(path.sep, '/')}`,
                filePath,
                contentType: inferContentType(filePath),
            }))
        )
    }

    return assets
}

function getAssetKey(prefix: string, asset: ReleaseAsset): string {
    return `${prefix}${asset.relativeKey}`
}

export function assertNoCompatibilityVersionNamespaceCollisions(assets: ReleaseAsset[]): void {
    for (const asset of assets) {
        if (COMPATIBILITY_VERSION_NAMESPACE_COLLISION_PATH.test(asset.relativeKey)) {
            throw new Error(
                `Compatibility asset path '${asset.relativeKey}' would collide with a reserved version namespace under /static/`
            )
        }
    }
}

export function buildAssetUploadPlans(
    version: string,
    assets: ReleaseAsset[]
): {
    immutable: PlannedAssetUpload[]
    majorAlias: PlannedAssetUpload[]
    compatibility: PlannedAssetUpload[]
} {
    const parsedVersion = parseSemver(version)
    if (!parsedVersion) {
        throw new Error(`Invalid version format: '${version}'`)
    }

    const versionPrefix = `static/${version}/`
    const majorPrefix = `static/${parsedVersion.major}/`
    const compatibilityPrefix = 'static/'
    const shouldPublishMutableAliases = !parsedVersion.prerelease

    assertNoCompatibilityVersionNamespaceCollisions(assets)

    return {
        immutable: assets.map((asset) => ({
            key: getAssetKey(versionPrefix, asset),
            filePath: asset.filePath,
            contentType: asset.contentType,
            cacheControl: IMMUTABLE_ASSET_CACHE_CONTROL,
        })),
        majorAlias: shouldPublishMutableAliases
            ? assets.map((asset) => ({
                  key: getAssetKey(majorPrefix, asset),
                  filePath: asset.filePath,
                  contentType: asset.contentType,
                  cacheControl: MUTABLE_ALIAS_CACHE_CONTROL,
              }))
            : [],
        compatibility: shouldPublishMutableAliases
            ? assets.map((asset) => ({
                  key: getAssetKey(compatibilityPrefix, asset),
                  filePath: asset.filePath,
                  contentType: asset.contentType,
                  cacheControl: MUTABLE_ALIAS_CACHE_CONTROL,
              }))
            : [],
    }
}

async function uploadReleaseAssets(bucket: string, uploads: PlannedAssetUpload[], label: string): Promise<string[]> {
    if (uploads.length === 0) {
        return []
    }

    console.log(`==> Uploading ${label} to s3://${bucket}`)

    await Promise.all(
        uploads.map((upload) =>
            putS3ObjectFromFile(bucket, upload.key, upload.filePath, {
                cacheControl: upload.cacheControl,
                contentType: upload.contentType,
            })
        )
    )

    return uploads.map((upload) => upload.key)
}

async function verifyUploadedObject(bucket: string, key: string): Promise<void> {
    if (!(await s3ObjectExists(bucket, key))) {
        throw new Error(`Expected uploaded object s3://${bucket}/${key} to exist`)
    }
}

async function verifyUploadedAssets(bucket: string, keys: string[], label: string): Promise<void> {
    console.log(`==> Verifying ${label} exist in s3://${bucket}`)
    await Promise.all(keys.map((key) => verifyUploadedObject(bucket, key)))
}

export async function uploadPostHogJsS3(bucket: string, version: string): Promise<void> {
    const parsedVersion = parseSemver(version)
    if (!parsedVersion) {
        throw new Error(`Invalid version format: '${version}'`)
    }

    const assets = await collectReleaseAssets()
    const uploadPlans = buildAssetUploadPlans(version, assets)

    console.log(`==> Uploading posthog-js v${version}`)
    console.log(`    immutable prefix: s3://${bucket}/static/${version}/`)
    if (parsedVersion.prerelease) {
        console.log('    mutable aliases: skipped for prerelease publish')
    } else {
        console.log(`    major alias prefix: s3://${bucket}/static/${parsedVersion.major}/`)
        console.log(`    compatibility prefix: s3://${bucket}/static/`)
    }

    const immutableKeys = await uploadReleaseAssets(bucket, uploadPlans.immutable, 'immutable release assets')
    await verifyUploadedAssets(bucket, immutableKeys, 'immutable assets')

    const majorAliasKeys = await uploadReleaseAssets(bucket, uploadPlans.majorAlias, 'major-version alias assets')
    await verifyUploadedAssets(bucket, majorAliasKeys, 'major-version alias assets')

    const compatibilityKeys = await uploadReleaseAssets(
        bucket,
        uploadPlans.compatibility,
        'top-level compatibility assets'
    )
    await verifyUploadedAssets(bucket, compatibilityKeys, 'top-level compatibility assets')

    console.log(
        `==> Finished publishing immutable, major-version alias, and top-level compatibility assets for v${version}`
    )
}
