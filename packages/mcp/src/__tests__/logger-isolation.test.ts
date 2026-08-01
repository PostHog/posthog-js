import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'

import { instrument, setLogger } from '../index'
import { captureEvent } from '../extensions/capture'
import { MCPAnalyticsEventType } from '../extensions/event-types'
import { instrumentHighLevelServer } from '../extensions/instrument-highlevel'
import { getServerTrackingData } from '../extensions/internal'
import { createLogger } from '../extensions/logger'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'
import { fakePostHog } from './test-utils'

function failingPostHog(marker: string): any {
  return {
    ...fakePostHog(),
    capture: () => {
      throw new Error(marker)
    },
  }
}

async function callTool(client: Awaited<ReturnType<typeof setupTestServerAndClient>>['client'], text: string) {
  return await client.request(
    { method: 'tools/call', params: { name: 'add_todo', arguments: { text } } },
    CallToolResultSchema
  )
}

async function flushSinkLogging(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('per-server logger isolation', () => {
  beforeEach(() => resetTodos())
  afterEach(() => setLogger(undefined))

  it('routes concurrent identity and sink activity only to each server logger', async () => {
    const [setupA, setupB] = await Promise.all([setupTestServerAndClient(), setupTestServerAndClient()])
    const logsA: string[] = []
    const logsB: string[] = []

    try {
      instrument(setupA.server, failingPostHog('sink-a'), {
        logger: (message) => logsA.push(message),
        identify: async () => ({ distinctId: 'distinct-a-secret', properties: { email: 'a-secret@example.com' } }),
      })
      instrument(setupB.server, failingPostHog('sink-b'), {
        logger: (message) => logsB.push(message),
        identify: async () => ({ distinctId: 'distinct-b-secret', properties: { email: 'b-secret@example.com' } }),
      })

      await Promise.all([callTool(setupA.client, 'from-a'), callTool(setupB.client, 'from-b')])
      await flushSinkLogging()

      const sessionA = getServerTrackingData(setupA.server.server)?.sessionId
      const sessionB = getServerTrackingData(setupB.server.server)?.sessionId
      expect(sessionA).toBeDefined()
      expect(sessionB).toBeDefined()

      expect(logsA.some((message) => message.includes(`Identified session ${sessionA}`))).toBe(true)
      expect(logsA.some((message) => message.includes('sink-a'))).toBe(true)
      expect(logsA.join('\n')).not.toContain(String(sessionB))
      expect(logsA.join('\n')).not.toContain('sink-b')

      expect(logsB.some((message) => message.includes(`Identified session ${sessionB}`))).toBe(true)
      expect(logsB.some((message) => message.includes('sink-b'))).toBe(true)
      expect(logsB.join('\n')).not.toContain(String(sessionA))
      expect(logsB.join('\n')).not.toContain('sink-a')

      const combinedLogs = [...logsA, ...logsB].join('\n')
      expect(combinedLogs).not.toContain('distinct-a-secret')
      expect(combinedLogs).not.toContain('distinct-b-secret')
      expect(combinedLogs).not.toContain('a-secret@example.com')
      expect(combinedLogs).not.toContain('b-secret@example.com')
    } finally {
      await Promise.all([setupA.cleanup(), setupB.cleanup()])
    }
  })

  it('keeps missing tracking data observable through the server-bound logger', async () => {
    const setup = await setupTestServerAndClient()
    const logs: string[] = []
    const logger = createLogger((message) => logs.push(message))

    try {
      captureEvent(setup.server.server, { eventType: MCPAnalyticsEventType.custom }, logger)
      instrumentHighLevelServer(setup.server, logger)
      await callTool(setup.client, 'missing-tracking-data')

      expect(logs).toContain('Warning: Server tracking data not found. Event will not be published.')
      expect(logs).toContain('Warning: Cannot setup listener - no tracking data found')
      expect(logs).toContain(
        'Warning: PostHog MCP analytics is unable to find server tracking data. Please ensure you have called instrument(server, options) before using tool calls.'
      )
    } finally {
      await setup.cleanup()
    }
  })

  it('routes a loggerless server through the legacy logger without leaking another server logger', async () => {
    const [setupA, setupWithoutLogger] = await Promise.all([setupTestServerAndClient(), setupTestServerAndClient()])
    const logsA: string[] = []
    const legacyLogs: string[] = []
    setLogger((message) => legacyLogs.push(message))

    try {
      instrument(setupA.server, failingPostHog('sink-a'), {
        logger: (message) => logsA.push(message),
        identify: async () => ({ distinctId: 'user-a' }),
      })
      instrument(setupWithoutLogger.server, failingPostHog('sink-without-logger'), {
        identify: async () => ({ distinctId: 'user-without-logger' }),
      })

      await Promise.all([callTool(setupA.client, 'from-a'), callTool(setupWithoutLogger.client, 'without-logger')])
      await flushSinkLogging()

      expect(logsA.some((message) => message.includes('sink-a'))).toBe(true)
      expect(logsA.join('\n')).not.toContain('sink-without-logger')
      expect(logsA.join('\n')).not.toContain('user-a')
      expect(legacyLogs.some((message) => message.includes('sink-without-logger'))).toBe(true)
      expect(legacyLogs.join('\n')).not.toContain('sink-a')
      expect(legacyLogs.join('\n')).not.toContain('user-without-logger')
    } finally {
      await Promise.all([setupA.cleanup(), setupWithoutLogger.cleanup()])
    }
  })
})
