import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { open, readFile, rename, rm, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { geminiPath, geminiStreamChunks, validateGeminiJSON } from './gemini-protocol.ts'
import {
  geminiInteractionsPath,
  geminiInteractionStreamChunks,
  validateGeminiInteractionJSON,
} from './gemini-interactions-protocol.ts'
import { openaiJson, openaiStream, safeJson } from './openai-protocol.ts'

const MAX_BYTES = 8 * 1024 * 1024
const MAX_REQUEST_BYTES = 1024 * 1024
const TIMEOUT_MS = 15_000
const GEMINI_INTERACTIONS_TIMEOUT_MS = 60_000
const requestHeaders = ['content-type', 'anthropic-version', 'anthropic-beta'] as const
const credentialHeaders = ['authorization', 'x-api-key', 'x-goog-api-key', 'cookie'] as const
const responseContentTypes = [
  'text/event-stream',
  'application/json',
  'text/plain',
  'text/vtt',
  'application/x-subrip',
] as const
const provenanceSchema = z.strictObject({
  source: z.enum(['synthetic', 'anthropic', 'gemini', 'openai']),
  recordedAt: z.iso.datetime(),
  providerSdkVersion: z.string().min(1),
})
const interactionSchema = z.strictObject({
  request: z.strictObject({
    method: z.enum(['GET', 'POST']),
    path: z.string().min(1),
    headers: z.partialRecord(z.enum(requestHeaders), z.string()),
    body: z.record(z.string(), z.unknown()),
  }),
  response: z.strictObject({
    status: z.literal(200),
    headers: z.strictObject({
      'content-type': z.enum(responseContentTypes),
      'x-request-id': z.string().optional(),
    }),
    body: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('sse'), chunks: z.array(z.string()).min(1) }),
      z.strictObject({ kind: z.literal('json'), value: z.unknown() }),
      z.strictObject({ kind: z.literal('text'), text: z.string() }),
    ]),
  }),
})
const cassetteSchema = z.strictObject({
  formatVersion: z.literal(1),
  provenance: provenanceSchema,
  interactions: z.array(interactionSchema).min(1).max(16),
})
type Interaction = z.infer<typeof interactionSchema>
type Provenance = z.infer<typeof provenanceSchema>

class CassetteFailure extends Error {
  readonly category: 'secret' | 'request' | 'mismatch' | 'stream' | 'response'
  constructor(category: CassetteFailure['category']) {
    super(`Cassette ${category} failure`)
    this.category = category
  }
}

async function classified<T>(category: 'request' | 'stream', operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw error instanceof CassetteFailure ? error : new CassetteFailure(category)
  }
}

function assertSafe(value: unknown, secrets: Set<string>): void {
  if (typeof value === 'string') {
    if (
      [...secrets].some((secret) => secret && value.includes(secret)) ||
      /\b(?:sk-(?:ant-|proj-|svcacct-|[a-z0-9]{20})|Bearer\s+\S+)|AIza[\w-]{20,}/i.test(value)
    ) {
      throw new CassetteFailure('secret')
    }
  } else if (Array.isArray(value)) {
    for (const item of value) assertSafe(item, secrets)
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (
        /^(?:authorization|x-api-key|x-goog-api-key|api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token|cookie|set-cookie)$/i.test(
          key
        )
      ) {
        throw new CassetteFailure('secret')
      }
      assertSafe(key, secrets)
      assertSafe(item, secrets)
    }
  }
}

function parseJSON(text: string, secrets: Set<string>): unknown {
  assertSafe(text, secrets)
  // Scan decoded tokens before parsing can discard duplicate object members.
  for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"\s*:?/g)) {
    const isKey = token[0].endsWith(':')
    const value: unknown = JSON.parse(isKey ? token[0].slice(0, -1) : token[0])
    assertSafe(value, secrets)
    if (isKey && typeof value === 'string') assertSafe({ [value]: null }, secrets)
  }
  const value: unknown = JSON.parse(text)
  assertSafe(value, secrets)
  return value
}

