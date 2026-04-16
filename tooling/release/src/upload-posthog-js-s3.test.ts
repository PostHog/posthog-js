import assert from 'node:assert/strict'
import test from 'node:test'
import {
    assertNoCompatibilityVersionNamespaceCollisions,
    buildAssetUploadPlans,
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
    assert.equal(inferContentType('/tmp/assets/unknown.custom-extension'), undefined)
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

test('buildAssetUploadPlans rejects invalid versions', () => {
    assert.throws(() => buildAssetUploadPlans('1.370', []), /Invalid version format/)
})
