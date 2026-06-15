import {
  getMCPCompatibleErrorMessage,
  isCompatibleServerType,
  logCompatibilityWarning,
} from '../extensions/compatibility'
import { log } from '../extensions/logger'

jest.mock('../extensions/logger', () => ({ log: jest.fn(), setLogger: jest.fn() }))

const validLowLevelServer = () => ({
  setRequestHandler: jest.fn(),
  _requestHandlers: new Map([['test', jest.fn()]]),
  getClientVersion: jest.fn(),
  _serverInfo: { name: 'TestServer' },
})

beforeEach(() => {
  jest.clearAllMocks()
})

describe('isCompatibleServerType', () => {
  it('accepts a valid low-level server', () => {
    const server = validLowLevelServer()
    expect(isCompatibleServerType(server)).toBe(server)
    expect(log).not.toHaveBeenCalled()
  })

  it('accepts a McpServer-shaped wrapper and returns the wrapper itself', () => {
    const wrapper = { server: validLowLevelServer(), _registeredTools: {}, tool: () => {} }
    expect(isCompatibleServerType(wrapper)).toBe(wrapper)
    expect(log).not.toHaveBeenCalled()
  })

  it.each([
    ['null', null, /Server must be an object/],
    ['undefined', undefined, /Server must be an object/],
    ['string', 'not an object', /Server must be an object/],
    ['number', 42, /Server must be an object/],
  ])('rejects non-object input (%s)', (_, input, pattern) => {
    expect(() => isCompatibleServerType(input)).toThrow(pattern)
    expect(log).toHaveBeenCalled()
  })

  it.each([
    [
      'setRequestHandler missing',
      () => {
        const s = validLowLevelServer() as any
        delete s.setRequestHandler
        return s
      },
      /setRequestHandler/,
    ],
    [
      '_requestHandlers missing',
      () => {
        const s = validLowLevelServer() as any
        delete s._requestHandlers
        return s
      },
      /_requestHandlers/,
    ],
    [
      '_requestHandlers is not a Map',
      () => ({ ...validLowLevelServer(), _requestHandlers: {} as never }),
      /_requestHandlers/,
    ],
    [
      'getClientVersion missing',
      () => {
        const s = validLowLevelServer() as any
        delete s.getClientVersion
        return s
      },
      /getClientVersion/,
    ],
    [
      '_serverInfo missing',
      () => {
        const s = validLowLevelServer() as any
        delete s._serverInfo
        return s
      },
      /_serverInfo/,
    ],
    [
      '_serverInfo is not an object',
      () => ({ ...validLowLevelServer(), _serverInfo: 'string' as never }),
      /_serverInfo/,
    ],
    ['_serverInfo.name missing', () => ({ ...validLowLevelServer(), _serverInfo: {} as never }), /_serverInfo/],
  ])('rejects a server with %s and logs a warning', (_, makeServer, pattern) => {
    expect(() => isCompatibleServerType(makeServer())).toThrow(pattern)
    expect(log).toHaveBeenCalled()
  })

  it('validates the underlying low-level server inside a McpServer wrapper', () => {
    const invalidUnderlying = validLowLevelServer() as any
    delete invalidUnderlying.setRequestHandler
    const wrapper = { server: invalidUnderlying, _registeredTools: {}, tool: () => {} }
    expect(() => isCompatibleServerType(wrapper)).toThrow(/setRequestHandler/)
  })
})

describe('getMCPCompatibleErrorMessage', () => {
  it('serializes Error instances with own properties', () => {
    const error: any = new Error('boom')
    error.code = 'E_BOOM'
    const parsed = JSON.parse(getMCPCompatibleErrorMessage(error))
    expect(parsed.message).toBe('boom')
    expect(parsed.code).toBe('E_BOOM')
  })

  it('returns "Unknown error" for circular-reference Errors that fail to serialize', () => {
    const error: any = new Error('circular')
    error.self = error
    expect(getMCPCompatibleErrorMessage(error)).toBe('Unknown error')
  })

  it.each([
    ['string', 'String error', 'String error'],
    ['plain object', { code: 'X' }, JSON.stringify({ code: 'X' })],
    ['array', ['a', 'b'], JSON.stringify(['a', 'b'])],
    ['null', null, 'Unknown error'],
    ['undefined', undefined, 'Unknown error'],
    ['number', 42, 'Unknown error'],
    ['boolean', false, 'Unknown error'],
  ])('coerces %s correctly', (_, input, expected) => {
    expect(getMCPCompatibleErrorMessage(input)).toBe(expected)
  })
})

describe('logCompatibilityWarning', () => {
  it('logs a message that references MCP compatibility', () => {
    logCompatibilityWarning()
    expect(log).toHaveBeenCalledTimes(1)
    const [[message]] = (log as jest.Mock).mock.calls
    expect(message).toMatch(/compatibility/i)
    expect(message).toMatch(/Model Context Protocol|MCP/)
  })
})

describe('McpServer integration', () => {
  it('accepts a real McpServer instance', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const mcpServer = new McpServer({ name: 'test-mcp', version: '1.0.0' })
    expect(isCompatibleServerType(mcpServer)).toBe(mcpServer)
  })
})