function streamChunks(text: string, secrets: Set<string>): string[] {
  assertSafe(text, secrets)
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.endsWith('\n\n')) throw new Error('Incomplete SSE frame')
  const chunks = normalized
    .slice(0, -2)
    .split('\n\n')
    .map((chunk) => `${chunk}\n\n`)
  let lastType: unknown
  let started = false
  let outputText = ''
  const toolInputs = new Map<number, string>()
  const toolIndices = new Set<number>()
  const toolIds = new Set<string>()
  const blockIndices: unknown[] = []
  for (const chunk of chunks) {
    const data = chunk
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) continue
    const event: unknown = parseJSON(data, secrets)
    assertSafe(event, secrets)
    if (!event || typeof event !== 'object' || !('type' in event)) throw new Error('Invalid SSE event')
    if (lastType === 'message_stop' || event.type === 'error') throw new Error('Invalid Anthropic stream completion')
    if (event.type === 'message_start') {
      if (started) throw new Error('Duplicate message_start')
      started = true
    } else if (!started && event.type !== 'ping') throw new Error('Missing message_start')
    if (event.type === 'content_block_start') {
      const block = 'content_block' in event ? event.content_block : undefined
      if (!block || typeof block !== 'object' || !('type' in block)) throw new Error('Invalid content block')
      if (block.type === 'tool_use') {
        if (
          !('index' in event) ||
          typeof event.index !== 'number' ||
          !Number.isSafeInteger(event.index) ||
          event.index !== blockIndices.length ||
          blockIndices.some((index, position) => index !== position) ||
          toolIndices.has(event.index) ||
          !('id' in block) ||
          typeof block.id !== 'string' ||
          !block.id ||
          toolIds.has(block.id) ||
          !('name' in block) ||
          typeof block.name !== 'string' ||
          !block.name ||
          !('input' in block) ||
          !block.input ||
          typeof block.input !== 'object' ||
          Array.isArray(block.input) ||
          Object.keys(block.input).length !== 0
        )
          throw new Error('Invalid streamed tool block')
        toolIndices.add(event.index)
        toolIds.add(block.id)
        toolInputs.set(event.index, '')
      } else if (block.type !== 'text') throw new Error('Only text and client tool blocks are supported')
      if (toolIndices.size && (!('index' in event) || event.index !== blockIndices.length)) {
        throw new Error('Invalid content block index')
      }
      blockIndices.push('index' in event ? event.index : undefined)
    }
    if (event.type === 'content_block_delta') {
      const delta = 'delta' in event ? event.delta : undefined
      const index = 'index' in event && typeof event.index === 'number' ? event.index : -1
      if (!delta || typeof delta !== 'object' || !('type' in delta)) throw new Error('Invalid content delta')
      if (delta.type === 'input_json_delta') {
        if (!toolInputs.has(index) || !('partial_json' in delta) || typeof delta.partial_json !== 'string') {
          throw new Error('Tool delta without an open tool block')
        }
        toolInputs.set(index, toolInputs.get(index)! + delta.partial_json)
      } else if (delta.type !== 'text_delta' || toolIndices.has(index)) {
        throw new Error('Unsupported content delta')
      }
    }
    if (
      event.type === 'content_block_stop' &&
      'index' in event &&
      typeof event.index === 'number' &&
      toolIndices.has(event.index)
    ) {
      if (!toolInputs.has(event.index)) throw new Error('Duplicate tool block stop')
      const input = toolInputs.get(event.index)!
      assertSafe(input, secrets)
      const parsed: unknown = JSON.parse(input || '{}')
      // JSON.parse discards earlier duplicate keys, but their contents remain in the cassette.
      for (const token of input.matchAll(/("(?:\\.|[^"\\])*")\s*(:)?/g)) {
        const value: string = JSON.parse(token[1])
        assertSafe(token[2] ? { [value]: null } : value, secrets)
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('Tool input must be an object')
      assertSafe(parsed, secrets)
      toolInputs.delete(event.index)
    }
    if (
      'delta' in event &&
      event.delta &&
      typeof event.delta === 'object' &&
      'text' in event.delta &&
      typeof event.delta.text === 'string'
    ) {
      outputText += event.delta.text
    }
    if (
      'content_block' in event &&
      event.content_block &&
      typeof event.content_block === 'object' &&
      'text' in event.content_block &&
      typeof event.content_block.text === 'string'
    ) {
      outputText += event.content_block.text
    }
    lastType = event.type
  }
  // Credentials can span logical deltas as well as network chunks.
  assertSafe(outputText, secrets)
  if (toolInputs.size) throw new Error('Incomplete tool input')
  if (lastType !== 'message_stop') throw new Error('Incomplete Anthropic stream: missing message_stop')
  return chunks
}

