import { createServer } from 'node:http'
import { gunzipSync } from 'node:zlib'

export async function startCollector() {
  const events: Array<{ event: string; distinct_id: string; properties: Record<string, unknown> }> = []
  const errors: Error[] = []
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/harness/received') {
        response.end(JSON.stringify({ count: events.length }))
        return
      }
      if (request.method !== 'POST' || request.url !== '/batch/') throw new Error('Unexpected collector request')
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
      if (payload.api_key !== 'phc_cassette_test' || !Array.isArray(payload.batch))
        throw new Error('Invalid analytics payload')
      for (const item of payload.batch) {
        if (item.event !== '$ai_generation' || typeof item.distinct_id !== 'string' || !item.properties)
          throw new Error('Unexpected analytics event')
        events.push(item)
      }
      response.end('{}')
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
