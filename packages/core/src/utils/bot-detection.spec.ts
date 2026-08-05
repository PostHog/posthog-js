import { getBlockedUAMatch, isBlockedUA } from './bot-detection'

describe('bot detection', () => {
  it('returns the matching blocklist entry', () => {
    expect(getBlockedUAMatch('Mozilla/5.0 MyCustomAgent/1.0', ['mycustomagent'])).toBe('mycustomagent')
  })

  it('preserves empty custom blocklist entries as matches', () => {
    expect(getBlockedUAMatch('Mozilla/5.0', [''])).toBe('')
    expect(isBlockedUA('Mozilla/5.0', [''])).toBe(true)
  })
})
