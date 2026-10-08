import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
    type HeadObjectCommandOutput,
    type PutObjectCommandInput,
} from '@aws-sdk/client-s3'

let cachedClient: S3Client | null = null

export function createS3ClientConfig() {
    return {
        region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
        endpoint: process.env.AWS_ENDPOINT_URL_S3,
        // Replayable request bodies let the SDK retry transient transport/5xx/throttling
        // errors with its standard exponential backoff and jitter, within a fixed bound.
        retryMode: 'standard' as const,
        maxAttempts: 4,
        // Production bucket names contain dots, so virtual-hosted-style HTTPS
        // would produce hostnames that fail AWS wildcard certificate matching.
        forcePathStyle: true,
    }
}

function getS3Client(): S3Client {
    if (!cachedClient) cachedClient = new S3Client(createS3ClientConfig())
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

export type FileUploadOptions = {
    contentType?: string
    cacheControl?: string
    ifNoneMatch?: string
}

export async function createPutObjectInput(
    bucket: string,
    key: string,
    filePath: string,
    options: FileUploadOptions = {}
): Promise<PutObjectCommandInput> {
    // A one-shot ReadStream cannot be replayed by the SDK after a socket reset.
    // The upload worker pool bounds the number of these buffers held at once.
    const body = await fs.readFile(filePath)
    return {
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentLength: body.length,
        ChecksumSHA256: createHash('sha256').update(body).digest('base64'),
        ContentType: options.contentType ?? 'application/octet-stream',
        CacheControl: options.cacheControl,
        IfNoneMatch: options.ifNoneMatch,
        Tagging: 'public=true',
    }
}

function assertMatchingMetadata(input: PutObjectCommandInput, remote: HeadObjectCommandOutput): void {
    if (
        remote.ContentLength !== input.ContentLength ||
        remote.ContentType !== input.ContentType ||
        remote.CacheControl !== input.CacheControl ||
        remote.ContentEncoding // We publish unencoded bytes, including source maps.
    ) {
        throw new Error(`Release asset metadata differs: s3://${input.Bucket}/${input.Key}`)
    }
}

async function matchesExistingObject(client: S3Client, input: PutObjectCommandInput): Promise<boolean> {
    let remote: HeadObjectCommandOutput
    try {
        remote = await client.send(
            new HeadObjectCommand({ Bucket: input.Bucket, Key: input.Key, ChecksumMode: 'ENABLED' })
        )
    } catch (error) {
        if (isS3NotFoundError(error)) return false
        throw error // Permission/transport failures are not evidence of an absent object.
    }
    assertMatchingMetadata(input, remote)
    let checksum = remote.ChecksumType === 'COMPOSITE' ? undefined : remote.ChecksumSHA256
    if (!checksum) {
        // Older releases may lack SHA-256 or have multipart/composite checksums.
        // Hash their actual bytes rather than trusting ETag or a checksum of parts.
        const response = await client.send(
            new GetObjectCommand({ Bucket: input.Bucket, Key: input.Key, IfMatch: remote.ETag })
        )
        try {
            assertMatchingMetadata(input, response)
            if (!response.Body) throw new Error('S3 returned no object body')
            checksum = createHash('sha256')
                .update(await response.Body.transformToByteArray())
                .digest('base64')
        } finally {
            // Destroying an unconsumed Node stream also releases the connection on metadata failure.
            if (response.Body && 'destroy' in response.Body) response.Body.destroy()
        }
    }
    if (checksum !== input.ChecksumSHA256) {
        throw new Error(`Release asset checksum differs: s3://${input.Bucket}/${input.Key}`)
    }
    return true
}

// Returns false only for a missing object; mismatching bytes/HTTP metadata fail closed.
export async function s3ObjectMatchesFile(
    bucket: string,
    key: string,
    filePath: string,
    options: FileUploadOptions = {},
    client = getS3Client()
): Promise<boolean> {
    return matchesExistingObject(client, await createPutObjectInput(bucket, key, filePath, options))
}

export async function putS3ObjectFromFile(
    bucket: string,
    key: string,
    filePath: string,
    options: FileUploadOptions = {},
    client = getS3Client()
): Promise<void> {
    const input = await createPutObjectInput(bucket, key, filePath, options)
    if (input.IfNoneMatch === '*' && (await matchesExistingObject(client, input))) return
    try {
        await client.send(new PutObjectCommand(input))
    } catch (error) {
        // S3 may have committed a PUT whose acknowledgement was lost. Retrying
        // that conditional write returns 412; a concurrent writer can do the same.
        // Accept only an exact match, never disable the atomic no-overwrite guard.
        if (
            input.IfNoneMatch === '*' &&
            getErrorStatusCode(error) === 412 &&
            (await matchesExistingObject(client, input))
        ) {
            return
        }
        throw error
    }
}
