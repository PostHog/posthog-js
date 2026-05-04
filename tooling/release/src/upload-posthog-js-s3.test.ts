import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
    assertNoCompatibilityVersionNamespaceCollisions,
    buildAssetUploadPlans,
    collectReleaseAssets,
    inferContentType,
    type ReleaseAsset,
} from './upload-posthog-js-s3.ts'

test('buildAssetUploadPlans publishes immutable semver assets, major-version alias assets, and top-level compatibility assets', () => {
    const assets: ReleaseAsset[] = [
        {
            relativeKey: 'array.js',
            filePath: '/tmp/array.js',
            contentType: 'application/javascript',
        },
        {
            relativeKey: 'array.js.map',
            filePath: '/tmp/array.js.map',
            contentType: 'application/json',
        },
        {
            relativeKey: 'toolbar.css',
            filePath: '/tmp/toolbar.css',
            contentType: 'text/css',
        },
        {
            relativeKey: 'assets/logo.svg',
            filePath: '/tmp/assets/logo.svg',
            contentType: inferContentType('/tmp/assets/logo.svg'),
        },
    ]

    const plans = buildAssetUploadPlans('1.370.0', assets)

    assert.deepEqual(
        plans.immutable.map(({ key, cacheControl, contentType }) => ({ key, cacheControl, contentType })),
        [
            {
                key: 'static/1.370.0/array.js',
                cacheControl: 'public, max-age=31536000, immutable',
                contentType: 'application/javascript',
            },
            {
                key: 'static/1.370.0/array.js.map',
                cacheControl: 'public, max-age=31536000, immutable',
                contentType: 'application/json',
            },
            {
                key: 'static/1.370.0/toolbar.css',
                cacheControl: 'public, max-age=31536000, immutable',
                contentType: 'text/css',
            },
            {
                key: 'static/1.370.0/assets/logo.svg',
                cacheControl: 'public, max-age=31536000, immutable',
                contentType: 'image/svg+xml',
            },
        ]
    )

    assert.deepEqual(
        plans.majorAlias.map(({ key, cacheControl, contentType }) => ({ key, cacheControl, contentType })),
        [
            {
                key: 'static/1/array.js',
                cacheControl: 'public, max-age=300',
                contentType: 'application/javascript',
            },
            {
                key: 'static/1/array.js.map',
                cacheControl: 'public, max-age=300',
                contentType: 'application/json',
            },
            {
                key: 'static/1/toolbar.css',
                cacheControl: 'public, max-age=300',
                contentType: 'text/css',
            },
            {
                key: 'static/1/assets/logo.svg',
                cacheControl: 'public, max-age=300',
                contentType: 'image/svg+xml',
            },
        ]
    )

    assert.deepEqual(
        plans.compatibility.map(({ key, cacheControl, contentType }) => ({ key, cacheControl, contentType })),
        [
            {
                key: 'static/array.js',
                cacheControl: 'public, max-age=300',
                contentType: 'application/javascript',
            },
            {
                key: 'static/array.js.map',
                cacheControl: 'public, max-age=300',
                contentType: 'application/json',
            },
            {
                key: 'static/toolbar.css',
                cacheControl: 'public, max-age=300',
                contentType: 'text/css',
            },
            {
                key: 'static/assets/logo.svg',
                cacheControl: 'public, max-age=300',
                contentType: 'image/svg+xml',
            },
        ]
    )
})

test('inferContentType restores aws-cli style MIME inference for release assets', () => {
    assert.equal(inferContentType('/tmp/assets/logo.svg'), 'image/svg+xml')
    assert.equal(inferContentType('/tmp/assets/font.woff2'), 'font/woff2')
    assert.equal(inferContentType('/tmp/array.js.map'), 'application/json')
    assert.equal(inferContentType('/tmp/assets/unknown.custom-extension'), undefined)
})

test('collectReleaseAssets includes browser source maps from the dist root', async () => {
    const distDir = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-js-dist-'))

    try {
        await fs.writeFile(path.join(distDir, 'array.js'), '')
        await fs.writeFile(path.join(distDir, 'array.js.map'), '{}')
        await fs.writeFile(path.join(distDir, 'module.d.ts'), '')
        await fs.writeFile(path.join(distDir, 'toolbar.css'), '')
        await fs.mkdir(path.join(distDir, 'assets'))
        await fs.writeFile(path.join(distDir, 'assets', 'logo.svg'), '<svg />')

        const assets = await collectReleaseAssets(distDir)

        assert.deepEqual(
            assets.map(({ relativeKey, contentType }) => ({ relativeKey, contentType })),
            [
                { relativeKey: 'array.js', contentType: 'application/javascript' },
                { relativeKey: 'array.js.map', contentType: 'application/json' },
                { relativeKey: 'toolbar.css', contentType: 'text/css' },
                { relativeKey: 'assets/logo.svg', contentType: 'image/svg+xml' },
            ]
        )
    } finally {
        await fs.rm(distDir, { recursive: true, force: true })
    }
})

test('assertNoCompatibilityVersionNamespaceCollisions rejects compatibility keys that would shadow reserved version namespaces', () => {
    for (const relativeKey of ['1/array.js', '1.370/array.js', '1.370.0/array.js']) {
        assert.throws(
            () =>
                assertNoCompatibilityVersionNamespaceCollisions([
                    {
                        relativeKey,
                        filePath: '/tmp/array.js',
                        contentType: 'application/javascript',
                    },
                ]),
            /would collide with a reserved version namespace under \/static\//
        )
    }

    assert.doesNotThrow(() =>
        assertNoCompatibilityVersionNamespaceCollisions([
            {
                relativeKey: 'array.js',
                filePath: '/tmp/array.js',
                contentType: 'application/javascript',
            },
            {
                relativeKey: '1.370.0.js',
                filePath: '/tmp/1.370.0.js',
                contentType: 'application/javascript',
            },
        ])
    )
})

test('buildAssetUploadPlans skips mutable aliases for prerelease versions', () => {
    const assets: ReleaseAsset[] = [
        {
            relativeKey: 'array.js',
            filePath: '/tmp/array.js',
            contentType: 'application/javascript',
        },
    ]

    const plans = buildAssetUploadPlans('1.370.0-beta.1', assets)

    assert.deepEqual(
        plans.immutable.map(({ key }) => key),
        ['static/1.370.0-beta.1/array.js']
    )
    assert.deepEqual(plans.majorAlias, [])
    assert.deepEqual(plans.compatibility, [])
})

test('buildAssetUploadPlans rejects invalid versions', () => {
    assert.throws(() => buildAssetUploadPlans('1.370', []), /Invalid version format/)
})
