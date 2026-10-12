import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import type { TestContext } from 'node:test'
import { S3Client } from '@aws-sdk/client-s3'

export type StoredObject = {
    body: Buffer
    contentType: string
    cacheControl?: string
    contentEncoding?: string
    checksum?: string
    checksumType?: string
}
export type RequestRecord = { method: string; key: string; body: Buffer; headers: IncomingMessage['headers'] }

// Exercise the real AWS SDK against a loopback HTTP endpoint. No cloud credentials
// or production hosts; hooks simulate transport failures before/after S3 commits.
export async function startS3(t: TestContext) {
    const objects = new Map<string, StoredObject>()
    const requests: RequestRecord[] = []
    const hooks: { before?: (request: RequestRecord, response: ServerResponse) => Promise<boolean> | boolean } = {}
    const server = createServer((req, res) => {
        void (async () => {
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(Buffer.from(chunk))
            const request: RequestRecord = {
                method: req.method!,
                key: decodeURIComponent(new URL(req.url!, 'http://localhost').pathname),
                body: Buffer.concat(chunks),
                headers: req.headers,
            }
            requests.push(request)
            if (await hooks.before?.(request, res)) return
            if (request.method === 'PUT') {
                if (req.headers['if-none-match'] === '*' && objects.has(request.key)) {
                    res.writeHead(412, { 'content-type': 'application/xml' })
                    res.end('<Error><Code>PreconditionFailed</Code></Error>')
                    return
                }
                objects.set(request.key, {
                    body: request.body,
                    contentType: String(req.headers['content-type']),
                    cacheControl: req.headers['cache-control'],
                    contentEncoding: req.headers['content-encoding'],
                    checksum: String(req.headers['x-amz-checksum-sha256']),
                    checksumType: 'FULL_OBJECT',
                })
                res.writeHead(200)
                res.end()
                return
            }
            const object = objects.get(request.key)
            if (!object) {
                res.writeHead(404)
                res.end()
                return
            }
            res.setHeader('content-length', object.body.length)
            res.setHeader('content-type', object.contentType)
            res.setHeader('etag', '"' + createHash('md5').update(object.body).digest('hex') + '"')
            if (object.cacheControl) res.setHeader('cache-control', object.cacheControl)
            if (object.contentEncoding) res.setHeader('content-encoding', object.contentEncoding)
            if (object.checksum) res.setHeader('x-amz-checksum-sha256', object.checksum)
            if (object.checksumType) res.setHeader('x-amz-checksum-type', object.checksumType)
            res.writeHead(200)
            res.end(request.method === 'HEAD' ? undefined : object.body)
        })().catch((error) => {
            res.writeHead(500)
            res.end(String(error))
        })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
    const endpoint = `http://127.0.0.1:${address.port}`
    const client = new S3Client({
        endpoint,
        region: 'us-east-1',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        forcePathStyle: true,
        retryMode: 'standard',
        maxAttempts: 4,
    })
    t.after(async () => {
        client.destroy()
        server.closeAllConnections()
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    })
    return { objects, requests, hooks, client, endpoint }
}
