import fs from 'node:fs/promises'
import path from 'node:path'
import { parseSemver } from './release-utils.ts'
import {
    IMMUTABLE_ASSET_CACHE_CONTROL,
    MUTABLE_ALIAS_CACHE_CONTROL,
    inferContentType,
    assertCanUploadImmutableAssets,
    uploadReleaseAssets,
    verifyUploadedAssets,
    type ReleaseAsset,
    type PlannedAssetUpload,
} from './release-assets.ts'

const DIST_DIR = path.resolve('packages/browser-next/dist-cdn')

export async function collectBrowserAssets(distDir = DIST_DIR): Promise<ReleaseAsset[]> {
    const assets: ReleaseAsset[] = []
    async function walk(directory: string): Promise<void> {
        for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) =>
            a.name.localeCompare(b.name)
        )) {
            const filePath = path.join(directory, entry.name)
            if (entry.isDirectory()) {
                await walk(filePath)
            } else if (entry.isFile()) {
                assets.push({
                    relativeKey: path.relative(distDir, filePath).replaceAll(path.sep, '/'),
                    filePath,
                    contentType: filePath.endsWith('.js')
                        ? 'application/javascript'
                        : filePath.endsWith('.map')
                          ? 'application/json'
                          : inferContentType(filePath),
                })
            } else {
                throw new Error(`Unsupported browser CDN asset: ${filePath}`)
            }
        }
    }
    await walk(distDir)
    if (!assets.some((asset) => asset.relativeKey === 'posthog.js')) {
        throw new Error('Browser CDN build must contain posthog.js')
    }
    return assets
}

export function buildBrowserAssetUploadPlans(
    version: string,
    assets: ReleaseAsset[]
): { immutable: PlannedAssetUpload[]; majorAlias: PlannedAssetUpload[] } {
    const parsed = parseSemver(version)
    if (!parsed) throw new Error(`Invalid version format: '${version}'`)
    for (const asset of assets) {
        if (
            !asset.relativeKey ||
            asset.relativeKey.includes('\\') ||
            asset.relativeKey.split('/').some((segment) => !segment || segment === '.' || segment === '..')
        ) {
            throw new Error(`Invalid browser CDN asset path: '${asset.relativeKey}'`)
        }
    }
    const plan = (namespace: string, cacheControl: string): PlannedAssetUpload[] =>
        assets.map(({ relativeKey, ...asset }) => ({
            ...asset,
            key: `static/browser/${namespace}/${relativeKey}`,
            cacheControl,
        }))
    return {
        immutable: plan(version, IMMUTABLE_ASSET_CACHE_CONTROL),
        majorAlias: parsed.prerelease ? [] : plan(String(parsed.major), MUTABLE_ALIAS_CACHE_CONTROL),
    }
}

async function uploadEntryLast(
    bucket: string,
    uploads: PlannedAssetUpload[],
    entryKey: string,
    label: string,
    options: { ifNoneMatch?: string } = {}
): Promise<void> {
    const dependencies = uploads.filter((asset) => asset.key !== entryKey)
    const entry = uploads.filter((asset) => asset.key === entryKey)
    await uploadReleaseAssets(bucket, dependencies, `${label} dependencies`, options)
    await verifyUploadedAssets(bucket, dependencies, `${label} dependencies`)
    await uploadReleaseAssets(bucket, entry, `${label} entry`, options)
    await verifyUploadedAssets(bucket, entry, `${label} entry`)
}

export async function uploadBrowserS3(bucket: string, version: string, phase: 'immutable' | 'aliases'): Promise<void> {
    const plans = buildBrowserAssetUploadPlans(version, await collectBrowserAssets())
    if (phase === 'immutable') {
        await assertCanUploadImmutableAssets(bucket, plans.immutable, false)
        await uploadEntryLast(bucket, plans.immutable, `static/browser/${version}/posthog.js`, 'immutable browser', {
            ifNoneMatch: '*',
        })
        return
    }
    // The workflow supplies the cross-region barrier; every regional promotion
    // also rechecks its entire immutable tree from the original build artifact.
    await verifyUploadedAssets(bucket, plans.immutable, 'immutable browser assets')
    // Keep historical chunks for cached loaders and never expose a new entry
    // before all of its dependencies have been uploaded and verified.
    await uploadEntryLast(
        bucket,
        plans.majorAlias,
        `static/browser/${parseSemver(version)!.major}/posthog.js`,
        'browser major-alias'
    )
}
