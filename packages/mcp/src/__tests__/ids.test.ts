import { deterministicPrefixedId, newPrefixedId } from '../modules/ids'

const EVENT_ID_PATTERN = /^evt_[0-9a-f-]{36}$/
const DETERMINISTIC_SESSION_ID_PATTERN = /^ses_[0-9a-f]{32}$/
const SESSION_ID_PATTERN = /^ses_[0-9a-f-]{36}$/

describe('SDK IDs', () => {
  it('generates prefixed IDs for new SDK events and sessions', () => {
    const eventId = newPrefixedId('evt')
    const sessionId = newPrefixedId('ses')

    expect(eventId).toMatch(EVENT_ID_PATTERN)
    expect(sessionId).toMatch(SESSION_ID_PATTERN)
  })

  it('derives stable prefixed IDs from MCP session inputs', () => {
    const first = deterministicPrefixedId('ses', 'mcp-session:project')
    const second = deterministicPrefixedId('ses', 'mcp-session:project')
    const other = deterministicPrefixedId('ses', 'other-session:project')

    expect(first).toBe(second)
    expect(first).not.toBe(other)
    expect(first).toMatch(DETERMINISTIC_SESSION_ID_PATTERN)
  })
})
