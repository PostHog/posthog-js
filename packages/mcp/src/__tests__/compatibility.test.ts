import {
  getMCPCompatibleErrorMessage,
  isCompatibleServerType,
  logCompatibilityWarning,
} from '../extensions/compatibility'

// Mock the logging module
jest.mock('../extensions/logger', () => ({
  log: jest.fn(),
}))

// Import after mocking
import { log } from '../extensions/logger'

const COMPATIBILITY_PATTERN = /compatibility/i
const GET_CLIENT_VERSION_PATTERN = /getClientVersion/
const MCP_NAME_PATTERN = /Model Context Protocol|MCP/
const REQUEST_HANDLERS_PATTERN = /_requestHandlers/
const SERVER_INFO_PATTERN = /_serverInfo/
const SERVER_OBJECT_ERROR_PATTERN = /Server must be an object/
const SET_REQUEST_HANDLER_PATTERN = /setRequestHandler/

describe('Compatibility Module', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('isCompatibleServerType', () => {
    it('should validate a fully compatible server', () => {
      const validServer = {
        setRequestHandler: jest.fn(),
        _requestHandlers: new Map([['test', jest.fn()]]),
        getClientVersion: jest.fn(),
        _serverInfo: { name: 'TestServer' },
      }

      const result = isCompatibleServerType(validServer)
      expect(result).toBe(validServer)
      expect(log).not.toHaveBeenCalled()
    })

    it('should throw error and log warning for null server', () => {
      expect(() => isCompatibleServerType(null)).toThrowError(SERVER_OBJECT_ERROR_PATTERN)
      expect(log).toHaveBeenCalled()
    })

    it('should throw error and log warning for undefined server', () => {
      expect(() => isCompatibleServerType(undefined)).toThrowError(SERVER_OBJECT_ERROR_PATTERN)
      expect(log).toHaveBeenCalled()
    })

    it('should throw error and log warning for non-object server', () => {
      expect(() => isCompatibleServerType('not an object')).toThrowError(SERVER_OBJECT_ERROR_PATTERN)
      expect(log).toHaveBeenCalledTimes(1)

      jest.clearAllMocks()

      expect(() => isCompatibleServerType(42)).toThrowError(SERVER_OBJECT_ERROR_PATTERN)
      expect(log).toHaveBeenCalledTimes(1)

      jest.clearAllMocks()

      expect(() => isCompatibleServerType(true)).toThrowError(SERVER_OBJECT_ERROR_PATTERN)
      expect(log).toHaveBeenCalledTimes(1)
    })

    it('should throw error and log warning when setRequestHandler is missing', () => {
      const server = {
        _requestHandlers: new Map(),
        getClientVersion: jest.fn(),
        _serverInfo: { name: 'TestServer' },
      }

      expect(() => isCompatibleServerType(server)).toThrowError(SET_REQUEST_HANDLER_PATTERN)
      expect(log).toHaveBeenCalled()
    })

    it('should throw error and log warning when setRequestHandler is not a function', () => {
      const server = {
        setRequestHandler: 'not a function',
        _requestHandlers: new Map(),
        getClientVersion: jest.fn(),
        _serverInfo: { name: 'TestServer' },
      }

      expect(() => isCompatibleServerType(server)).toThrowError(SET_REQUEST_HANDLER_PATTERN)
      expect(log).toHaveBeenCalled()
    })

    it('should throw error and log warning when _requestHandlers is missing', () => {
      const server = {
        setRequestHandler: jest.fn(),
        getClientVersion: jest.fn(),
        _serverInfo: { name: 'TestServer' },
      }

      expect(() => isCompatibleServerType(server)).toThrowError(REQUEST_HANDLERS_PATTERN)
      expect(log).toHaveBeenCalled()
    })

    it('should throw error and log warning when _requestHandlers is not a Map', () => {
      const server = {
        setRequestHandler: jest.fn(),
        _requestHandlers: {},
        getClientVersion: jest.fn(),
        _serverInfo: { name: 'TestServer' },
      }

      expect(() => isCompatibleServerType(server)).toThrowError(REQUEST_HANDLERS_PATTERN)
      expect(log).toHaveBeenCalled()
    })

    it('should throw error and log warning when _requestHandlers.get is not a function', () => {
      const server = {
        setRequestHandler: jest.fn(),
        _requestHandlers: { get: 'not a function' },
        getClientVersion: jest.fn(),
        _serverInfo: { name: 'TestServer' },
      }

      expect(() => isCompatibleServerType(server)).toThrowError(REQUEST_HANDLERS_PATTERN)
      expect(log).toHaveBeenCalled()
    })

    it('should throw error and log warning when getClientVersion is missing', () => {
      const server = {
        setRequestHandler: jest.fn(),
        _requestHandlers: new Map(),
        _serverInfo: { name: 'TestServer' },
      }

      expect(() => isCompatibleServerType(server)).toThrowError(GET_CLIENT_VERSION_PATTERN)
      expect(log).toHaveBeenCalled()
    })

    it('should throw error and log warning when getClientVersion is not a function', () => {
      const server = {
        setRequestHandler: jest.fn(),
        _requestHandlers: new Map(),
        getClientVersion: 'not a function',
        _serverInfo: { name: 'TestServer' },
      }

      expect(() => isCompatibleServerType(server)).toThrowError(GET_CLIENT_VERSION_PATTERN)
      expect(log).toHaveBeenCalled()
    })

    it('should throw error and log warning when _serverInfo is missing', () => {
      const server = {
        setRequestHandler: jest.fn(),
        _requestHandlers: new Map(),
        getClientVersion: jest.fn(),
      }

      expect(() => isCompatibleServerType(server)).toThrowError(SERVER_INFO_PATTERN)
      expect(log).toHaveBeenCalled()
    })

    it('should throw error and log warning when _serverInfo is not an object', () => {
      const server = {
        setRequestHandler: jest.fn(),
        _requestHandlers: new Map(),
        getClientVersion: jest.fn(),
        _serverInfo: 'not an object',
      }

      expect(() => isCompatibleServerType(server)).toThrowError(SERVER_INFO_PATTERN)
      expect(log).toHaveBeenCalled()
    })

    it('should throw error and log warning when _serverInfo.name is missing', () => {
      const server = {
        setRequestHandler: jest.fn(),
        _requestHandlers: new Map(),
        getClientVersion: jest.fn(),
        _serverInfo: {},
      }

      expect(() => isCompatibleServerType(server)).toThrowError(SERVER_INFO_PATTERN)
      expect(log).toHaveBeenCalled()
    })
  })

  describe('getMCPCompatibleErrorMessage', () => {
    it('should handle Error instances with standard properties', () => {
      const error = new Error('Test error message')
      const result = getMCPCompatibleErrorMessage(error)
      const parsed = JSON.parse(result)

      expect(parsed.message).toBe('Test error message')
      // Note: name property might not be enumerable in all environments
      if (parsed.name !== undefined) {
        expect(parsed.name).toBe('Error')
      }
      expect(parsed.stack).toBeDefined()
    })

    it('should handle Error instances with custom properties', () => {
      const error: any = new Error('Test error')
      error.code = 'CUSTOM_ERROR'
      error.statusCode = 500

      const result = getMCPCompatibleErrorMessage(error)
      const parsed = JSON.parse(result)

      expect(parsed.message).toBe('Test error')
      expect(parsed.code).toBe('CUSTOM_ERROR')
      expect(parsed.statusCode).toBe(500)
    })

    it('should handle string errors', () => {
      const result = getMCPCompatibleErrorMessage('String error message')
      expect(result).toBe('String error message')
    })

    it('should handle plain objects', () => {
      const errorObj = { code: 'ERROR_CODE', details: 'Some details' }
      const result = getMCPCompatibleErrorMessage(errorObj)
      expect(result).toBe(JSON.stringify(errorObj))
    })

    it('should handle null', () => {
      const result = getMCPCompatibleErrorMessage(null)
      expect(result).toBe('Unknown error')
    })

    it('should handle undefined', () => {
      const result = getMCPCompatibleErrorMessage(undefined)
      expect(result).toBe('Unknown error')
    })

    it('should handle numbers', () => {
      const result = getMCPCompatibleErrorMessage(42)
      expect(result).toBe('Unknown error')
    })

    it('should handle booleans', () => {
      const result = getMCPCompatibleErrorMessage(false)
      expect(result).toBe('Unknown error')
    })

    it('should handle circular reference errors', () => {
      const error: any = new Error('Circular error')
      error.circular = error // Create circular reference

      const result = getMCPCompatibleErrorMessage(error)
      expect(result).toBe('Unknown error')
    })

    it('should handle arrays', () => {
      const errorArray = ['error1', 'error2']
      const result = getMCPCompatibleErrorMessage(errorArray)
      expect(result).toBe(JSON.stringify(errorArray))
    })
  })

  describe('McpServer compatibility', () => {
    it('should handle McpServer instances with server property', () => {
      const underlyingServer = {
        setRequestHandler: jest.fn(),
        _requestHandlers: new Map([['test', jest.fn()]]),
        getClientVersion: jest.fn(),
        _serverInfo: { name: 'TestServer' },
      }

      const mcpServerWrapper = {
        server: underlyingServer,
        // Other McpServer properties
        requestContext: {},
        toolCallId: 'test-id',
        _registeredTools: {},
        tool: () => {},
      }

      const result = isCompatibleServerType(mcpServerWrapper)
      expect(result).toBe(mcpServerWrapper)
      expect(log).not.toHaveBeenCalled()
    })

    it('should validate the underlying server when McpServer wrapper is provided', () => {
      const invalidUnderlyingServer = {
        // Missing setRequestHandler
        _requestHandlers: new Map(),
        getClientVersion: jest.fn(),
        _serverInfo: { name: 'TestServer' },
      }

      const mcpServerWrapper = {
        server: invalidUnderlyingServer,
        _registeredTools: {},
        tool: () => {},
      }

      expect(() => isCompatibleServerType(mcpServerWrapper)).toThrowError(SET_REQUEST_HANDLER_PATTERN)
      expect(log).toHaveBeenCalled()
    })

    it('should handle objects with server property that is not an object', () => {
      const mcpServerWrapper = {
        server: 'not an object',
        setRequestHandler: jest.fn(),
        _requestHandlers: new Map(),
        getClientVersion: jest.fn(),
        _serverInfo: { name: 'TestServer' },
      }

      // Should use the wrapper itself since server property is not an object
      const result = isCompatibleServerType(mcpServerWrapper)
      expect(result).toBe(mcpServerWrapper)
      expect(log).not.toHaveBeenCalled()
    })

    it('should handle objects with null server property', () => {
      const mcpServerWrapper = {
        server: null,
        setRequestHandler: jest.fn(),
        _requestHandlers: new Map(),
        getClientVersion: jest.fn(),
        _serverInfo: { name: 'TestServer' },
      }

      // Should use the wrapper itself since server property is null
      const result = isCompatibleServerType(mcpServerWrapper)
      expect(result).toBe(mcpServerWrapper)
      expect(log).not.toHaveBeenCalled()
    })

    it('should validate all required properties on the underlying server', () => {
      const testCases = [
        {
          name: 'missing _requestHandlers',
          server: {
            setRequestHandler: jest.fn(),
            getClientVersion: jest.fn(),
            _serverInfo: { name: 'TestServer' },
          },
          expectedPattern: REQUEST_HANDLERS_PATTERN,
        },
        {
          name: 'missing getClientVersion',
          server: {
            setRequestHandler: jest.fn(),
            _requestHandlers: new Map(),
            _serverInfo: { name: 'TestServer' },
          },
          expectedPattern: GET_CLIENT_VERSION_PATTERN,
        },
        {
          name: 'missing _serverInfo',
          server: {
            setRequestHandler: jest.fn(),
            _requestHandlers: new Map(),
            getClientVersion: jest.fn(),
          },
          expectedPattern: SERVER_INFO_PATTERN,
        },
      ]

      for (const testCase of testCases) {
        jest.clearAllMocks()
        const mcpServerWrapper = {
          server: testCase.server,
          _registeredTools: {},
          tool: () => {},
        }

        expect(() => isCompatibleServerType(mcpServerWrapper)).toThrowError(testCase.expectedPattern)
        expect(log).toHaveBeenCalled()
      }
    })
  })

  describe('logCompatibilityWarning', () => {
    it('should log the correct compatibility message to the log file', () => {
      logCompatibilityWarning()

      expect(log).toHaveBeenCalled()
      expect(log).toHaveBeenCalledTimes(1)
      // Check that it contains key compatibility info rather than exact message
      const [[message]] = (log as any).mock.calls
      expect(message).toMatch(COMPATIBILITY_PATTERN)
      expect(message).toMatch(MCP_NAME_PATTERN)
    })
  })

  describe('McpServer integration tests', () => {
    // Dynamically check if McpServer is available (v1.3.0+)
    let McpServer: any
    let hasCompatibleVersion = false

    beforeEach(async () => {
      try {
        // Try to import McpServer - it's available in v1.3.0+
        const { McpServer: ImportedMcpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
        McpServer = ImportedMcpServer
        hasCompatibleVersion = true
      } catch {
        // McpServer not available in this version
        hasCompatibleVersion = false
      }
    })

    it('should work with real McpServer instances if available', async () => {
      if (!hasCompatibleVersion) {
        console.log('Skipping McpServer test - requires @modelcontextprotocol/sdk v1.3.0 or higher')
        return
      }

      // Create a real McpServer instance with server info
      const mcpServer = new McpServer({
        name: 'test-mcp-server',
        version: '1.0.0',
      })

      // Test that isCompatibleServerType correctly handles it
      const result = isCompatibleServerType(mcpServer)

      // Should return the underlying server
      expect(result).toBe(mcpServer)
      expect(result).toBeDefined()
      // Note: _serverInfo exists but may be private - our compatibility check should handle this
    })

    it('should validate real McpServer underlying server properties', async () => {
      if (!hasCompatibleVersion) {
        console.log('Skipping McpServer validation test - requires @modelcontextprotocol/sdk v1.3.0 or higher')
        return
      }

      const mcpServer = new McpServer({
        name: 'test-validation-server',
        version: '1.0.0',
      })
      const underlyingServer = mcpServer.server

      // Verify all required properties exist on the real server
      expect(underlyingServer).toBeDefined()
      expect(typeof underlyingServer.setRequestHandler).toBe('function')
      expect(underlyingServer._requestHandlers).toBeInstanceOf(Map)
      expect(typeof underlyingServer.getClientVersion).toBe('function')

      // Check if _serverInfo exists (it might be private but still accessible)
      // TypeScript will complain but JavaScript can still access it
      const serverInfo = (underlyingServer as any)._serverInfo
      if (serverInfo) {
        expect(serverInfo).toBeDefined()
        expect(serverInfo.name).toBe('test-validation-server')
        expect(serverInfo.version).toBe('1.0.0')
      } else {
        // If truly private and inaccessible, we should update our compatibility check
        console.log('Note: _serverInfo is not accessible in this MCP SDK version')
      }
    })

    it('should show compatibility message when McpServer is not available', () => {
      if (hasCompatibleVersion) {
        console.log('Skipping version check test - McpServer is available')
        return
      }

      // This test only runs on older versions
      expect(hasCompatibleVersion).toBe(false)
      console.log('McpServer not available - using @modelcontextprotocol/sdk < v1.3.0')
    })
  })
})
