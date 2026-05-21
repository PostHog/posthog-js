import { version } from '../index'

describe('@posthog/mcp scaffold', () => {
  it('exports a semver-shaped version string', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })
})