function checkRoute(method: string | undefined, path: string, source: Provenance['source']): void {
  const url = new URL(path, 'http://127.0.0.1')
  if (url.origin !== 'http://127.0.0.1' || url.hash) throw new Error('Unexpected cassette request route')
  if ((source === 'anthropic' || source === 'synthetic') && method === 'POST' && path === '/v1/messages') return
  if ((source === 'gemini' || source === 'synthetic') && method === 'POST' && geminiPath.test(path)) return
  if ((source === 'gemini' || source === 'synthetic') && method === 'POST' && path === geminiInteractionsPath) return
  if (source === 'anthropic' || source === 'gemini') throw new Error('Unexpected cassette request route')
  if (
    method === 'POST' &&
    !url.search &&
    (['/v1/chat/completions', '/v1/responses', '/v1/embeddings', '/v1/audio/transcriptions'].includes(path) ||
      /^\/v1\/responses\/[a-zA-Z0-9_-]+\/cancel$/.test(path))
  )
    return
  if (method === 'GET' && /^\/v1\/responses\/[a-zA-Z0-9_-]+$/.test(url.pathname)) {
    const seen = new Set<string>()
    for (const [key, value] of url.searchParams) {
      if (
        seen.has(key) ||
        !((key === 'stream' && /^(?:true|false)$/.test(value)) || (key === 'starting_after' && /^\d+$/.test(value)))
      ) {
        throw new Error('Unsupported retrieval query')
      }
      seen.add(key)
    }
    return
  }
  throw new Error('Unexpected cassette request route')
}

async function readRequest(request: IncomingMessage, source: Provenance['source'], secrets: Set<string>) {
  checkRoute(request.method, request.url ?? '', source)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_REQUEST_BYTES) throw new Error('Cassette request exceeds size limit')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks)
  if (request.method === 'GET' && raw.length) throw new Error('GET requests must not have a body')
  const contentType = request.headers['content-type'] ?? ''
  let body: unknown
  if (contentType.startsWith('multipart/form-data')) {
    if (request.url !== '/v1/audio/transcriptions') throw new Error('Unsupported multipart route')
    assertSafe(raw.toString('utf8'), secrets)
    const form = await new Response(raw, { headers: { 'content-type': contentType } }).formData()
    const fields: [string, string][] = []
    const files: Array<{ name: string; filename: string; type: string; size: number; sha256: string }> = []
    for (const [name, value] of form) {
      if (typeof value === 'string') {
        assertSafe({ [name]: value }, secrets)
        fields.push([name, value])
      } else
        files.push({
          name,
          filename: value.name,
          type: value.type,
          size: value.size,
          sha256: createHash('sha256')
            .update(Buffer.from(await value.arrayBuffer()))
            .digest('hex'),
        })
    }
    body = {
      fields: fields.sort(([a], [b]) => a.localeCompare(b)),
      files: files.sort((a, b) => a.name.localeCompare(b.name)),
    }
  } else {
    body = raw.length ? safeJson(raw.toString('utf8'), (value) => assertSafe(value, secrets)) : {}
  }
  if (
    request.url === '/v1/messages' &&
    (!body || typeof body !== 'object' || !('stream' in body) || body.stream !== true)
  ) {
    throw new Error('Only streaming JSON requests are supported')
  }
  const normalizedHeaders = Object.fromEntries(
    requestHeaders.flatMap((key) => (request.headers[key] === undefined ? [] : [[key, request.headers[key]]]))
  )
  if (contentType.startsWith('multipart/form-data')) normalizedHeaders['content-type'] = 'multipart/form-data'
  const url = new URL(request.url!, 'http://127.0.0.1')
  url.searchParams.sort()
  const canonical = interactionSchema.shape.request.parse({
    method: request.method,
    path: `${url.pathname}${url.search}`,
    headers: normalizedHeaders,
    body,
  })
  assertSafe(canonical, secrets)
  return { canonical, raw }
}

