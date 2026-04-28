import assert from 'node:assert/strict'
import test from 'node:test'
import { createS3ClientConfig } from './s3.ts'

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
            forcePathStyle: true,
        })

        process.env.AWS_DEFAULT_REGION = 'eu-central-1'
        process.env.AWS_ENDPOINT_URL_S3 = 'http://localhost:4566'

        assert.deepEqual(createS3ClientConfig(), {
            region: 'eu-central-1',
            endpoint: 'http://localhost:4566',
            forcePathStyle: true,
        })

        process.env.AWS_REGION = 'ap-southeast-1'

        assert.deepEqual(createS3ClientConfig(), {
            region: 'ap-southeast-1',
            endpoint: 'http://localhost:4566',
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
