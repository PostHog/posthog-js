import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createPutObjectInput, createS3ClientConfig } from './s3.ts'

test('createPutObjectInput uses a replayable body and an atomic no-overwrite condition', async () => {
    const input = await createPutObjectInput(
        'us-assets.i.posthog.com',
        'static/1.370.0/array.js',
        fileURLToPath(import.meta.url),
        {
            cacheControl: 'public, max-age=31536000, immutable',
            contentType: 'application/javascript',
            ifNoneMatch: '*',
        }
    )

    assert.equal(input.Bucket, 'us-assets.i.posthog.com')
    assert.equal(input.Key, 'static/1.370.0/array.js')
    assert.equal(input.IfNoneMatch, '*')
    assert.ok(Buffer.isBuffer(input.Body))
    assert.equal(input.ContentLength, input.Body.length)
    assert.ok(input.ChecksumSHA256)
})

test('createS3ClientConfig always enables path-style addressing for dotted bucket names', () => {
    const originalAwsRegion = process.env.AWS_REGION
    const originalAwsDefaultRegion = process.env.AWS_DEFAULT_REGION
    const originalEndpoint = process.env.AWS_ENDPOINT_URL_S3

    try {
        delete process.env.AWS_REGION
        delete process.env.AWS_DEFAULT_REGION
        delete process.env.AWS_ENDPOINT_URL_S3

        assert.deepEqual(createS3ClientConfig(), {
            region: 'us-east-1',
            endpoint: undefined,
            retryMode: 'standard',
            maxAttempts: 4,
            forcePathStyle: true,
        })

        process.env.AWS_DEFAULT_REGION = 'eu-central-1'
        process.env.AWS_ENDPOINT_URL_S3 = 'http://localhost:4566'

        assert.deepEqual(createS3ClientConfig(), {
            region: 'eu-central-1',
            endpoint: 'http://localhost:4566',
            retryMode: 'standard',
            maxAttempts: 4,
            forcePathStyle: true,
        })

        process.env.AWS_REGION = 'ap-southeast-1'

        assert.deepEqual(createS3ClientConfig(), {
            region: 'ap-southeast-1',
            endpoint: 'http://localhost:4566',
            retryMode: 'standard',
            maxAttempts: 4,
            forcePathStyle: true,
        })
    } finally {
        if (originalAwsRegion === undefined) {
            delete process.env.AWS_REGION
        } else {
            process.env.AWS_REGION = originalAwsRegion
        }

        if (originalAwsDefaultRegion === undefined) {
            delete process.env.AWS_DEFAULT_REGION
        } else {
            process.env.AWS_DEFAULT_REGION = originalAwsDefaultRegion
        }

        if (originalEndpoint === undefined) {
            delete process.env.AWS_ENDPOINT_URL_S3
        } else {
            process.env.AWS_ENDPOINT_URL_S3 = originalEndpoint
        }
    }
})