function responseBody(
  text: string,
  contentType: string,
  request: Interaction['request'],
  secrets: Set<string>
): Interaction['response']['body'] {
  const path = request.path
  const gemini = geminiPath.test(path)
  const geminiInteraction = path === geminiInteractionsPath
  const fields = Array.isArray(request.body.fields) ? request.body.fields : []
  const field = (name: string) => fields.find((item) => Array.isArray(item) && item[0] === name)?.[1]
  const streaming = gemini
    ? path.endsWith(':streamGenerateContent?alt=sse')
    : request.method === 'GET'
      ? new URL(path, 'http://127.0.0.1').searchParams.get('stream') === 'true'
      : request.body.stream === true || field('stream') === 'true'
  if (streaming !== (contentType === 'text/event-stream')) throw new CassetteFailure('response')
  const safe = (value: unknown) => assertSafe(value, secrets)
  if (contentType === 'text/event-stream')
    return {
      kind: 'sse',
      chunks:
        path === '/v1/messages'
          ? streamChunks(text, secrets)
          : gemini
            ? geminiStreamChunks(text, (frame) => safeJson(frame, safe), safe)
            : geminiInteraction
              ? geminiInteractionStreamChunks(text, (frame) => safeJson(frame, safe), safe)
              : openaiStream(text, path, safe),
    }
  if (path === '/v1/messages') throw new CassetteFailure('response')
  if (contentType === 'application/json') {
    if (geminiInteraction) {
      const value = safeJson(text, safe)
      validateGeminiInteractionJSON(value, safe)
      return { kind: 'json', value }
    }
    if (!gemini) return { kind: 'json', value: openaiJson(text, path, safe) }
    const value = safeJson(text, safe)
    validateGeminiJSON(path, value, safe)
    return { kind: 'json', value }
  }
  if (['text/plain', 'text/vtt', 'application/x-subrip'].includes(contentType) && path === '/v1/audio/transcriptions') {
    safe(text)
    return { kind: 'text', text }
  }
  throw new CassetteFailure('response')
}

function serializedBody(body: Interaction['response']['body']): string[] {
  if (body.kind === 'sse') return body.chunks
  return [body.kind === 'json' ? JSON.stringify(body.value) : body.text]
}

async function writeChunk(response: ServerResponse, chunk: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  if (response.destroyed) return
  if (!response.write(chunk)) {
    const wait = new AbortController()
    const abort = () => wait.abort()
    signal.addEventListener('abort', abort, { once: true })
    try {
      await Promise.race([
        once(response, 'drain', { signal: wait.signal }),
        once(response, 'close', { signal: wait.signal }),
      ])
    } finally {
      wait.abort()
      signal.removeEventListener('abort', abort)
    }
  }
}

