import fs from 'node:fs'
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

let cachedClient: S3Client | null = null

function getS3Client(): S3Client {
    if (!cachedClient) {
        cachedClient = new S3Client({
            region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
            endpoint: process.env.AWS_ENDPOINT_URL_S3,
            forcePathStyle: !!process.env.AWS_ENDPOINT_URL_S3,
        })
    }

    return cachedClient
}

function getErrorStatusCode(error: unknown): number | undefined {
    return typeof error === 'object' && error !== null && '$metadata' in error
        ? ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ?? undefined)
        : undefined
}

function getErrorName(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name?: unknown }).name)
        : undefined
}

export function isS3NotFoundError(error: unknown): boolean {
    const errorName = getErrorName(error)
    const statusCode = getErrorStatusCode(error)
    return statusCode === 404 || errorName === 'NotFound' || errorName === 'NoSuchKey'
}

export async function s3ObjectExists(bucket: string, key: string): Promise<boolean> {
    try {
        await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return true
    } catch (error) {
        if (isS3NotFoundError(error)) {
            return false
        }
        throw error
    }
}

export async function putS3ObjectFromFile(
    bucket: string,
    key: string,
    filePath: string,
    options: {
        contentType?: string
        cacheControl?: string
    } = {}
): Promise<void> {
    await getS3Client().send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: fs.createReadStream(filePath),
            ContentType: options.contentType,
            CacheControl: options.cacheControl,
            Tagging: 'public=true',
        })
    )
}
