import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { instrument } from '../index'
import { fakePostHog } from './test-utils'
import { resetTodos, setupTestServerAndClient } from './test-utils/client-server-factory'

const BANNED_PHRASES = [
  'parallel tool calls',
  'system prompt',
  'even if existing tools',
  'Most important',
  'even if you can work around it',
  'send it even if',
]

function collectDescriptions(tools: any[]): string[] {
  return tools.flatMap((tool) => [
    tool.description ?? '',
    ...Object.values<any>(tool.inputSchema?.properties ?? {}).map((property) => property.description ?? ''),
  ])
}

describe('advertised descriptions pass directory review', () => {
  it.each(BANNED_PHRASES)('no tool or argument description contains "%s"', async (phrase) => {
    resetTodos()
    const { server, client, cleanup } = await setupTestServerAndClient()
    try {
      instrument(server, fakePostHog(), {
        context: true,
        captureModel: true,
        enableConversationId: true,
        reportMissing: true,
        collectFeedback: true,
      })

      const { tools } = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      const descriptions = collectDescriptions(tools)

      expect(descriptions.some((d) => d.includes('conversation_id'))).toBe(true)
      expect(tools.map((t: any) => t.name)).toEqual(expect.arrayContaining(['get_more_tools', 'send_feedback']))
      for (const description of descriptions) {
        expect(description.toLowerCase()).not.toContain(phrase.toLowerCase())
      }
    } finally {
      await cleanup()
    }
  })
})