async function serve(
  handle: (request: IncomingMessage, response: ServerResponse, signal: AbortSignal) => Promise<void>,
  verify: () => Promise<void>,
  keepRecordingAfterClientClose = false
) {
  const active = new Set<Promise<void>>()
  const controllers = new Set<AbortController>()
  let failure: Error | undefined
  let closed = false
  let finishing = false
  let finished: Promise<void> | undefined
  let requests = 0
  const server = createServer((request, response) => {
    const interaction = ++requests
    if (closed || finishing) {
      failure ??= new Error('Request received after cassette finish')
      response.writeHead(500).end('Cassette closed')
      return
    }
    const controller = new AbortController()
    controllers.add(controller)
    const timer = setTimeout(
      () => controller.abort(),
      request.url === geminiInteractionsPath ? GEMINI_INTERACTIONS_TIMEOUT_MS : TIMEOUT_MS
    )
    const abort = () => {
      request.destroy()
      response.destroy()
    }
    controller.signal.addEventListener('abort', abort, { once: true })
    const disconnected = () => {
      if (!response.writableFinished && !keepRecordingAfterClientClose) controller.abort()
    }
    response.on('close', disconnected)
    const task = handle(request, response, controller.signal)
      .catch((error: unknown) => {
        // Do not echo provider errors or request bodies: either can contain credentials.
        const category = error instanceof CassetteFailure ? error.category : 'transport'
        failure ??= new Error(`Cassette interaction ${interaction}: ${category} failure`)
        if (!response.headersSent) response.writeHead(500).end('Cassette request failed', () => request.destroy())
        else response.destroy()
      })
      .finally(() => {
        clearTimeout(timer)
        controller.signal.removeEventListener('abort', abort)
        response.off('close', disconnected)
        controllers.delete(controller)
        active.delete(task)
      })
    active.add(task)
  })
  server.requestTimeout = TIMEOUT_MS
  server.headersTimeout = TIMEOUT_MS
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing cassette server address')
  let shutdown: Promise<void> | undefined
  const stop = () =>
    (shutdown ??= new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
      server.closeIdleConnections()
    }))
  return {
    url: `http://127.0.0.1:${address.port}`,
    finish(): Promise<void> {
      return (finished ??= (async () => {
        if (closed) throw new Error('Cassette closed without finishing')
        finishing = true
        const stopped = stop()
        await Promise.all(active)
        await stopped
        if (failure) throw failure
        if (closed) throw new Error('Cassette closed without finishing')
        await verify()
      })())
    },
    async close(): Promise<void> {
      closed = true
      for (const controller of controllers) controller.abort()
      const stopped = stop()
      server.closeAllConnections()
      await Promise.all(active)
      await stopped
    },
  }
}

export async function startReplay({ path }: { path: string }) {
  if ((await stat(path)).size > MAX_BYTES * 2) throw new Error('Cassette exceeds size limit')
  const cassette = cassetteSchema.parse(parseJSON(await readFile(path, 'utf8'), new Set()))
  assertSafe(cassette, new Set())
  for (const interaction of cassette.interactions) {
    checkRoute(interaction.request.method, interaction.request.path, cassette.provenance.source)
    const validated = responseBody(
      serializedBody(interaction.response.body).join(''),
      interaction.response.headers['content-type'],
      interaction.request,
      new Set()
    )
    if (validated.kind !== interaction.response.body.kind) throw new Error('Mismatched response format')
  }
  let index = 0
  return serve(
    async (incoming, response, signal) => {
      const { canonical: request } = await classified('request', () =>
        readRequest(incoming, cassette.provenance.source, new Set())
      )
      const interaction = cassette.interactions[index]
      if (!interaction || !isDeepStrictEqual(request, interaction.request)) throw new CassetteFailure('mismatch')
      index++
      response.writeHead(interaction.response.status, interaction.response.headers)
      for (const chunk of serializedBody(interaction.response.body)) await writeChunk(response, chunk, signal)
      response.end()
    },
    async () => {
      if (index !== cassette.interactions.length) throw new Error('Unused cassette interactions')
    }
  )
}

