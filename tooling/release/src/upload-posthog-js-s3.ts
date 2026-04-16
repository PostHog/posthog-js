import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { assertFlatStringMap, assertVersionEntries, parseSemver, readJsonFile } from './release-utils.ts'
import { listS3Keys, putS3ObjectFromFile, s3ObjectExists, tagS3ObjectPublic } from './s3.ts'

const require = createRequire(import.meta.url)
const mimeTypes = require('mime-types') as {
    lookup(filePath: string): string | false
}

const MANIFEST_CACHE_CONTROL = 'public, max-age=60'
const IMMUTABLE_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const COMPATIBILITY_ASSET_CACHE_CONTROL = 'public, max-age=300'
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

async function tagS3Objects(bucket: string, prefix: string): Promise<void> {
    console.log(`==> Tagging objects under s3://${bucket}/${prefix} with public=true`)
    const keys = await listS3Keys(bucket, prefix)
    await Promise.all(keys.map((key) => tagS3ObjectPublic(bucket, key)))
}

async function tagS3Keys(bucket: string, keys: string[]): Promise<void> {
    if (keys.length === 0) {
        return
    }

    console.log(`==> Tagging ${keys.length} uploaded object(s) in s3://${bucket} with public=true`)
    await Promise.all(keys.map((key) => tagS3ObjectPublic(bucket, key)))
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

export function buildAssetUploadPlans(version: string, assets: ReleaseAsset[]): {
    immutable: PlannedAssetUpload[]
    compatibility: PlannedAssetUpload[]
} {
    const versionPrefix = `static/${version}/`
    const compatibilityPrefix = 'static/'

    assertNoCompatibilityVersionNamespaceCollisions(assets)

    return {
        immutable: assets.map((asset) => ({
            key: getAssetKey(versionPrefix, asset),
            filePath: asset.filePath,
            contentType: asset.contentType,
            cacheControl: IMMUTABLE_ASSET_CACHE_CONTROL,
        })),
        compatibility: assets.map((asset) => ({
            key: getAssetKey(compatibilityPrefix, asset),
            filePath: asset.filePath,
            contentType: asset.contentType,
            cacheControl: COMPATIBILITY_ASSET_CACHE_CONTROL,
        })),
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
    for (const key of keys) {
        await verifyUploadedObject(bucket, key)
    }
}

async function uploadVersionsFile(bucket: string, filePath: string): Promise<void> {
    await putS3ObjectFromFile(bucket, 'versions.json', filePath, { contentType: 'application/json' })
}

async function uploadManifest(bucket: string, manifestPath: string): Promise<void> {
    console.log(`==> Uploading manifest.json to s3://${bucket}/manifest.json`)
    await putS3ObjectFromFile(bucket, 'manifest.json', manifestPath, {
        cacheControl: MANIFEST_CACHE_CONTROL,
        contentType: 'application/json',
    })
    await tagS3ObjectPublic(bucket, 'manifest.json')
}

export async function uploadPostHogJsS3(
    bucket: string,
    version: string,
    versionsPath: string,
    manifestPath: string
): Promise<void> {
    if (!parseSemver(version)) {
        throw new Error(`Invalid version format: '${version}'`)
    }

    const versionPrefix = `static/${version}/`
    const assets = await collectReleaseAssets()
    const uploadPlans = buildAssetUploadPlans(version, assets)

    console.log(`==> Uploading posthog-js v${version}`)
    console.log(`    immutable prefix: s3://${bucket}/static/${version}/`)
    console.log(`    compatibility prefix: s3://${bucket}/static/`)

    const immutableKeys = await uploadReleaseAssets(bucket, uploadPlans.immutable, 'immutable release assets')
    const compatibilityKeys = await uploadReleaseAssets(
        bucket,
        uploadPlans.compatibility,
        'top-level compatibility assets'
    )

    await tagS3Objects(bucket, versionPrefix)
    await tagS3Keys(bucket, compatibilityKeys)
    await verifyUploadedAssets(bucket, immutableKeys, 'immutable assets')
    await verifyUploadedAssets(bucket, compatibilityKeys, 'top-level compatibility assets')

    assertVersionEntries(await readJsonFile<unknown>(versionsPath), versionsPath)
    const manifest = assertFlatStringMap(await readJsonFile<unknown>(manifestPath), manifestPath)

    console.log(`==> Replicating canonical versions.json to s3://${bucket}/versions.json`)
    await uploadVersionsFile(bucket, versionsPath)
    console.log(`==> Replicating canonical manifest.json: ${JSON.stringify(manifest)}`)
    await uploadManifest(bucket, manifestPath)

    console.log(`==> Finished publishing immutable assets, top-level compatibility assets, and canonical pointers for v${version}`)
}
