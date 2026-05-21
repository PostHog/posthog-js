import { buildCapturedMcpParameters } from '../modules/mcp-payloads'

describe('buildCapturedMcpParameters', () => {
  it('captures useful tool-call inputs without transport internals or duplicated intent', () => {
    const parameters = buildCapturedMcpParameters({
      id: 102,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'projects-get',
        arguments: {
          context: 'Review local project access before inspecting MCP analytics capture results.',
          projectId: 1,
          api_token: 'phc_123456789012345678901234567890',
        },
      },
      extra: {
        requestInfo: {
          headers: {
            authorization: 'Bearer phx_123456789012345678901234567890',
          },
        },
        signal: {},
      },
    })

    expect(parameters).toEqual({
      request: {
        id: 102,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'projects-get',
          arguments: {
            projectId: 1,
            api_token: '[redacted]',
          },
        },
      },
    })
  })

  it('redacts PostHog tokens from captured string values', () => {
    const parameters = buildCapturedMcpParameters({
      method: 'tools/call',
      params: {
        name: 'projects-get',
        arguments: {
          summary: 'Default project token api_token: phc_123456789012345678901234567890.',
        },
      },
    })

    expect(JSON.stringify(parameters)).not.toContain('phc_')
    expect(parameters).toEqual({
      request: {
        method: 'tools/call',
        params: {
          name: 'projects-get',
          arguments: {
            summary: 'Default project token api_token: [redacted].',
          },
        },
      },
    })
  })
})
