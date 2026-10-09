import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { parseSemver } from './release-utils.ts'
import { putS3ObjectFromFile, s3ObjectMatchesFile } from './s3.ts'
import { mapConcurrent } from './concurrency.ts'

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

export async function collectReleaseAssets(distDir = DIST_DIR): Promise<ReleaseAsset[]> {
    const distEntries = (await fs.readdir(distDir)).sort()
    const assets: ReleaseAsset[] = distEntries
        .filter((name) => name.endsWith('.js') || name.endsWith('.js.map'))
        .map((entry) => ({
            relativeKey: entry,
            filePath: path.join(distDir, entry),
            contentType: entry.endsWith('.js.map') ? 'application/json' : 'application/javascript',
        }))

    const toolbarCssPath = path.join(distDir, 'toolbar.css')
    if (await fileExists(toolbarCssPath)) {
        assets.push({
            relativeKey: 'toolbar.css',
            filePath: toolbarCssPath,
            contentType: 'text/css',
        })
    }

    const assetsDir = path.join(distDir, 'assets')
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

    // The toolbar is moving from a single-file IIFE to a code-split ESM
    // bundle: `toolbar.js` becomes a small loader that dynamic-import()s
    // content-hashed chunks from a sibling `toolbar/` directory, resolved
    // relative to the loader's own URL. Publish that directory whenever the
    // build emits it — a loader without its chunks is a broken toolbar for
    // strict_script_versioning users. No-op while posthog/posthog still
    // produces the single-file build.
    const toolbarDir = path.join(distDir, 'toolbar')
    if (await fileExists(toolbarDir)) {
        const files = (await listFilesRecursively(toolbarDir)).sort()
        assets.push(
            ...files.map((filePath) => ({
                relativeKey: `toolbar/${path.relative(toolbarDir, filePath).replaceAll(path.sep, '/')}`,
                filePath,
                contentType: filePath.endsWith('.js.map')
                    ? 'application/json'
                    : filePath.endsWith('.js')
                      ? 'application/javascript'
                      : inferContentType(filePath),
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
    assets: ReleaseAsset[],
    publishMutableAliases = true
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
    const shouldPublishMutableAliases = publishMutableAliases && !parsedVersion.prerelease

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

async function uploadReleaseAssets(
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

async function verifyUploadedAssets(bucket: string, uploads: PlannedAssetUpload[], label: string): Promise<void> {
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

export async function uploadPostHogJsS3(
    bucket: string,
    version: string,
    options: { publishMutableAliases?: boolean; forceOverwrite?: boolean; aliasesOnly?: boolean } = {}
): Promise<void> {
    const parsedVersion = parseSemver(version)
    if (!parsedVersion) {
        throw new Error(`Invalid version format: '${version}'`)
    }

    const assets = await collectReleaseAssets()
    if (assets.length === 0) throw new Error('No release assets found')
    const publishMutableAliases = options.publishMutableAliases ?? true
    const forceOverwrite = options.forceOverwrite ?? false
    if (options.aliasesOnly && (!publishMutableAliases || forceOverwrite)) {
        throw new Error('Alias promotion cannot upload or overwrite immutable assets')
    }
    const uploadPlans = buildAssetUploadPlans(version, assets, publishMutableAliases)

    if (!options.aliasesOnly) {
        await assertCanUploadImmutableAssets(bucket, uploadPlans.immutable, forceOverwrite)
    }

    console.log(`==> Uploading posthog-js v${version}`)
    console.log(`    immutable prefix: s3://${bucket}/static/${version}/`)
    if (!publishMutableAliases) {
        console.log('    mutable aliases: skipped by request')
    } else if (parsedVersion.prerelease) {
        console.log('    mutable aliases: skipped for prerelease publish')
    } else {
        console.log(`    major alias prefix: s3://${bucket}/static/${parsedVersion.major}/`)
        console.log(`    compatibility prefix: s3://${bucket}/static/`)
    }

    if (!options.aliasesOnly) {
        await uploadReleaseAssets(bucket, uploadPlans.immutable, 'immutable release assets', {
            ifNoneMatch: forceOverwrite ? undefined : '*',
        })
    }
    // Alias-only jobs consume the exact same artifacts, after the workflow's
    // cross-region barrier. Recheck locally before exposing any mutable alias.
    await verifyUploadedAssets(bucket, uploadPlans.immutable, 'immutable assets')

    await uploadReleaseAssets(bucket, uploadPlans.majorAlias, 'major-version alias assets')
    await verifyUploadedAssets(bucket, uploadPlans.majorAlias, 'major-version alias assets')

    await uploadReleaseAssets(bucket, uploadPlans.compatibility, 'top-level compatibility assets')
    await verifyUploadedAssets(bucket, uploadPlans.compatibility, 'top-level compatibility assets')

    if (uploadPlans.majorAlias.length > 0 || uploadPlans.compatibility.length > 0) {
        console.log(
            `==> Finished publishing immutable, major-version alias, and top-level compatibility assets for v${version}`
        )
    } else {
        console.log(`==> Finished publishing immutable assets for v${version}`)
    }
}
