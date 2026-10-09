import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createSecureServer, Http2Session } from 'node:http2'
import type { AddressInfo, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as base } from './posthog-playwright-test-base'

export type Upload = { path: string; method: string; headers: Record<string, string>; body: Buffer }

// Chromium requires HTTP/2 for streaming uploads. Use TLS with HTTP/1 fallback for the other browsers.
// Generate a localhost-only test certificate rather than depend on a public service or checked-in key.
export const test = base.extend<
    { echoServer: { url: string; uploads: Upload[]; receivedBytes: Map<string, number> } },
    { certificate: { key: Buffer; cert: Buffer } }
>({
    certificate: [
        async ({}, use) => {
            const directory = mkdtempSync(join(tmpdir(), 'posthog-fetch-echo-'))
            try {
                execFileSync(
                    'openssl',
                    [
                        'req',
                        '-x509',
                        '-newkey',
                        'rsa:2048',
                        '-nodes',
                        '-days',
                        '1',
                        '-subj',
                        '/CN=localhost',
                        '-keyout',
                        join(directory, 'key.pem'),
                        '-out',
                        join(directory, 'cert.pem'),
                    ],
                    { stdio: 'ignore' }
                )
                await use({
                    key: readFileSync(join(directory, 'key.pem')),
                    cert: readFileSync(join(directory, 'cert.pem')),
                })
            } finally {
                rmSync(directory, { recursive: true, force: true })
            }
        },
        { scope: 'worker' },
    ],
    echoServer: async ({ certificate }, use) => {
        const uploads: Upload[] = []
        const receivedBytes = new Map<string, number>()
        const sessions = new Set<Http2Session>()
        const sockets = new Set<Socket>()
        const server = createSecureServer({ ...certificate, allowHTTP1: true }, (request, response) => {
            response.setHeader('Access-Control-Allow-Origin', '*')
            response.setHeader('Access-Control-Allow-Headers', '*')
            response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
            response.setHeader('Access-Control-Allow-Private-Network', 'true')
            response.setHeader('Timing-Allow-Origin', '*')
            if (request.method === 'OPTIONS') {
                response.writeHead(204).end()
                return
            }
            const chunks: Uint8Array[] = []
            request.on('data', (chunk: Buffer) => {
                chunks.push(new Uint8Array(chunk))
                receivedBytes.set(request.url!, (receivedBytes.get(request.url!) ?? 0) + chunk.length)
            })
            request.on('error', () => {}) // An aborted upload is an expected test case.
            request.on('end', () => {
                if (request.aborted || response.destroyed) return
                uploads.push({
                    path: request.url!,
                    method: request.method!,
                    headers: Object.fromEntries(
                        Object.entries(request.headers).map(([name, value]) => [name, String(value)])
                    ),
                    body: Buffer.concat(chunks),
                })
                response.writeHead(200, { 'Content-Type': 'text/plain' }).end('echo response')
            })
        })
        server.on('session', (session) => {
            sessions.add(session)
            session.on('error', () => {})
            session.on('close', () => sessions.delete(session))
        })
        server.on('connection', (socket) => {
            sockets.add(socket)
            socket.on('close', () => sockets.delete(socket))
        })
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        try {
            await use({ url: `https://127.0.0.1:${(server.address() as AddressInfo).port}`, uploads, receivedBytes })
        } finally {
            for (const session of sessions) session.destroy()
            for (const socket of sockets) socket.destroy()
            await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
        }
    },
})
export { expect } from './posthog-playwright-test-base'