export async function startRecorder(options: {
  path: string
  upstreamURL: string
  provenance: Provenance
  secrets?: string[]
}) {
  const provenance = provenanceSchema.parse(options.provenance)
  let upstream: URL
  try {
    upstream = new URL(options.upstreamURL)
  } catch {
    throw new Error('Unsupported recording upstream')
  }
  const validOrigin =
    provenance.source === 'anthropic'
      ? upstream.origin === 'https://api.anthropic.com'
      : provenance.source === 'gemini'
        ? upstream.origin === 'https://generativelanguage.googleapis.com'
        : provenance.source === 'openai'
          ? upstream.origin === 'https://api.openai.com'
          : upstream.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(upstream.hostname)
  if (
    !validOrigin ||
    upstream.username ||
    upstream.password ||
    upstream.pathname !== '/' ||
    upstream.search ||
    upstream.hash
  ) {
    throw new Error('Unsupported recording upstream')
  }
  const secrets = new Set(options.secrets ?? [])
  const interactions: Interaction[] = []
  let totalBytes = 0
  let recording = false
  return serve(
    async (incoming, response, signal) => {
      if (recording || interactions.length >= 16) throw new Error('Only sequential recording is supported')
      recording = true
      try {
        for (const key of credentialHeaders) {
          const value = incoming.headers[key]
          for (const secret of Array.isArray(value) ? value : [value]) {
            if (secret) {
              secrets.add(secret)
              secrets.add(secret.replace(/^Bearer\s+/i, ''))
            }
          }
        }
        const { canonical: request, raw } = await classified('request', () =>
          readRequest(incoming, provenance.source, secrets)
        )
        assertSafe(request, secrets)
        const headers = new Headers(request.headers)
        if (typeof incoming.headers['content-type'] === 'string')
          headers.set('content-type', incoming.headers['content-type'])
        for (const key of credentialHeaders) {
          const value = incoming.headers[key]
          if (typeof value === 'string') headers.set(key, value)
        }
        const result = await fetch(new URL(request.path, upstream), {
          method: request.method,
          headers,
          body: request.method === 'GET' ? undefined : raw,
          redirect: 'error',
          signal,
        })
        if (
          result.status !== 200 ||
          !(responseContentTypes as readonly string[]).includes(
            result.headers.get('content-type')?.split(';')[0].trim() ?? ''
          ) ||
          !result.body
        ) {
          await result.body?.cancel()
          throw new CassetteFailure('response')
        }
        for (const key of [...credentialHeaders, 'set-cookie']) {
          const secret = result.headers.get(key)
          if (secret) {
            secrets.add(secret)
            secrets.add(secret.replace(/^Bearer\s+/i, ''))
          }
        }
        const responseHeaders = interactionSchema.shape.response.shape.headers.parse({
          'content-type': result.headers.get('content-type')!.split(';')[0].trim(),
          ...(result.headers.get('x-request-id') ? { 'x-request-id': result.headers.get('x-request-id') } : {}),
        })
        assertSafe(responseHeaders, secrets)
        response.writeHead(200, responseHeaders)
        const decoder = new TextDecoder('utf-8', { fatal: true })
        let text = ''
        for await (const bytes of result.body) {
          totalBytes += bytes.length
          if (totalBytes > MAX_BYTES) throw new Error('Cassette response exceeds size limit')
          const chunk = decoder.decode(bytes, { stream: true })
          text += chunk
          await writeChunk(response, chunk, signal)
        }
        const tail = decoder.decode()
        text += tail
        if (tail) await writeChunk(response, tail, signal)
        const body = await classified('stream', () =>
          responseBody(text, responseHeaders['content-type'], request, secrets)
        )
        interactions.push({
          request,
          response: {
            status: 200,
            headers: responseHeaders,
            body,
          },
        })
        response.end()
      } finally {
        recording = false
      }
    },
    async () => {
      const cassette = cassetteSchema.parse({ formatVersion: 1, provenance, interactions })
      assertSafe(cassette, secrets)
      const serialized = `${JSON.stringify(cassette, null, 2)}\n`
      if (Buffer.byteLength(serialized) > MAX_BYTES * 2) throw new Error('Cassette exceeds size limit')
      const temporary = `${options.path}.${randomUUID()}.tmp`
      try {
        const file = await open(temporary, 'wx', 0o600)
        try {
          await file.writeFile(serialized)
          await file.sync()
        } finally {
          await file.close()
        }
        await rename(temporary, options.path)
      } finally {
        await rm(temporary, { force: true })
      }
    },
    true
  )
}
