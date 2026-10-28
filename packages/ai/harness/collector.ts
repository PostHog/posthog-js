import { createServer, type IncomingHttpHeaders } from 'node:http'
import { gunzipSync } from 'node:zlib'

const API_KEY = 'phc_cassette_test'
const V1_CAPTURE_PATHS = new Set(['/i/v1/analytics/events', '/i/v1/ai/events'])

// Capture v1 per-event `options`, keyed by the legacy property each one replaces.
const V1_OPTION_PROPERTIES: Record<string, string> = {
  cookieless_mode: '$cookieless_mode',
  disable_skew_correction: '$ignore_sent_at',
  process_person_profile: '$process_person_profile',
  product_tour_id: '$product_tour_id',
}

type CollectedEvent = { event: string; distinct_id: string; properties: Record<string, unknown> }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One capture v1 event in the legacy `/batch/` event shape the replay assertions use. */
function toLegacyEvent(item: unknown): unknown {
  if (
    !isObject(item) ||
    typeof item.uuid !== 'string' ||
    typeof item.timestamp !== 'string' ||
    !isObject(item.options) ||
    !isObject(item.properties)
  )
    throw new Error('Unexpected analytics event')
  const { options, session_id, window_id, properties, ...event } = item
  const legacyProperties: Record<string, unknown> = { ...properties }
  for (const [option, value] of Object.entries(options))
    legacyProperties[V1_OPTION_PROPERTIES[option] ?? option] = value
  if (session_id !== undefined) legacyProperties.$session_id = session_id
  if (window_id !== undefined) legacyProperties.$window_id = window_id
  return { ...event, properties: legacyProperties }
}

/** The events of one capture v1 request. */
function readEvents(headers: IncomingHttpHeaders, payload: Record<string, unknown>): unknown[] {
  if (headers.authorization !== `Bearer ${API_KEY}`) throw new Error('Invalid analytics credentials')
  if (typeof payload.created_at !== 'string' || !Array.isArray(payload.batch))
    throw new Error('Invalid analytics payload')
  return payload.batch.map(toLegacyEvent)
}

export async function startCollector() {
  const events: CollectedEvent[] = []
  const errors: Error[] = []
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/harness/received') {
        response.end(JSON.stringify({ count: events.length }))
        return
      }
      const path = request.url?.replace(/\/$/, '') ?? ''
      if (request.method !== 'POST' || !V1_CAPTURE_PATHS.has(path)) throw new Error('Unexpected collector request')
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        size += chunk.length
        if (size > 1024 * 1024) throw new Error('Collector request exceeds limit')
        chunks.push(chunk)
      }
      const compressed = Buffer.concat(chunks)
      const encoding = request.headers['content-encoding']
      if (encoding && encoding !== 'gzip') throw new Error('Unsupported collector encoding')
      const bytes = encoding === 'gzip' ? gunzipSync(compressed, { maxOutputLength: 1024 * 1024 }) : compressed
      const payload = JSON.parse(bytes.toString('utf8'))
      if (!isObject(payload)) throw new Error('Invalid analytics payload')
      for (const item of readEvents(request.headers, payload)) {
        if (
          !isObject(item) ||
          !['$ai_generation', '$ai_embedding'].includes(item.event as string) ||
          typeof item.distinct_id !== 'string' ||
          !isObject(item.properties)
        )
          throw new Error('Unexpected analytics event')
        events.push(item as CollectedEvent)
      }
      response.setHeader('content-type', 'application/json')
      response.end('{"results":{}}')
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)))
      response.statusCode = 500
      response.end('{}')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing collector address')
  return {
    url: `http://127.0.0.1:${address.port}`,
    events,
    verify() {
      if (errors.length) throw new AggregateError(errors, 'Analytics collector failed')
    },
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    },
  }
}
